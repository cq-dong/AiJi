import type { EntryAi, EntryPart } from '@/domain/types'

// Full days elapsed since an ISO timestamp. Used for the 30-day auto-purge
// countdown on trashed entries. Divisor is ms/day (86,400,000) — matches the
// store's purge window (hydrate purges >30d soft-deleted entries).
// (Spec text had an extra zero; 8,640,000,000 would be 100 days, broken.)
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

// First textual content from an entry's parts: text content, else audio/video
// transcript. Returns '' when the entry has no textual content (media-only).
export function entryPreview(parts: EntryPart[]): string {
  for (const p of parts) {
    if (p.type === 'text' && p.content.trim()) return p.content
    if ((p.type === 'audio' || p.type === 'video') && p.transcript?.trim()) return p.transcript
  }
  return ''
}

// Display title: AI titleSuggestion, else first 16 chars of preview, else '未命名'.
export function entryTitle(ai: EntryAi | undefined, parts: EntryPart[]): string {
  if (ai?.titleSuggestion?.trim()) return ai.titleSuggestion
  const p = entryPreview(parts)
  return p ? p.slice(0, 16) : '未命名'
}

// MM-DD formatting for an entry's original creation date (no year — screen
// is a list of recently-deleted items, year adds noise).
export function mmdd(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
