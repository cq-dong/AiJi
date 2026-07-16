import type { Aggregate, AggregateScopeType, Category, EntryAi } from '@/domain/types'

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

// ── 期间导航（1b 根因：过去时段从未被 recompute 命中）──────────────────────
// range 字符串必须与 store.scopeRange 逐字一致，"当前"才对得上 store 无 range 的
// recomputeAggregate(scope) 调用（W28/W27/2026-07-15 等都靠此匹配）。
export function scopeRange(scope: AggregateScopeType, ref: Date): string {
  const y = ref.getFullYear()
  const m = String(ref.getMonth() + 1).padStart(2, '0')
  const d = String(ref.getDate()).padStart(2, '0')
  if (scope === 'day') return `${y}-${m}-${d}`
  if (scope === 'month') return `${y}-${m}`
  const tmp = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()))
  const dayNum = (tmp.getUTCDay() + 6) % 7
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3)
  const isoYear = tmp.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const week = 1 + Math.round(((tmp.getTime() - firstThursday.getTime()) / 86400000 - 3) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

// Shift a reference date by N whole periods (day=±1d, week=±7d, month=±1 month).
export function shiftRef(scope: AggregateScopeType, ref: Date, periods: number): Date {
  const next = new Date(ref)
  if (scope === 'day') next.setDate(next.getDate() + periods)
  else if (scope === 'month') next.setMonth(next.getMonth() + periods)
  else next.setDate(next.getDate() + periods * 7)
  return next
}

// Friendly navigator label for the selected period, anchored at ref.
export function periodLabel(scope: AggregateScopeType, ref: Date, isCurrent: boolean): string {
  if (scope === 'day') {
    return isCurrent ? '今日' : fmtMD(ref)
  }
  if (scope === 'month') {
    const base = `${ref.getFullYear()}年${ref.getMonth() + 1}月`
    return isCurrent ? `本月 · ${base}` : base
  }
  const end = startOfDay(ref)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  const base = `${fmtMD(start)}–${fmtMD(end)}`
  return isCurrent ? `本周 · ${base}` : base
}
