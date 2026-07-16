// F2 · 可恢复 .zip 导出：手写 STORE method（无压缩）+ CRC32 + local/central/EOCD 头。
// 不引新 npm 依赖。读 store 快照（entries/aiByEntry/categories/tags）+ 每条 media blob
// （di.storage.getMedia），打 entries/<id>.md + media/<ref>.<ext> + ai.json + manifest.json。
import { di } from '@/app/di'
import { useUiStore } from '@/app/store'
import type { Entry, EntryAi } from '@/domain/types'

// CRC32 table (polynomial 0xEDB88320, standard zip CRC)
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 0
    }
    table[i] = c
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

// DOS date/time encoding for zip entries (2-byte time + 2-byte date)
function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    (Math.floor(d.getSeconds() / 2) & 0x1f) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getHours() & 0x1f) << 11)
  const date =
    (d.getDate() & 0x1f) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (((d.getFullYear() - 1980) & 0x7f) << 9)
  return { time, date }
}

interface ZipFile {
  name: string
  data: Uint8Array
}

// Build a zip archive using STORE method (no compression) with CRC32.
// Layout: [local file header + filename + data]... [central directory]... [EOCD]
function buildZip(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(new Date())

  // Pre-encode filenames and compute per-file metadata
  const meta = files.map((f) => {
    const nameBytes = enc.encode(f.name)
    const crc = crc32(f.data)
    return {
      name: nameBytes,
      data: f.data,
      crc,
      size: f.data.length,
    }
  })

  // Local headers + file data
  const localChunks: Uint8Array[] = []
  let offset = 0
  const offsets: number[] = []
  for (const m of meta) {
    offsets.push(offset)
    const header = new Uint8Array(30)
    const dv = new DataView(header.buffer)
    dv.setUint32(0, 0x04034b50, true) // local file header signature
    dv.setUint16(4, 20, true) // version needed to extract (2.0)
    dv.setUint16(6, 0, true) // general purpose bit flag
    dv.setUint16(8, 0, true) // compression method: STORE (0)
    dv.setUint16(10, time, true) // last mod file time
    dv.setUint16(12, date, true) // last mod file date
    dv.setUint32(14, m.crc, true) // CRC-32
    dv.setUint32(18, m.size, true) // compressed size (= uncompressed for STORE)
    dv.setUint32(22, m.size, true) // uncompressed size
    dv.setUint16(26, m.name.length, true) // file name length
    dv.setUint16(28, 0, true) // extra field length
    const chunk = new Uint8Array(30 + m.name.length + m.data.length)
    chunk.set(header, 0)
    chunk.set(m.name, 30)
    chunk.set(m.data, 30 + m.name.length)
    localChunks.push(chunk)
    offset += chunk.length
  }

  // Central directory
  const cdChunks: Uint8Array[] = []
  let cdSize = 0
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]
    const entry = new Uint8Array(46 + m.name.length)
    const dv = new DataView(entry.buffer)
    dv.setUint32(0, 0x02014b50, true) // central file header signature
    dv.setUint16(4, 20, true) // version made by
    dv.setUint16(6, 20, true) // version needed to extract
    dv.setUint16(8, 0, true) // general purpose bit flag
    dv.setUint16(10, 0, true) // compression method: STORE (0)
    dv.setUint16(12, time, true) // last mod file time
    dv.setUint16(14, date, true) // last mod file date
    dv.setUint32(16, m.crc, true) // CRC-32
    dv.setUint32(20, m.size, true) // compressed size
    dv.setUint32(24, m.size, true) // uncompressed size
    dv.setUint16(28, m.name.length, true) // file name length
    dv.setUint16(30, 0, true) // extra field length
    dv.setUint16(32, 0, true) // file comment length
    dv.setUint16(34, 0, true) // disk number start
    dv.setUint16(36, 0, true) // internal file attributes
    dv.setUint32(38, 0, true) // external file attributes
    dv.setUint32(42, offsets[i], true) // relative offset of local header
    entry.set(m.name, 46)
    cdChunks.push(entry)
    cdSize += entry.length
  }

  // End of central directory record
  const eocd = new Uint8Array(22)
  const eocdDv = new DataView(eocd.buffer)
  eocdDv.setUint32(0, 0x06054b50, true) // EOCD signature
  eocdDv.setUint16(4, 0, true) // number of this disk
  eocdDv.setUint16(6, 0, true) // disk where central directory starts
  eocdDv.setUint16(8, files.length, true) // number of central directory records on this disk
  eocdDv.setUint16(10, files.length, true) // total number of central directory records
  eocdDv.setUint32(12, cdSize, true) // size of central directory
  eocdDv.setUint32(16, offset, true) // offset of start of central directory
  eocdDv.setUint16(20, 0, true) // comment length

  // Assemble all parts
  const localSize = localChunks.reduce((s, c) => s + c.length, 0)
  const total = localSize + cdSize + 22
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of localChunks) {
    out.set(c, pos)
    pos += c.length
  }
  for (const c of cdChunks) {
    out.set(c, pos)
    pos += c.length
  }
  out.set(eocd, pos)
  return out
}

// Derive file extension from blob.type (MIME). Unknown → .bin
function extFromType(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('webm')) return 'webm'
  if (t.includes('mp4')) return 'mp4'
  if (t.includes('mpeg')) return 'mp3'
  if (t.includes('ogg')) return 'ogg'
  if (t.includes('wav')) return 'wav'
  if (t.includes('flac')) return 'flac'
  if (t.includes('aac')) return 'aac'
  return 'bin'
}

// Single-entry markdown — mirrors settings buildExportMarkdown per-entry format.
function buildEntryMarkdown(
  entry: Entry,
  ai: EntryAi | undefined,
  catLabel: (slug: string) => string,
  tagLabel: (slug: string) => string,
): string {
  const firstText = entry.parts.find((p) => p.type === 'text')?.content
  const firstTranscript = entry.parts.find((p) => p.type !== 'text')?.transcript
  const fallbackTitle = (firstText ?? firstTranscript ?? '').slice(0, 16)
  const title = ai?.titleSuggestion || fallbackTitle || '（无标题）'
  const lines: string[] = []
  lines.push(`## ${title}`)
  lines.push('')
  lines.push(`_${entry.createdAt}_`)
  lines.push('')
  const bodyLines: string[] = []
  for (const p of entry.parts) {
    if (p.type === 'text') bodyLines.push(p.content)
    else if (p.transcript) bodyLines.push(p.transcript)
  }
  lines.push(bodyLines.join('\n\n') || '（无正文）')
  lines.push('')
  if (ai) {
    const bits: string[] = []
    if (ai.category) bits.push(`类别：${catLabel(ai.category)}`)
    if (ai.tags.length) bits.push(`标签：${ai.tags.map(tagLabel).join('、')}`)
    if (ai.summary) bits.push(`摘要：${ai.summary}`)
    if (bits.length) {
      lines.push(`> ${bits.join(' · ')}`)
      lines.push('')
    }
  }
  lines.push('---')
  lines.push('')
  return lines.join('\n')
}

export async function exportZip(): Promise<void> {
  const { entries, aiByEntry, categories, tags } = useUiStore.getState()
  const catLabel = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? slug
  const tagLabel = (slug: string) => tags.find((t) => t.slug === slug)?.label ?? slug
  const sorted = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const files: ZipFile[] = []
  const enc = new TextEncoder()

  // entries/<id>.md — one markdown file per entry
  for (const e of sorted) {
    const md = buildEntryMarkdown(e, aiByEntry[e.id], catLabel, tagLabel)
    files.push({ name: `entries/${e.id}.md`, data: enc.encode(md) })
  }

  // media/<ref>.<ext> — binary media blobs from OPFS
  const mediaRefs = new Set<string>()
  for (const e of entries) {
    for (const p of e.parts) {
      if (p.type === 'audio' || p.type === 'video') mediaRefs.add(p.ref)
    }
  }
  for (const ref of mediaRefs) {
    try {
      const blob = await di.storage.getMedia(ref)
      if (!blob) continue
      const buf = new Uint8Array(await blob.arrayBuffer())
      files.push({ name: `media/${ref}.${extFromType(blob.type)}`, data: buf })
    } catch (e) {
      console.error('[exportZip] getMedia failed for ' + ref, e)
    }
  }

  // ai.json — full aiByEntry map
  files.push({ name: 'ai.json', data: enc.encode(JSON.stringify(aiByEntry, null, 2)) })

  // manifest.json — recoverability metadata
  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entryCount: entries.length,
    schema: {
      entries: 'Entry[] as markdown in entries/<id>.md',
      media: 'Binary media blobs in media/<ref>.<ext>',
      ai: 'EntryAi map (entryId -> EntryAi) in ai.json',
      description: 'AiJi export — entries as markdown + media blobs + AI metadata + manifest for recoverability',
    },
  }
  files.push({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)) })

  const zip = buildZip(files)
  const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'aiji-export.zip'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Wave 4: per-entry export + share ──────────────────────────────────────
// Reuses buildEntryMarkdown + buildZip (global export internals). detail screen TopBar
// 「更多」wires to exportEntryZip (download single-entry .zip) + shareEntry (Web Share text).

function entryContext(id: string) {
  const { entries, aiByEntry, categories, tags } = useUiStore.getState()
  const entry = entries.find((e) => e.id === id)
  if (!entry) return undefined
  const catLabel = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? slug
  const tagLabel = (slug: string) => tags.find((t) => t.slug === slug)?.label ?? slug
  return { entry, ai: aiByEntry[id], catLabel, tagLabel }
}

// Single-entry .zip: entries/<id>.md + media/<ref>.<ext> + manifest.json. Mirrors global exportZip.
export async function exportEntryZip(id: string): Promise<void> {
  const ctx = entryContext(id)
  if (!ctx) return
  const { entry, ai, catLabel, tagLabel } = ctx
  const enc = new TextEncoder()
  const files: ZipFile[] = [
    { name: `entries/${entry.id}.md`, data: enc.encode(buildEntryMarkdown(entry, ai, catLabel, tagLabel)) },
  ]
  const mediaRefs = new Set<string>()
  for (const p of entry.parts) {
    if (p.type === 'audio' || p.type === 'video') mediaRefs.add(p.ref)
  }
  for (const ref of mediaRefs) {
    try {
      const blob = await di.storage.getMedia(ref)
      if (!blob) continue
      files.push({ name: `media/${ref}.${extFromType(blob.type)}`, data: new Uint8Array(await blob.arrayBuffer()) })
    } catch (e) {
      console.error('[exportEntryZip] getMedia failed for ' + ref, e)
    }
  }
  files.push({
    name: 'manifest.json',
    data: enc.encode(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entryId: id, schema: 'single-entry zip (markdown + media)' }, null, 2)),
  })
  const zip = buildZip(files)
  const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aiji-entry-${entry.id}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Web Share API available (mobile share sheet). UI gates the 分享 button on this.
export function canShareEntry(): boolean {
  return typeof (navigator as unknown as { share?: unknown }).share === 'function'
}

// Share a single entry as text (markdown). navigator.share → system share sheet;
// clipboard.writeText fallback (desktop / unsupported). Returns how it was shared.
export async function shareEntry(id: string): Promise<{ shared: boolean; method: 'share' | 'clipboard' | 'none' }> {
  const ctx = entryContext(id)
  if (!ctx) return { shared: false, method: 'none' }
  const { entry, ai, catLabel, tagLabel } = ctx
  const md = buildEntryMarkdown(entry, ai, catLabel, tagLabel)
  const fallbackTitle = (entry.parts.find((p) => p.type === 'text')?.content ?? '').slice(0, 16)
  const title = ai?.titleSuggestion || fallbackTitle || 'AiJi 条目'
  const nav = navigator as unknown as { share?: (opts: { title: string; text: string }) => Promise<void> }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, text: md })
      return { shared: true, method: 'share' }
    } catch {
      // user dismissed the share sheet — fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(md)
    return { shared: true, method: 'clipboard' }
  } catch {
    return { shared: false, method: 'none' }
  }
}
