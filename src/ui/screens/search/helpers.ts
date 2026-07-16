import type { Category, Entry, EntryAi, Tag } from '@/domain/types'

export interface SearchResult {
  entry: Entry
  ai?: EntryAi
  category?: Category
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
