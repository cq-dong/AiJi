// P-A 性能（2026-10-03）：mediaRef→objectURL 模块级缓存。设计见
// docs/superpowers/specs/2026-10-03-perf-media-cache-list-windowing.md。
// 引用计数 + LRU：refs>0 的条目（在屏媒体）永不淘汰——宁可超容不裂图；
// 零引用条目超容时按 lastUsed 淘汰并 revokeObjectURL。
// null（无 blob 的 seed 条目）也缓存、不占 CAP，避免每次挂载重复打 IndexedDB。
import { di } from '@/app/di'

const CAP = 60

interface UrlEntry {
  url: string
  mime: string
  refs: number
  lastUsed: number
}
interface NullEntry {
  url: null
  refs: number
  lastUsed: number
}
type Cached = UrlEntry | NullEntry

const cache = new Map<string, Cached>()
const inflight = new Map<string, Promise<UrlEntry | null>>()
let clock = 0

// 淘汰零引用的最旧条目。protectKey：刚插入、尚未交予调用方的条目——它 refs=0 且
// lastUsed 最小语义上却是「最新」，排除防刚发出去就被 revoke。
function evictIfNeeded(protectKey?: string): void {
  let size = 0
  for (const e of cache.values()) if (e.url !== null) size++
  if (size <= CAP) return
  const candidates = [...cache.entries()]
    .filter((kv): kv is [string, UrlEntry] => kv[0] !== protectKey && kv[1].url !== null && kv[1].refs === 0)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  for (const [key, e] of candidates) {
    if (size <= CAP) break
    URL.revokeObjectURL(e.url)
    cache.delete(key)
    size--
  }
}

async function load(mediaRef: string): Promise<UrlEntry | null> {
  const blob = await di.storage.getMedia(mediaRef)
  if (!blob) return null
  return { url: URL.createObjectURL(blob), mime: blob.type, refs: 0, lastUsed: 0 }
}

export async function acquireMediaUrl(mediaRef: string): Promise<{ url: string; mime: string } | null> {
  let entry = cache.get(mediaRef)
  if (!entry) {
    const pending = inflight.get(mediaRef)
    if (!pending) {
      const p = load(mediaRef)
      inflight.set(mediaRef, p)
      try {
        const loaded = await p
        entry = loaded ?? { url: null, refs: 0, lastUsed: 0 }
        entry.lastUsed = ++clock // 插入即盖章：淘汰按 lastUsed 排序，新条目必须是最新
        cache.set(mediaRef, entry)
        evictIfNeeded(mediaRef)
      } finally {
        inflight.delete(mediaRef)
      }
    } else {
      // 并发去重：共享 in-flight Promise，结果由首个等待者落缓存。
      await pending
      entry = cache.get(mediaRef)
      if (!entry) return null // 防御：首个等待者的加载抛错（其 catch 已清 inflight）
    }
  }
  entry.refs++
  entry.lastUsed = ++clock
  return entry.url === null ? null : { url: entry.url, mime: entry.mime }
}

export function releaseMediaUrl(mediaRef: string): void {
  const e = cache.get(mediaRef)
  if (!e) return
  e.refs = Math.max(0, e.refs - 1)
}
