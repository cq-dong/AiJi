// PRD trust pack t1（2026-10-05）：导出 .zip 备份的导入还原（PRD F5/§5/§7.2）。
// 契约：docs/acceptance/prd-trust-pack.md §范围①b。
// - parseZip：STORE-only 读取器（EOCD→central directory→local header），与 zipExport
//   的 buildZip 镜像，零依赖；method≠0 抛 'invalid'（我们不产压缩包，收到即非本应用备份）。
// - readBackup：读 entries.json（缺 → 抛 'invalid'：「不是有效的 AiJi 备份或版本过旧」）
//   + ai.json / categories.json / tags.json（均可缺省）+ media/* 留内存，先给确认 sheet 计数。
// - restoreBackup：新增式恢复——全部新 id，永不覆盖；processing 尸体 → failed；
//   类别/标签按 slug upsert（冲突整条保留现有）；媒体按 media/<oldRef>. 前缀匹配，
//   命中落新 ref、未命中丢 part；日聚合置 stale 待自然重算。
//   返回计数两口径分开（E2 MINOR-2）：skippedParts=丢掉的媒体 part 数；
//   skippedEntries=part 丢光整条跳过的条目数。
// 落库全走 di.storage 单条 save*，ownerId 由 stampOwner 自动盖当前账号，导入方无需传。
import { di } from '@/app/di'
import type { Category, Entry, EntryAi, EntryPart, Tag } from '@/domain/types'

// 备份里 status==='processing' 必是导出当时的处理中尸体（或中断残留）——还原后标失败可重试。
const RESTORE_PROCESS_ERROR = '备份还原时原处理未完成，可重试'

export interface ParsedBackup {
  entries: Entry[]
  aiByEntry: Record<string, EntryAi>
  categories: Category[]
  tags: Tag[]
  // zip 内完整路径（'media/<ref>.<ext>'）→ 字节。恢复时按前缀匹配，扩展名不重建
  // （防 extFromType 漂移导致导出/导入扩展名推断不一致）。
  media: Map<string, Uint8Array>
  entryCount: number
  mediaCount: number
}

// STORE-only zip 读取：EOCD（尾部扫签名）→ central directory → 各条 local header 取数据。
export function parseZip(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // EOCD signature 0x06054b50，定长 22 字节（本应用不写 zip comment，但扫描兼容带 comment 的包）。
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('invalid')
  const count = dv.getUint16(eocd + 10, true)
  let pos = dv.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || dv.getUint32(pos, true) !== 0x02014b50) throw new Error('invalid')
    const method = dv.getUint16(pos + 10, true)
    if (method !== 0) throw new Error('invalid') // STORE only
    const size = dv.getUint32(pos + 24, true) // uncompressed size（STORE 下 = compressed size）
    const nameLen = dv.getUint16(pos + 28, true)
    const extraLen = dv.getUint16(pos + 30, true)
    const commentLen = dv.getUint16(pos + 32, true)
    const localOff = dv.getUint32(pos + 42, true)
    const name = dec.decode(buf.subarray(pos + 46, pos + 46 + nameLen))
    // local header 的 name/extra 长度可能与 central 不同——以 local 为准定位数据起点。
    if (localOff + 30 > buf.length || dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('invalid')
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    if (dataStart + size > buf.length) throw new Error('invalid')
    out.set(name, buf.subarray(dataStart, dataStart + size))
    pos += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function parseJson<T>(raw: Uint8Array | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as T
  } catch {
    return fallback
  }
}

// 读备份包 → 结构化内容 + 计数（确认 sheet 先展示，用户确认后才 restoreBackup）。
export async function readBackup(file: Blob): Promise<ParsedBackup> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const files = parseZip(buf)
  const entriesRaw = files.get('entries.json')
  // entries.json 是 v2 备份的机器可还原真源；缺 = v1 旧包（只有 markdown，有损）或非 AiJi 包。
  if (!entriesRaw) throw new Error('invalid')
  const entries = parseJson<Entry[]>(entriesRaw, [])
  if (!Array.isArray(entries)) throw new Error('invalid')
  const aiByEntry = parseJson<Record<string, EntryAi>>(files.get('ai.json'), {})
  const categories = parseJson<Category[]>(files.get('categories.json'), [])
  const tags = parseJson<Tag[]>(files.get('tags.json'), [])
  const media = new Map<string, Uint8Array>()
  for (const [name, data] of files) {
    if (name.startsWith('media/')) media.set(name, data)
  }
  return { entries, aiByEntry, categories, tags, media, entryCount: entries.length, mediaCount: media.size }
}

// 媒体 part 按 'media/<oldRef>.' 前缀匹配 zip 内文件（扩展名不重建）。
function findMedia(media: Map<string, Uint8Array>, ref: string): Uint8Array | undefined {
  const prefix = `media/${ref}.`
  for (const [name, data] of media) {
    if (name.startsWith(prefix)) return data
  }
  return undefined
}

// 新增式还原：全部新 id（crypto.randomUUID），永不覆盖现有数据。返回计数供 toast。
// skippedParts / skippedEntries 两口径分开（E2 MINOR-2），toast 单位不再混「条」。
export async function restoreBackup(
  parsed: ParsedBackup,
): Promise<{ entries: number; media: number; skippedParts: number; skippedEntries: number }> {
  // 1. 类别/标签按 slug upsert：slug 已存在整条保留现有（用户可能已策展改名/合并）；
  //    新增插入 usageCount=0（备份里的计数对本机无意义）。
  const [existingCats, existingTags] = await Promise.all([di.storage.listCategories(), di.storage.listTags()])
  const catSlugs = new Set(existingCats.map((c) => c.slug))
  const tagSlugs = new Set(existingTags.map((t) => t.slug))
  for (const c of parsed.categories) {
    if (catSlugs.has(c.slug)) continue
    const { ownerId: _drop, ...rest } = c
    await di.storage.saveCategory({ ...rest, usageCount: 0 })
    catSlugs.add(c.slug)
  }
  for (const tg of parsed.tags) {
    if (tagSlugs.has(tg.slug)) continue
    const { ownerId: _drop, ...rest } = tg
    await di.storage.saveTag({ ...rest, usageCount: 0 })
    tagSlugs.add(tg.slug)
  }

  // 2. 条目逐条还原。
  let restored = 0
  let mediaRestored = 0
  let skippedParts = 0
  let skippedEntries = 0
  for (const e of parsed.entries) {
    const parts: EntryPart[] = []
    for (const p of e.parts) {
      if (p.type === 'text') {
        parts.push({ ...p })
        continue
      }
      const data = findMedia(parsed.media, p.ref)
      if (!data) {
        skippedParts++
        continue
      }
      const newRef = crypto.randomUUID()
      // data 是整个 zip buffer 上的 subarray 视图——new Uint8Array(view) 拷贝出独立
      // ArrayBuffer 区间（视图直接作 BlobPart 类型不符；用 data.buffer 更会把整个 zip
      // 当成媒体内容写进去）。
      await di.storage.saveMedia(newRef, new Blob([new Uint8Array(data)]))
      mediaRestored++
      parts.push({ ...p, ref: newRef })
    }
    // 原有 part 全部丢光 → 整条跳过（空壳条目无意义），单独计 skippedEntries。
    if (e.parts.length > 0 && parts.length === 0) {
      skippedEntries++
      continue
    }

    const newId = crypto.randomUUID()
    const oldAi = parsed.aiByEntry[e.id]
    const newAiId = oldAi ? crypto.randomUUID() : undefined
    const { ownerId: _o, deletedAt: _d, ...rest } = e
    const entry: Entry = {
      ...rest,
      id: newId,
      parts,
      status: e.status === 'processing' ? 'failed' : e.status,
      processError: e.status === 'processing' ? RESTORE_PROCESS_ERROR : e.processError,
      aiId: newAiId,
    }
    await di.storage.saveEntry(entry)
    if (oldAi && newAiId) {
      await di.storage.saveEntryAi({ ...oldAi, id: newAiId, entryId: newId })
    }
    restored++
  }

  // 3. 日聚合全部置 stale（摘要页开时自然重算，导入条目进入 digest）；周/月不动。
  const aggregates = await di.storage.listAggregates()
  for (const ag of aggregates) {
    if (ag.scope.type === 'day' && !ag.stale) {
      await di.storage.saveAggregate({ ...ag, stale: true })
    }
  }

  return { entries: restored, media: mediaRestored, skippedParts, skippedEntries }
}
