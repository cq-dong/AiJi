import { seedCategories, seedEntries, seedEntryAi, seedTags } from '@/data/seed'
import type { Category, Entry, EntryAi } from '@/domain/types'

export interface SearchResult {
  entry: Entry
  ai?: EntryAi
  category?: Category
}

const catBySlug = new Map(seedCategories.map((c) => [c.slug, c]))
const aiByEntry = new Map(seedEntryAi.map((a) => [a.entryId, a]))
const tagLabel = new Map(seedTags.map((t) => [t.slug, t.label]))

// Anchor "today" to the newest entry's day so seed dates read as 今天/昨天/M/D
// the way the design intends, regardless of the real wall clock.
export const TODAY_REF = (() => {
  const latest = seedEntries.reduce((m, e) => Math.max(m, new Date(e.createdAt).getTime()), 0)
  const d = new Date(latest)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
})()

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

export function formatRelativeTime(iso: string, now: Date = TODAY_REF): string {
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
// every part, plus the AI's title/summary/tags(slag+label)/category(slug+label).
export function searchEntries(query: string, entries: Entry[]): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return entries
    .filter((e) => {
      const ai = aiByEntry.get(e.id)
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
      const ai = aiByEntry.get(e.id)
      return { entry: e, ai, category: ai ? catBySlug.get(ai.category) : undefined }
    })
}
