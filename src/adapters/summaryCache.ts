// D6: localStorage-backed summary cache.
// Avoids re-hitting the LLM on every summary-page entry when a digest was already
// generated. Tiered refresh strategy (per D6 spec):
// - day: entry count changed (new/deleted entries filed to this day) → refresh
// - week: generatedAt crossed a day boundary → refresh (daily auto-update)
// - month: generatedAt crossed an ISO-week boundary → refresh (weekly auto-update)
// Manual refresh (重新生成 button) calls clear() to bypass the cache.
//
// Intentionally localStorage (not Dexie) — keeps this self-contained and avoids
// touching src/adapters/dexieStorage.ts (separate owner's exclusive file boundary).
// localStorage is synchronous → enables 秒开 render before Dexie hydrate / async
// aggregate reads resolve.

import { scopeRange } from '@/domain/dateRange'
import type { AggregateScopeType } from '@/domain/types'

export interface CachedSummary {
  content: string
  generatedAt: string // ISO timestamp when the digest was generated
  entryCount: number // entries filed to this period at generation time (day-scope refresh signal)
  highlights?: string[]
  modelUsed?: string
  detailLevel?: number
}

const PREFIX = 'aiji:summary'

function key(type: AggregateScopeType, dateKey: string): string {
  return `${PREFIX}:${type}:${dateKey}`
}

export function get(type: AggregateScopeType, dateKey: string): CachedSummary | null {
  try {
    const raw = localStorage.getItem(key(type, dateKey))
    if (!raw) return null
    return JSON.parse(raw) as CachedSummary
  } catch {
    return null
  }
}

export function set(type: AggregateScopeType, dateKey: string, data: CachedSummary): void {
  try {
    localStorage.setItem(key(type, dateKey), JSON.stringify(data))
  } catch (e) {
    console.error('[summaryCache] set failed', e)
  }
}

export function clear(type: AggregateScopeType, dateKey: string): void {
  try {
    localStorage.removeItem(key(type, dateKey))
  } catch (e) {
    console.error('[summaryCache] clear failed', e)
  }
}

// Tiered refresh strategy (D6):
// - day: cached.entryCount !== currentEntryCount → refresh (new/deleted entries)
// - week: generatedAt's day-key != today's day-key → refresh (daily auto-update)
// - month: generatedAt's week-key != current week-key → refresh (weekly auto-update)
// currentEntryCount is only consulted for 'day' scope (pass 0 for week/month — ignored).
// Uses scopeRange from @/domain/dateRange so week keys share one ISO algorithm with
// the summary navigator / store (no drift between cache key and filed-entry key).
export function shouldRefresh(
  type: AggregateScopeType,
  dateKey: string,
  currentEntryCount: number,
): boolean {
  const cached = get(type, dateKey)
  if (!cached) return true
  const generatedAt = new Date(cached.generatedAt)
  const now = new Date()
  if (type === 'day') {
    return cached.entryCount !== currentEntryCount
  }
  if (type === 'week') {
    // Cross-day: generatedAt's day range != today's day range.
    return scopeRange('day', generatedAt) !== scopeRange('day', now)
  }
  // month — cross-week: generatedAt's ISO week != current ISO week.
  return scopeRange('week', generatedAt) !== scopeRange('week', now)
}
