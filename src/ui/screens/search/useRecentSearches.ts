import { useCallback, useSyncExternalStore } from 'react'
import { getCurrentOwner } from '@/app/currentOwner'

// 最近搜索：owner 分区 localStorage 持久化（与 dexieStorage 同 owner 语义，多账号不串）。
// 记录时机=强意图信号（点结果/Enter 提交）——live-as-you-type 的每次击键不算搜索。
// 最多 8 条，去重（大小写不敏感），最新在前。useSyncExternalStore 让多组件同源订阅。
const MAX = 8

function storageKey(): string {
  return `aiji.recentSearches.v1.${getCurrentOwner()}`
}

function read(): string[] {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, MAX)
  } catch {
    return []
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(list))
  } catch {
    // 配额满静默——最近搜索非关键数据
  }
  notify()
}

// 微型外部 store：同一 key 的多个订阅组件同步刷新（本屏 EmptySearch 单点消费，
// 但留好结构防后续 header/全局搜索复用）。
const listeners = new Set<() => void>()
function notify(): void {
  listeners.forEach((l) => l())
}

let cache: { key: string; list: string[] } | null = null
function getSnapshot(): string[] {
  const key = storageKey()
  if (cache === null || cache.key !== key) cache = { key, list: read() }
  return cache.list
}

export function useRecentSearches(): {
  recents: string[]
  addRecent: (q: string) => void
  clearRecents: () => void
} {
  const recents = useSyncExternalStore(
    useCallback((cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }, []),
    getSnapshot,
  )

  const addRecent = useCallback((q: string) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) return
    const lower = trimmed.toLowerCase()
    const next = [trimmed, ...getSnapshot().filter((x) => x.toLowerCase() !== lower)].slice(0, MAX)
    cache = { key: storageKey(), list: next }
    write(next)
  }, [])

  const clearRecents = useCallback(() => {
    cache = { key: storageKey(), list: [] }
    write([])
  }, [])

  return { recents, addRecent, clearRecents }
}
