import type { Category, Entry, EntryAi, PartType, Tag } from '@/domain/types'

export interface SearchResult {
  entry: Entry
  ai?: EntryAi
  category?: Category
}

// Filter facet selections. `undefined`/`'all'` means "no filter on this axis".
// Dates are grouped by YYYY-M-D bucket strings derived from entry.createdAt.
export interface SearchFilters {
  category: string // 'all' or a category slug
  tag: string // 'all' or a tag slug
  mood: string // 'all' or a mood string
  modality: string // 'all' | 'text' | 'audio' | 'video'
  date: string // 'all' or a 'YYYY-M-D' bucket
}

export const EMPTY_FILTERS: SearchFilters = {
  category: 'all',
  tag: 'all',
  mood: 'all',
  modality: 'all',
  date: 'all',
}

// Fixed modality chip set (text/audio/video). The design chips use Chinese labels
// but the filter compares against EntryPart.type, so slug stays the PartType union.
export const MODALITY_CHIPS: ReadonlyArray<{ slug: PartType; label: string }> = [
  { slug: 'text', label: '文本' },
  { slug: 'audio', label: '语音' },
  { slug: 'video', label: '视频' },
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

// Aggregate distinct date buckets from entries' createdAt, newest first.
// Bucket key is 'YYYY-M-D' (no zero-pad) so it matches what we compare against.
export function dateChipsFrom(entries: ReadonlyArray<Entry>): Array<{ slug: string; label: string }> {
  const seen = new Map<string, number>() // bucket -> latest timestamp
  for (const e of entries) {
    const d = new Date(e.createdAt)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const t = d.getTime()
    const prev = seen.get(key)
    if (prev === undefined || t > prev) seen.set(key, t)
  }
  return Array.from(seen.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([slug]) => {
      const [y, m, d] = slug.split('-').map(Number)
      const dt = new Date(y, m - 1, d)
      const today = new Date()
      const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const startDt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
      const diff = Math.round((startToday.getTime() - startDt.getTime()) / 86_400_000)
      const label = diff <= 0 ? '今天' : diff === 1 ? '昨天' : `${m}/${d}`
      return { slug, label }
    })
}

function dateBucket(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

// Apply the selected facets to the full-text matches returned by searchEntries.
// A result is kept iff EVERY non-'all' facet matches. No selections => all pass.
export function filterResults(
  results: SearchResult[],
  filters: SearchFilters,
  aiByEntry: Record<string, EntryAi>,
): SearchResult[] {
  const hasCat = filters.category !== 'all'
  const hasTag = filters.tag !== 'all'
  const hasMood = filters.mood !== 'all'
  const hasMod = filters.modality !== 'all'
  const hasDate = filters.date !== 'all'
  if (!hasCat && !hasTag && !hasMood && !hasMod && !hasDate) return results
  return results.filter((r) => {
    const ai = aiByEntry[r.entry.id]
    if (hasCat && (ai?.category ?? '') !== filters.category) return false
    if (hasTag && !(ai?.tags ?? []).includes(filters.tag)) return false
    if (hasMood && (ai?.facets.mood ?? '') !== filters.mood) return false
    if (hasMod && !r.entry.parts.some((p) => p.type === filters.modality)) return false
    if (hasDate && dateBucket(r.entry.createdAt) !== filters.date) return false
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
  if (entry.parts.some((p) => p.type === 'video')) return '视频'
  if (entry.parts.some((p) => p.type === 'audio')) return '语音'
  return '文本'
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
  if (dayDiff <= 0) return `今天 ${hh}:${mm}`
  if (dayDiff === 1) return '昨天'
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
