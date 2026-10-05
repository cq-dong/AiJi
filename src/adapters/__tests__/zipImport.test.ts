// PRD trust pack t1（2026-10-05）：zip 导入还原 + 导出 v2。
// 契约：docs/acceptance/prd-trust-pack.md §范围① / §测试要点 t1。
// - parseZip：STORE-only 读取器（EOCD→central→local），与 zipExport buildZip 镜像。
// - readBackup：entries.json 缺失抛 'invalid'；ai/categories/tags 可缺省。
// - restoreBackup：新 id 重映射 / processing→failed / slug 冲突保留 / 丢媒体 skippedParts /
//   整条跳过 skippedEntries / 日聚合置 stale。
// - exportZip v2：产物含 entries/categories/tags.json + manifest.version===2。
// 测试内 mini STORE builder 镜像 buildZip（~40 行），不依赖 zipExport 内部未导出函数。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Category, Entry, EntryAi, Tag } from '@/domain/types'

// ── di mock：捕获 save* 调用 ────────────────────────────────────────────────
const storeMocks = vi.hoisted(() => ({
  saveEntry: vi.fn(),
  saveEntryAi: vi.fn(),
  saveCategory: vi.fn(),
  saveTag: vi.fn(),
  saveMedia: vi.fn(),
  saveAggregate: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  listAggregates: vi.fn(),
  getMedia: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: { storage: storeMocks, llm: {} },
}))

// ── fileShare mock：exportZip 落盘拦截，捕获 blob 供 parseZip 断言 ───────────
const shareMocks = vi.hoisted(() => ({ saved: [] as { blob: Blob; name: string }[] }))
vi.mock('@/adapters/fileShare', () => ({
  saveBlob: (blob: Blob, name: string) => {
    shareMocks.saved.push({ blob, name })
    return Promise.resolve({ ok: true, method: 'download' })
  },
  canShareFiles: () => false,
}))

import { parseZip, readBackup, restoreBackup } from '@/adapters/zipImport'
import { exportZip } from '@/adapters/zipExport'
import { useUiStore } from '@/app/store'

// ── mini STORE builder（镜像 zipExport buildZip；method 可参数化以测守卫） ────
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 0
    table[i] = c
  }
  return table
})()
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}
function buildStoreZip(files: { name: string; data: Uint8Array; method?: number }[]): Uint8Array {
  const enc = new TextEncoder()
  const meta = files.map((f) => ({
    name: enc.encode(f.name),
    data: f.data,
    crc: crc32(f.data),
    method: f.method ?? 0,
  }))
  const localChunks: Uint8Array[] = []
  const offsets: number[] = []
  let offset = 0
  for (const m of meta) {
    offsets.push(offset)
    const header = new Uint8Array(30)
    const dv = new DataView(header.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(8, m.method, true)
    dv.setUint32(14, m.crc, true)
    dv.setUint32(18, m.data.length, true)
    dv.setUint32(22, m.data.length, true)
    dv.setUint16(26, m.name.length, true)
    const chunk = new Uint8Array(30 + m.name.length + m.data.length)
    chunk.set(header, 0)
    chunk.set(m.name, 30)
    chunk.set(m.data, 30 + m.name.length)
    localChunks.push(chunk)
    offset += chunk.length
  }
  const cdChunks: Uint8Array[] = []
  let cdSize = 0
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]
    const entry = new Uint8Array(46 + m.name.length)
    const dv = new DataView(entry.buffer)
    dv.setUint32(0, 0x02014b50, true)
    dv.setUint16(10, m.method, true)
    dv.setUint32(16, m.crc, true)
    dv.setUint32(20, m.data.length, true)
    dv.setUint32(24, m.data.length, true)
    dv.setUint16(28, m.name.length, true)
    dv.setUint32(42, offsets[i], true)
    entry.set(m.name, 46)
    cdChunks.push(entry)
    cdSize += entry.length
  }
  const eocd = new Uint8Array(22)
  const dv = new DataView(eocd.buffer)
  dv.setUint32(0, 0x06054b50, true)
  dv.setUint16(8, meta.length, true)
  dv.setUint16(10, meta.length, true)
  dv.setUint32(12, cdSize, true)
  dv.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cdSize + 22)
  let pos = 0
  for (const c of [...localChunks, ...cdChunks]) {
    out.set(c, pos)
    pos += c.length
  }
  out.set(eocd, pos)
  return out
}

// ── 数据工厂 ────────────────────────────────────────────────────────────────
const enc = new TextEncoder()
const dec = new TextDecoder()

function makeEntry(over: Partial<Entry> & { id: string }): Entry {
  return {
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    parts: [{ type: 'text', content: 'hello' }],
    status: 'ready',
    ...over,
  }
}
function makeAi(entryId: string, over: Partial<EntryAi> = {}): EntryAi {
  return {
    id: `ai-${entryId}`,
    entryId,
    version: 1,
    category: 'idea',
    tags: ['t1'],
    facets: {},
    modelUsed: 'deepseek-v4-flash',
    createdAt: '2026-09-01T08:05:00.000Z',
    ...over,
  }
}
function makeCategory(slug: string): Category {
  return { slug, label: slug, aliases: [], usageCount: 7, createdAt: '2026-09-01T00:00:00.000Z' }
}
function makeTag(slug: string): Tag {
  return { slug, label: slug, usageCount: 3, createdAt: '2026-09-01T00:00:00.000Z' }
}

function backupZip(opts: {
  entries?: Entry[]
  ai?: Record<string, EntryAi>
  categories?: Category[]
  tags?: Tag[]
  media?: Record<string, Uint8Array>
  omitEntriesJson?: boolean
}): Blob {
  const files: { name: string; data: Uint8Array }[] = []
  if (!opts.omitEntriesJson) files.push({ name: 'entries.json', data: enc.encode(JSON.stringify(opts.entries ?? [])) })
  if (opts.ai) files.push({ name: 'ai.json', data: enc.encode(JSON.stringify(opts.ai)) })
  if (opts.categories) files.push({ name: 'categories.json', data: enc.encode(JSON.stringify(opts.categories)) })
  if (opts.tags) files.push({ name: 'tags.json', data: enc.encode(JSON.stringify(opts.tags)) })
  for (const [name, data] of Object.entries(opts.media ?? {})) files.push({ name, data })
  const zip = buildStoreZip(files)
  return new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
}

beforeEach(() => {
  for (const fn of Object.values(storeMocks)) fn.mockReset()
  storeMocks.listCategories.mockResolvedValue([])
  storeMocks.listTags.mockResolvedValue([])
  storeMocks.listAggregates.mockResolvedValue([])
  storeMocks.saveEntry.mockResolvedValue(undefined)
  storeMocks.saveEntryAi.mockResolvedValue(undefined)
  storeMocks.saveCategory.mockResolvedValue(undefined)
  storeMocks.saveTag.mockResolvedValue(undefined)
  storeMocks.saveMedia.mockResolvedValue(undefined)
  storeMocks.saveAggregate.mockResolvedValue(undefined)
  shareMocks.saved.length = 0
})

// ── parseZip ────────────────────────────────────────────────────────────────
describe('parseZip', () => {
  it('STORE builder round-trip：文件名与内容还原', () => {
    const zip = buildStoreZip([
      { name: 'entries.json', data: enc.encode('[{"id":"a"}]') },
      { name: 'media/ref-1.webm', data: new Uint8Array([1, 2, 3, 255]) },
    ])
    const files = parseZip(zip)
    expect(files.size).toBe(2)
    expect(dec.decode(files.get('entries.json'))).toBe('[{"id":"a"}]')
    expect([...(files.get('media/ref-1.webm') ?? [])]).toEqual([1, 2, 3, 255])
  })

  it('method≠0（deflate）抛 invalid', () => {
    const zip = buildStoreZip([{ name: 'a.txt', data: enc.encode('x'), method: 8 }])
    expect(() => parseZip(zip)).toThrow('invalid')
  })

  it('非 zip 内容抛 invalid', () => {
    expect(() => parseZip(enc.encode('not a zip at all, no eocd here'))).toThrow('invalid')
  })
})

// ── readBackup ──────────────────────────────────────────────────────────────
describe('readBackup', () => {
  it('entries.json 缺失 → 抛 invalid（不是有效备份或版本过旧）', async () => {
    await expect(readBackup(backupZip({ omitEntriesJson: true }))).rejects.toThrow('invalid')
  })

  it('ai/categories/tags 可缺省 → {} / [] / []，计数正确', async () => {
    const parsed = await readBackup(
      backupZip({
        entries: [makeEntry({ id: 'e1' })],
        media: { 'media/r1.webm': new Uint8Array([9]) },
      }),
    )
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.aiByEntry).toEqual({})
    expect(parsed.categories).toEqual([])
    expect(parsed.tags).toEqual([])
    expect(parsed.entryCount).toBe(1)
    expect(parsed.mediaCount).toBe(1)
    expect(parsed.media.has('media/r1.webm')).toBe(true)
  })
})

// ── restoreBackup ───────────────────────────────────────────────────────────
describe('restoreBackup', () => {
  it('round-trip：新 id / aiId·entryId 重映射 / ref 重写且媒体落新 ref / version·modelUsed 原样', async () => {
    const entry = makeEntry({
      id: 'old-e1',
      parts: [
        { type: 'text', content: 'hello' },
        { type: 'audio', ref: 'old-ref', durationSec: 3, mime: 'audio/webm' },
      ],
    })
    const parsed = await readBackup(
      backupZip({
        entries: [entry],
        ai: { 'old-e1': makeAi('old-e1', { version: 3, modelUsed: 'qwen3.5-flash' }) },
        media: { 'media/old-ref.webm': new Uint8Array([7, 7, 7]) },
      }),
    )
    const r = await restoreBackup(parsed)
    expect(r).toEqual({ entries: 1, media: 1, skippedParts: 0, skippedEntries: 0 })

    expect(storeMocks.saveEntry).toHaveBeenCalledTimes(1)
    const saved = storeMocks.saveEntry.mock.calls[0][0] as Entry
    expect(saved.id).not.toBe('old-e1')
    expect(saved.parts).toHaveLength(2)
    const audio = saved.parts[1] as { ref: string }
    expect(audio.ref).not.toBe('old-ref')

    // 媒体落新 ref，内容与 zip 内一致
    expect(storeMocks.saveMedia).toHaveBeenCalledTimes(1)
    const [mediaRef, mediaBlob] = storeMocks.saveMedia.mock.calls[0] as [string, Blob]
    expect(mediaRef).toBe(audio.ref)
    expect(new Uint8Array(await mediaBlob.arrayBuffer())).toEqual(new Uint8Array([7, 7, 7]))

    // EntryAi：id/entryId 重映射，version/modelUsed 原样，entry.aiId 同步改指
    expect(storeMocks.saveEntryAi).toHaveBeenCalledTimes(1)
    const savedAi = storeMocks.saveEntryAi.mock.calls[0][0] as EntryAi
    expect(savedAi.entryId).toBe(saved.id)
    expect(savedAi.id).not.toBe('ai-old-e1')
    expect(saved.aiId).toBe(savedAi.id)
    expect(savedAi.version).toBe(3)
    expect(savedAi.modelUsed).toBe('qwen3.5-flash')
  })

  it("status 'processing' → 'failed' + processError 补还原说明；其余 status 原样", async () => {
    const parsed = await readBackup(
      backupZip({
        entries: [
          makeEntry({ id: 'p1', status: 'processing' }),
          makeEntry({ id: 'p2', status: 'failed', processError: '原错误' }),
          makeEntry({ id: 'p3', status: 'idle' }),
        ],
      }),
    )
    await restoreBackup(parsed)
    const saved = storeMocks.saveEntry.mock.calls.map((c) => c[0] as Entry)
    expect(saved[0].status).toBe('failed')
    expect(saved[0].processError).toBe('备份还原时原处理未完成，可重试')
    expect(saved[1].status).toBe('failed')
    expect(saved[1].processError).toBe('原错误')
    expect(saved[2].status).toBe('idle')
    expect(saved[2].processError).toBeUndefined()
  })

  it('slug 冲突保留现有类别/标签；新增插入 usageCount=0', async () => {
    storeMocks.listCategories.mockResolvedValue([makeCategory('idea')])
    storeMocks.listTags.mockResolvedValue([makeTag('t1')])
    const parsed = await readBackup(
      backupZip({
        entries: [makeEntry({ id: 'e1' })],
        categories: [makeCategory('idea'), makeCategory('project')],
        tags: [makeTag('t1'), makeTag('t2')],
      }),
    )
    await restoreBackup(parsed)
    expect(storeMocks.saveCategory).toHaveBeenCalledTimes(1)
    expect((storeMocks.saveCategory.mock.calls[0][0] as Category).slug).toBe('project')
    expect((storeMocks.saveCategory.mock.calls[0][0] as Category).usageCount).toBe(0)
    expect(storeMocks.saveTag).toHaveBeenCalledTimes(1)
    expect((storeMocks.saveTag.mock.calls[0][0] as Tag).slug).toBe('t2')
    expect((storeMocks.saveTag.mock.calls[0][0] as Tag).usageCount).toBe(0)
  })

  it('媒体缺失 → 丢该 part（skippedParts++）；全部 part 丢光 → 整条跳过（skippedEntries++）', async () => {
    const parsed = await readBackup(
      backupZip({
        entries: [
          makeEntry({
            id: 'keep',
            parts: [
              { type: 'text', content: 'x' },
              { type: 'audio', ref: 'gone', durationSec: 1 },
            ],
          }),
          makeEntry({ id: 'drop', parts: [{ type: 'video', ref: 'gone2', durationSec: 2 }] }),
        ],
      }),
    )
    const r = await restoreBackup(parsed)
    expect(r.entries).toBe(1)
    expect(r.media).toBe(0)
    // 两个媒体 part 各丢一次（keep 的 audio + drop 的 video）→ skippedParts=2；
    // drop 唯一 part 丢光 → 整条跳过 → skippedEntries=1（E2 MINOR-2：两口径分开计数）。
    expect(r.skippedParts).toBe(2)
    expect(r.skippedEntries).toBe(1)
    expect(storeMocks.saveEntry).toHaveBeenCalledTimes(1)
    const saved = storeMocks.saveEntry.mock.calls[0][0] as Entry
    expect(saved.parts).toHaveLength(1)
    expect(saved.parts[0].type).toBe('text')
    expect(storeMocks.saveMedia).not.toHaveBeenCalled()
  })

  it('日聚合全部置 stale 落库；周/月不动', async () => {
    const day = { id: 'a1', scope: { type: 'day', range: '2026-09-01' }, summary: 's', entryIds: [], modelUsed: 'm', createdAt: '2026-09-01', stale: false }
    const dayStale = { ...day, id: 'a2', stale: true }
    const week = { ...day, id: 'a3', scope: { type: 'week', range: '2026-W36' } }
    storeMocks.listAggregates.mockResolvedValue([day, dayStale, week])
    const parsed = await readBackup(backupZip({ entries: [makeEntry({ id: 'e1' })] }))
    await restoreBackup(parsed)
    expect(storeMocks.saveAggregate).toHaveBeenCalledTimes(1)
    const savedAg = storeMocks.saveAggregate.mock.calls[0][0] as typeof day
    expect(savedAg.id).toBe('a1')
    expect(savedAg.stale).toBe(true)
  })
})

// ── exportZip v2 ────────────────────────────────────────────────────────────
describe('exportZip v2', () => {
  it('产物含 entries/categories/tags.json + manifest.version===2，可读回还原', async () => {
    const entry = makeEntry({
      id: 'ex1',
      parts: [
        { type: 'text', content: 'hi' },
        { type: 'audio', ref: 'r1', durationSec: 2, mime: 'audio/webm' },
      ],
    })
    storeMocks.getMedia.mockResolvedValue(new Blob([new Uint8Array([5, 5])], { type: 'audio/webm' }))
    useUiStore.setState({
      hydrated: true,
      entries: [entry],
      aiByEntry: { ex1: makeAi('ex1') },
      categories: [makeCategory('idea')],
      tags: [makeTag('t1')],
    })

    const result = await exportZip()
    expect(result.ok).toBe(true)
    expect(shareMocks.saved).toHaveLength(1)

    const zip = new Uint8Array(await shareMocks.saved[0].blob.arrayBuffer())
    const files = parseZip(zip)
    // v2 三个新文件
    const entriesJson = JSON.parse(dec.decode(files.get('entries.json'))) as Entry[]
    expect(entriesJson).toHaveLength(1)
    expect(entriesJson[0].id).toBe('ex1')
    expect(JSON.parse(dec.decode(files.get('categories.json')))).toHaveLength(1)
    expect(JSON.parse(dec.decode(files.get('tags.json')))).toHaveLength(1)
    // markdown / ai.json / media 布局不变
    expect(files.has('entries/ex1.md')).toBe(true)
    expect(files.has('ai.json')).toBe(true)
    expect(files.has('media/r1.webm')).toBe(true)
    // manifest v2
    const manifest = JSON.parse(dec.decode(files.get('manifest.json'))) as { version: number }
    expect(manifest.version).toBe(2)

    // 真·round-trip：导出包喂回 readBackup → restoreBackup
    const parsed = await readBackup(shareMocks.saved[0].blob)
    expect(parsed.entryCount).toBe(1)
    expect(parsed.mediaCount).toBe(1)
    const r = await restoreBackup(parsed)
    expect(r).toEqual({ entries: 1, media: 1, skippedParts: 0, skippedEntries: 0 })
    const saved = storeMocks.saveEntry.mock.calls[0][0] as Entry
    expect(saved.id).not.toBe('ex1')
  })
})
