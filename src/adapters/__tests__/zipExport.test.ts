// E2 eng-debt 测试补差（契约 docs/acceptance/e2-eng-debt.md §范围③）。
// zipExport.ts 的导出 v2 三 JSON / manifest.version===2 / round-trip 已由
// zipImport.test.ts 覆盖，本文件**不重复**，只补 markdown/工具函数层空白：
// - buildEntryMarkdown（经 exportEntryZip 产物 entries/<id>.md 断言）：
//   纯媒体条目（无文本 part 不崩：transcript 兜底标题/正文；无 transcript → （无标题）/（无正文））、
//   多文本 part '\n\n' 拼接、titleSuggestion 优先、ai 类别/标签/摘要行（label 解析 + 未知 slug 兜底）、
//   location 有/无 → 输出逐字节相同（characterization：markdown 不渲染 location，真源在 entries.json）。
// - extFromType（经 media/<ref>.<ext> 文件名断言）：已知 mime 映射全表 + part.mime 优先 /
//   blob.type 兜底 / 未知 → bin。
// - buildZip/crc32 已知向量：固定字节 "123456789" → 标准 CRC-32 校验值 0xCBF43926，
//   逐字段钉 local/central header + EOCD 结构（不重实现 zip 读写器）。
// - exportEntryZip 单条 manifest v1（version:1 + entryId，全局 v2 manifest 不在本文件断言）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Category, Entry, EntryAi, EntryPart, Tag } from '@/domain/types'

// ── di / fileShare mock（模式照 zipImport.test.ts）───────────────────────────
const storeMocks = vi.hoisted(() => ({ getMedia: vi.fn() }))
vi.mock('@/app/di', () => ({ di: { storage: storeMocks, llm: {} } }))

const shareMocks = vi.hoisted(() => ({ saved: [] as { blob: Blob; name: string }[] }))
vi.mock('@/adapters/fileShare', () => ({
  saveBlob: (blob: Blob, name: string) => {
    shareMocks.saved.push({ blob, name })
    return Promise.resolve({ ok: true, method: 'download' })
  },
  canShareFiles: () => false,
}))

import { exportEntryZip } from '@/adapters/zipExport'
import { parseZip } from '@/adapters/zipImport'
import { useUiStore } from '@/app/store'

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
const CATS: Category[] = [{ slug: 'idea', label: '想法', aliases: [], usageCount: 1, createdAt: '2026-09-01T00:00:00.000Z' }]
const TAGS: Tag[] = [{ slug: 't1', label: 't-one', usageCount: 1, createdAt: '2026-09-01T00:00:00.000Z' }]

// 把条目塞进 store 并跑一次单条导出，返回解析后的 zip 文件表。
async function exportAndParse(entry: Entry, ai?: EntryAi): Promise<Map<string, Uint8Array>> {
  useUiStore.setState({
    hydrated: true,
    entries: [entry],
    aiByEntry: ai ? { [entry.id]: ai } : {},
    categories: CATS,
    tags: TAGS,
  })
  const result = await exportEntryZip(entry.id)
  expect(result.ok).toBe(true)
  expect(shareMocks.saved).toHaveLength(1)
  expect(shareMocks.saved[0].name).toBe(`aiji-entry-${entry.id}.zip`)
  const zip = new Uint8Array(await shareMocks.saved[0].blob.arrayBuffer())
  return parseZip(zip)
}
async function markdownOf(entry: Entry, ai?: EntryAi): Promise<string> {
  const files = await exportAndParse(entry, ai)
  const md = files.get(`entries/${entry.id}.md`)
  expect(md).toBeDefined()
  return dec.decode(md)
}

beforeEach(() => {
  storeMocks.getMedia.mockReset()
  storeMocks.getMedia.mockResolvedValue(null) // 默认无媒体：markdown 用例只看 md + manifest
  shareMocks.saved.length = 0
})

// ── buildEntryMarkdown ──────────────────────────────────────────────────────
describe('buildEntryMarkdown（经 exportEntryZip）', () => {
  it('纯媒体条目（无文本 part）不崩：标题/正文取首个非文本 part 的 transcript', async () => {
    const transcript = '这是一段很长的语音转写内容超过十六个字'
    const md = await markdownOf(
      makeEntry({ id: 'm1', parts: [{ type: 'audio', ref: 'r1', durationSec: 3, transcript, mime: 'audio/webm' }] }),
    )
    expect(md).toContain(`## ${transcript.slice(0, 16)}`)
    expect(md).toContain(transcript)
    expect(md).not.toContain('（无标题）')
    expect(md).not.toContain('（无正文）')
    expect(md).not.toContain('>') // 无 ai → 无元信息行
    expect(md.endsWith('---\n')).toBe(true)
  })

  it('纯媒体条目且无 transcript：标题（无标题）、正文（无正文）', async () => {
    const md = await markdownOf(
      makeEntry({ id: 'm2', parts: [{ type: 'video', ref: 'r2', durationSec: 5, mime: 'video/mp4' }] }),
    )
    expect(md).toContain('## （无标题）')
    expect(md).toContain('（无正文）')
  })

  it('文本条目：标题取首个文本 part 前 16 字；多文本 part 以空行拼接', async () => {
    const md = await markdownOf(
      makeEntry({
        id: 't1x',
        parts: [
          { type: 'text', content: '第一段文字内容' },
          { type: 'text', content: '第二段文字内容' },
        ],
      }),
    )
    expect(md).toContain('## 第一段文字内容')
    expect(md).toContain('第一段文字内容\n\n第二段文字内容')
    expect(md).toContain('_2026-09-01T08:00:00.000Z_')
  })

  it('ai.titleSuggestion 优先于文本兜底标题', async () => {
    const md = await markdownOf(
      makeEntry({ id: 't2x', parts: [{ type: 'text', content: '正文兜底标题候选' }] }),
      makeAi('t2x', { titleSuggestion: 'AI 起的标题' }),
    )
    expect(md).toContain('## AI 起的标题')
    expect(md).not.toContain('## 正文兜底标题候选')
  })

  it('ai 元信息行：类别/标签走 label 解析，未知 slug 原样兜底，摘要尾随', async () => {
    const md = await markdownOf(
      makeEntry({ id: 't3x' }),
      makeAi('t3x', { category: 'idea', tags: ['t1', 'ghost'], summary: '这是摘要' }),
    )
    expect(md).toContain('> 类别：想法 · 标签：t-one、ghost · 摘要：这是摘要')
  })

  it('ai 缺 category/summary 且 tags 为空 → 无元信息行', async () => {
    const md = await markdownOf(
      makeEntry({ id: 't4x' }),
      makeAi('t4x', { category: '', tags: [], summary: undefined }),
    )
    expect(md).not.toContain('>')
  })

  it('location 有/无 → markdown 逐字节相同（当前实现不渲染 location）', async () => {
    const base = makeEntry({ id: 'loc1' })
    const withLoc = { ...base, location: { lat: 39.99, lng: 116.48, address: '北京市朝阳区' } }
    const mdWithout = await markdownOf(base)
    shareMocks.saved.length = 0
    const mdWith = await markdownOf(withLoc)
    expect(mdWith).toBe(mdWithout)
  })
})

// ── extFromType（经 media/<ref>.<ext> 文件名）──────────────────────────────
describe('extFromType mime → 扩展名', () => {
  it('已知 mime 映射全表 + 大小写归一 + part.mime 优先 / blob.type 兜底 / 未知 → bin', async () => {
    const cases: [string, string | undefined, string, string][] = [
      // [ref, part.mime, blob.type, 期望扩展名]
      ['r-png', 'image/png', '', 'png'],
      ['r-jpg', 'IMAGE/JPEG', '', 'jpg'], // 大写 → toLowerCase 命中
      ['r-webp', 'image/webp', '', 'webp'],
      ['r-gif', 'image/gif', '', 'gif'],
      ['r-heic', 'image/heic', '', 'heic'],
      ['r-bmp', 'image/bmp', '', 'bmp'],
      ['r-webm', 'audio/webm', '', 'webm'],
      ['r-mp4', 'video/mp4', '', 'mp4'],
      ['r-mpeg', 'audio/mpeg', '', 'mp3'],
      ['r-ogg', 'audio/ogg', '', 'ogg'],
      ['r-wav', 'audio/wav', '', 'wav'],
      ['r-flac', 'audio/flac', '', 'flac'],
      ['r-aac', 'audio/aac', '', 'aac'],
      ['r-bin', 'application/octet-stream', '', 'bin'], // 未知 → bin
      ['r-blobtype', undefined, 'audio/webm', 'webm'], // part.mime 缺省 → blob.type 兜底
      ['r-empty', undefined, '', 'bin'], // 两者皆空 → bin
    ]
    const parts: EntryPart[] = cases.map(([ref, mime]) => ({
      type: 'audio',
      ref,
      durationSec: 1,
      ...(mime !== undefined ? { mime } : {}),
    }))
    storeMocks.getMedia.mockImplementation(async (ref: string) => {
      const c = cases.find(([r]) => r === ref)
      return new Blob([new Uint8Array([1])], { type: c?.[2] ?? '' })
    })

    const files = await exportAndParse(makeEntry({ id: 'ext1', parts }))
    for (const [ref, , , ext] of cases) {
      expect(files.has(`media/${ref}.${ext}`), `media/${ref}.${ext}`).toBe(true)
    }
  })
})

// ── buildZip / crc32 已知向量 ───────────────────────────────────────────────
function indexOfSub(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

describe('buildZip / crc32（固定字节 → 固定 CRC）', () => {
  // CRC-32 标准向量防回归（e2-crc 修复后钉标准行为）：
  // 官方 check 向量 "123456789" → 0xCBF43926、"a" → 0xE8B7BE43、空 → 0
  // （python zlib.crc32 地面真相）。双独立字节模式向量等效钉住整张 CRC 表
  // （表模块私有无法直取 table[1]===0x77073096，向量同效）。
  // 历史 bug：zipExport.ts:15 else 分支曾误写 `c >>> 0`（恒等不位移）→ 全表错，
  // "123456789" 曾产 0x12AA29D8；zipImport.test.ts 镜像同错相抵 + parseZip 不校验
  // CRC 双重掩盖。本测试即防其回潮。
  it('媒体字节 "123456789"+"a" → CRC-32 标准校验值，local/central/EOCD 结构逐字段钉死', async () => {
    const STANDARD_CRC = 0xcbf43926 // zlib.crc32(b'123456789')
    const STANDARD_CRC_A = 0xe8b7be43 // zlib.crc32(b'a')——第二向量防表回归
    const payload = enc.encode('123456789') // CRC-32/ISO-HDLC 官方 check 向量
    const payloadA = enc.encode('a')
    storeMocks.getMedia.mockImplementation(async (ref: string) =>
      ref === 'rv' ? new Blob([payload]) : new Blob([payloadA]),
    )
    const entry = makeEntry({
      id: 'crc1',
      parts: [
        { type: 'text', content: 'x' },
        { type: 'audio', ref: 'rv', durationSec: 1, mime: 'audio/webm' },
        { type: 'audio', ref: 'ra', durationSec: 1, mime: 'audio/webm' },
      ],
    })
    useUiStore.setState({ hydrated: true, entries: [entry], aiByEntry: {}, categories: [], tags: [] })
    const result = await exportEntryZip('crc1')
    expect(result.ok).toBe(true)
    const zip = new Uint8Array(await shareMocks.saved[0].blob.arrayBuffer())

    const name = enc.encode('media/rv.webm')
    const nameIdx = indexOfSub(zip, name)
    expect(nameIdx).toBeGreaterThanOrEqual(30)

    // local file header（name 前 30 字节）
    const lh = nameIdx - 30
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(dv.getUint32(lh, true)).toBe(0x04034b50) // local header signature
    expect(dv.getUint16(lh + 4, true)).toBe(20) // version needed
    expect(dv.getUint16(lh + 8, true)).toBe(0) // method: STORE
    expect(dv.getUint32(lh + 14, true)).toBe(STANDARD_CRC)
    expect(dv.getUint32(lh + 18, true)).toBe(9) // compressed size
    expect(dv.getUint32(lh + 22, true)).toBe(9) // uncompressed size
    expect(dv.getUint16(lh + 26, true)).toBe(name.length)
    expect(dv.getUint16(lh + 28, true)).toBe(0) // extra field length
    // 数据紧随文件名，逐字节一致（用 decode 比对，规避 jsdom 跨 realm TypedArray
    // toEqual 假阴性——zipImport.test.ts 用 spread 同理）
    expect(dec.decode(zip.slice(nameIdx + name.length, nameIdx + name.length + 9))).toBe('123456789')

    // central directory 同名条目：签名 + 同 CRC + 指回 local header 偏移
    const cdNameIdx = indexOfSub(zip, name, nameIdx + name.length)
    expect(cdNameIdx).toBeGreaterThan(nameIdx)
    const cd = cdNameIdx - 46
    expect(dv.getUint32(cd, true)).toBe(0x02014b50)
    expect(dv.getUint32(cd + 16, true)).toBe(STANDARD_CRC)
    expect(dv.getUint32(cd + 42, true)).toBe(lh) // relative offset of local header

    // 第二向量 "a"（media/ra.webm）：local header CRC = zlib.crc32(b'a')
    const nameA = enc.encode('media/ra.webm')
    const nameAIdx = indexOfSub(zip, nameA)
    expect(nameAIdx).toBeGreaterThanOrEqual(30)
    const lhA = nameAIdx - 30
    expect(dv.getUint32(lhA, true)).toBe(0x04034b50)
    expect(dv.getUint32(lhA + 14, true)).toBe(STANDARD_CRC_A)
    expect(dv.getUint32(lhA + 18, true)).toBe(1)
    expect(dv.getUint32(lhA + 22, true)).toBe(1)

    // EOCD：末尾 22 字节，条目数 = 4（md + 2 media + manifest）
    const eocd = zip.length - 22
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50)
    expect(dv.getUint16(eocd + 8, true)).toBe(4)
    expect(dv.getUint16(eocd + 10, true)).toBe(4)
  })

  it('空字节媒体 → CRC 0（0 长度数据的 CRC-32 定义值）', async () => {
    storeMocks.getMedia.mockResolvedValue(new Blob([new Uint8Array(0)]))
    const entry = makeEntry({ id: 'crc0', parts: [{ type: 'audio', ref: 'rz', durationSec: 1, mime: 'audio/webm' }] })
    useUiStore.setState({ hydrated: true, entries: [entry], aiByEntry: {}, categories: [], tags: [] })
    await exportEntryZip('crc0')
    const zip = new Uint8Array(await shareMocks.saved[0].blob.arrayBuffer())
    const nameIdx = indexOfSub(zip, enc.encode('media/rz.webm'))
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(dv.getUint32(nameIdx - 30 + 14, true)).toBe(0)
    expect(dv.getUint32(nameIdx - 30 + 18, true)).toBe(0)
  })
})

// ── exportEntryZip 单条 manifest v1 ─────────────────────────────────────────
describe('exportEntryZip manifest', () => {
  it('单条导出 manifest：version 1 + entryId（区别于全局导出 v2，后者 zipImport.test 已覆盖）', async () => {
    const files = await exportAndParse(makeEntry({ id: 'man1' }))
    const manifest = JSON.parse(dec.decode(files.get('manifest.json'))) as { version: number; entryId: string }
    expect(manifest.version).toBe(1)
    expect(manifest.entryId).toBe('man1')
  })
})
