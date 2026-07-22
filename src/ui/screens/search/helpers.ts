import { t, type I18nKey } from '@/app/i18n'
import type { Category, Entry, EntryAi, PartType, Tag } from '@/domain/types'

export interface SearchResult {
  entry: Entry
  ai?: EntryAi
  category?: Category
}

// Filter facet selections. `undefined`/`'all'` means "no filter on this axis".
// `date` is a quick range slug; when 'custom', the dateFrom/dateTo pair holds a
// caller-chosen [start, end] range. Either axis being 'all' means "no filter".
export interface SearchFilters {
  category: string // 'all' or a category slug
  tag: string // 'all' or a tag slug
  mood: string // 'all' or a mood string
  modality: string // 'all' | 'text' | 'audio' | 'video'
  date: string // 'all' | 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'custom'
  dateFrom: string // 'YYYY-MM-DD' or '' — consulted only when date === 'custom'
  dateTo: string // 'YYYY-MM-DD' or '' — consulted only when date === 'custom'
}

export const EMPTY_FILTERS: SearchFilters = {
  category: 'all',
  tag: 'all',
  mood: 'all',
  modality: 'all',
  date: 'all',
  dateFrom: '',
  dateTo: '',
}

// Fixed modality chip set (text/audio/video). `label` is an i18n key resolved by
// the component at render (helpers run before the active language is known).
// The filter compares against EntryPart.type, so slug stays the PartType union.
export const MODALITY_CHIPS: ReadonlyArray<{ slug: PartType; label: I18nKey }> = [
  { slug: 'text', label: 'search.modality.text' },
  { slug: 'audio', label: 'search.modality.audio' },
  { slug: 'video', label: 'search.modality.video' },
]

// Aggregate distinct moods from aiByEntry (mood is an optional facet — only
// entries whose AI detected a mood contribute). Sorted alphabetically.
export function moodChipsFrom(aiByEntry: Record<string, EntryAi>): Array<{ slug: string; label: string }> {
  const set = new Set<string>()
  for (const ai of Object.values(aiByEntry)) {
    const m = ai.facets.mood
    if (m) set.add(m)
  }
  return Array.from(set)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map((m) => ({ slug: m, label: m }))
}

// Quick relative date chips. One is active at a time; the 全部 button (added by
// ChipRow) clears the axis. The custom from-to inputs live alongside — when both
// are filled, `date` switches to 'custom' and ChipRow shows no quick chip active.
// `label` is an i18n key (today/yesterday reused from common.date).
export const QUICK_DATE_CHIPS: ReadonlyArray<{ slug: DateRangeSlug; label: I18nKey }> = [
  { slug: 'today', label: 'date.today' },
  { slug: 'yesterday', label: 'date.yesterday' },
  { slug: 'thisWeek', label: 'search.date.thisWeek' },
  { slug: 'thisMonth', label: 'search.date.thisMonth' },
]

export type DateRangeSlug = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth'

// [start, end] ms for a relative range anchored to `now`. Every range ends at
// the close of "today" (23:59:59.999) so entries created later today still pass.
// 本周 starts Monday (ISO week).
export function rangeForSlug(slug: DateRangeSlug, now: Date): { start: number; end: number } | null {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const endToday = new Date(y, m, d, 23, 59, 59, 999).getTime()
  switch (slug) {
    case 'today':
      return { start: new Date(y, m, d, 0, 0, 0, 0).getTime(), end: endToday }
    case 'yesterday':
      return {
        start: new Date(y, m, d - 1, 0, 0, 0, 0).getTime(),
        end: new Date(y, m, d - 1, 23, 59, 59, 999).getTime(),
      }
    case 'thisWeek': {
      const day = new Date(y, m, d).getDay() // 0=Sun..6=Sat
      const daysSinceMonday = (day + 6) % 7
      return { start: new Date(y, m, d - daysSinceMonday, 0, 0, 0, 0).getTime(), end: endToday }
    }
    case 'thisMonth':
      return { start: new Date(y, m, 1, 0, 0, 0, 0).getTime(), end: endToday }
    default:
      return null
  }
}

// [start 00:00, end 23:59:59] ms for a caller-chosen 'YYYY-MM-DD' pair, inclusive
// on both ends. Returns null if either date is blank or malformed — callers
// treat null as "apply no date filter" (matches the spec: filter only when both set).
export function customRangeFrom(from: string, to: string): { start: number; end: number } | null {
  if (!from || !to) return null
  const a = from.split('-').map(Number)
  const b = to.split('-').map(Number)
  if (a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return null
  return {
    start: new Date(a[0], a[1] - 1, a[2], 0, 0, 0, 0).getTime(),
    end: new Date(b[0], b[1] - 1, b[2], 23, 59, 59, 999).getTime(),
  }
}

// Apply the selected facets to the full-text matches returned by searchEntries.
// A result is kept iff EVERY non-'all' facet matches. No selections => all pass.
// `now` anchors the relative date ranges (今天/昨天/本周/本月) to the wall clock.
export function filterResults(
  results: SearchResult[],
  filters: SearchFilters,
  aiByEntry: Record<string, EntryAi>,
  now: Date,
): SearchResult[] {
  const hasCat = filters.category !== 'all'
  const hasTag = filters.tag !== 'all'
  const hasMood = filters.mood !== 'all'
  const hasMod = filters.modality !== 'all'
  const dateRange =
    filters.date === 'custom'
      ? customRangeFrom(filters.dateFrom, filters.dateTo)
      : filters.date !== 'all'
        ? rangeForSlug(filters.date as DateRangeSlug, now)
        : null
  const hasDate = dateRange !== null
  if (!hasCat && !hasTag && !hasMood && !hasMod && !hasDate) return results
  return results.filter((r) => {
    const ai = aiByEntry[r.entry.id]
    if (hasCat && (ai?.category ?? '') !== filters.category) return false
    if (hasTag && !(ai?.tags ?? []).includes(filters.tag)) return false
    if (hasMood && (ai?.facets.mood ?? '') !== filters.mood) return false
    if (hasMod && !r.entry.parts.some((p) => p.type === filters.modality)) return false
    if (hasDate) {
      const t = new Date(r.entry.createdAt).getTime()
      if (t < dateRange.start || t > dateRange.end) return false
    }
    return true
  })
}

type AccentTone = 'idea' | 'project' | 'pending' | 'fail'

const ACCENT_TONE: Record<NonNullable<Category['accent']>, AccentTone> = {
  catIdea: 'idea',
  catProject: 'project',
  catPending: 'pending',
  catFail: 'fail',
}

export function accentTone(accent?: Category['accent']): AccentTone {
  return accent ? ACCENT_TONE[accent] : 'idea'
}

export function previewText(entry: Entry, ai?: EntryAi): string {
  if (ai?.summary) return ai.summary
  return entry.parts
    .map((p) => (p.type === 'text' ? p.content : p.transcript ?? ''))
    .filter(Boolean)
    .join(' ')
}

export function modality(entry: Entry): string {
  if (entry.parts.some((p) => p.type === 'video')) return t('search.modality.video')
  if (entry.parts.some((p) => p.type === 'audio')) return t('search.modality.audio')
  return t('search.modality.text')
}

// Anchor "today" to the newest entry's day so relative labels (今天/昨天/M/D)
// read the way the design intends, regardless of the real wall clock.
// Falls back to wall clock when there are no entries.
export function todayRefFrom(entries: ReadonlyArray<{ createdAt: string }>): Date {
  if (entries.length === 0) return new Date()
  let maxT = 0
  for (const e of entries) {
    const t = new Date(e.createdAt).getTime()
    if (t > maxT) maxT = t
  }
  const d = new Date(maxT)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function formatRelativeTime(iso: string, now: Date): string {
  const d = new Date(iso)
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((startNow.getTime() - startD.getTime()) / 86_400_000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (dayDiff <= 0) return t('search.time.todayAt', { time: `${hh}:${mm}` })
  if (dayDiff === 1) return t('date.yesterday')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// Match query against every searchable surface of an entry: raw text/transcript of
// every part, plus the AI's title/summary/tags(slug+label)/category(slug+label).
// Maps are built from store-supplied categories/tags/aiByEntry so emerging
// categories/tags (discovered by the LLM) resolve correctly.
export function searchEntries(
  query: string,
  entries: Entry[],
  categories: Category[],
  tags: Tag[],
  aiByEntry: Record<string, EntryAi>,
): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const catBySlug = new Map(categories.map((c) => [c.slug, c]))
  const aiMap = new Map(Object.entries(aiByEntry))
  const tagLabel = new Map(tags.map((t) => [t.slug, t.label]))
  return entries
    .filter((e) => {
      const ai = aiMap.get(e.id)
      const cat = ai ? catBySlug.get(ai.category) : undefined
      const hay = [
        ...e.parts.map((p) => (p.type === 'text' ? p.content : p.transcript ?? '')),
        ai?.titleSuggestion ?? '',
        ai?.summary ?? '',
        ...(ai?.tags ?? []).flatMap((s) => [s, tagLabel.get(s) ?? '']),
        ai?.category ?? '',
        cat?.label ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((e) => {
      const ai = aiMap.get(e.id)
      return { entry: e, ai, category: ai ? catBySlug.get(ai.category) : undefined }
    })
}
