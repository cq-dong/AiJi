import type { Aggregate, Category, EntryAi } from '@/domain/types'

// Seed "today" — anchors relative labels (本周/今日) and 7-day windows.
const TODAY = new Date('2026-07-15T00:00:00+08:00')

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

function fmtMD(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function fmtMDHM(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${fmtMD(d)} ${hh}:${mm}`
}

export interface ScopeDisplay {
  label: string
  range: string
}

// Derive a human label + range from the aggregate's scope + createdAt.
// Weeks render as the 7-day window ending on createdAt (matches seed ranges
// 7/9–7/15 / 7/2–7/8); a day renders as M/D, labelled 今日 when == today.
export function scopeDisplay(ag: Aggregate): ScopeDisplay {
  const created = new Date(ag.createdAt)
  if (ag.scope.type === 'day') {
    return {
      label: sameDay(created, TODAY) ? '今日' : fmtMD(created),
      range: fmtMD(created),
    }
  }
  const end = startOfDay(created)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  const includesToday =
    start.getTime() <= TODAY.getTime() && TODAY.getTime() <= end.getTime()
  return {
    label: includesToday ? '本周' : '上周',
    range: `${fmtMD(start)}–${fmtMD(end)}`,
  }
}

export function formatCreated(iso: string): string {
  return fmtMDHM(iso)
}

export function friendlyModel(modelUsed: string): string {
  const m = modelUsed.toLowerCase()
  if (m.startsWith('deepseek')) return 'DeepSeek'
  if (m.startsWith('gpt') || m.startsWith('openai')) return 'OpenAI'
  if (m.includes('claude') || m.includes('anthropic')) return 'Claude'
  return modelUsed
}

export type ChipTone = 'idea' | 'project' | 'pending' | 'fail'

export interface ChipInfo {
  label: string
  tone: ChipTone
}

// Top-2 categories among the aggregate's linked entries, via EntryAi.category.
export function aggregateChips(
  ag: Aggregate,
  entryAi: EntryAi[],
  categories: Category[],
): ChipInfo[] {
  const catBySlug = new Map(categories.map((c) => [c.slug, c]))
  const aiByEntry = new Map(entryAi.map((a) => [a.entryId, a]))
  const counts = new Map<string, number>()
  for (const eid of ag.entryIds) {
    const ai = aiByEntry.get(eid)
    if (!ai) continue
    counts.set(ai.category, (counts.get(ai.category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([slug]) => {
      const cat = catBySlug.get(slug)
      const tone: ChipTone =
        cat?.accent === 'catProject'
          ? 'project'
          : cat?.accent === 'catPending'
            ? 'pending'
            : cat?.accent === 'catFail'
              ? 'fail'
              : 'idea'
      return { label: cat?.label ?? slug, tone }
    })
}
