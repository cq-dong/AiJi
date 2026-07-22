import { isoWeekBounds, scopeRange, shiftRef, startOfDay } from '@/domain/dateRange'
import type { Aggregate, AggregateScopeType, Category, EntryAi } from '@/domain/types'
import { t } from '@/app/i18n'
import { getCurrentLang } from '@/app/currentLang'

// A3: scopeRange/shiftRef/isoWeekBounds/startOfDay come from @/domain/dateRange so the
// week key used to file entries and the label rendered to users share one correct ISO
// algorithm. Re-exported here for screen-local callers that already import from this module.
export { scopeRange, shiftRef }

// Seed "today" — anchors relative labels (本周/今日) and 7-day windows.
const TODAY = new Date('2026-07-15T00:00:00+08:00')

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

// Localized month-year label: zh → 「2026年7月」, en → 「July 2026」。
// 用于月期间的 base 标签（periodLabel / periodLabels 共用）。
function fmtMonthYear(d: Date): string {
  const locale = getCurrentLang() === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(d)
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
      label: sameDay(created, TODAY) ? t('summary.period.today') : fmtMD(created),
      range: fmtMD(created),
    }
  }
  const { start, end } = isoWeekBounds(created)
  const includesToday =
    start.getTime() <= TODAY.getTime() && TODAY.getTime() <= end.getTime()
  return {
    label: includesToday ? t('summary.period.thisWeek') : t('summary.period.lastWeek'),
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

// ── 期间导航 ──────────────────────────────────────────────────────────────
// scopeRange / shiftRef 由 @/domain/dateRange 提供（A3：store 与本文件共用同一
// 正确 ISO 周算法，range key 与标签不再漂移）。上方 re-export 给屏内引用。

// Friendly navigator label for the selected period, anchored at ref.
export function periodLabel(scope: AggregateScopeType, ref: Date, isCurrent: boolean): string {
  if (scope === 'day') {
    return isCurrent ? t('summary.period.today') : fmtMD(ref)
  }
  if (scope === 'month') {
    const base = fmtMonthYear(ref)
    return isCurrent ? `${t('summary.period.thisMonth')} · ${base}` : base
  }
  const { start, end } = isoWeekBounds(ref)
  const base = `${fmtMD(start)}–${fmtMD(end)}`
  return isCurrent ? `${t('summary.period.thisWeek')} · ${base}` : base
}

// ── 反向时间序列（Wave 3 user feedback #1）──────────────────────────────
// 日=14 / 周=8 / 月=6：从今日起向后走，产出 range key + 友好标签。range 字符串
// 与 store.scopeRange 逐字一致（day='2026-07-16' / week='2026-W28' / month='2026-07'）。
export const SCOPE_COUNT: Record<AggregateScopeType, number> = {
  day: 14,
  week: 8,
  month: 6,
}

export interface PeriodInfo {
  range: string // store key: '2026-07-16' / '2026-W28' / '2026-07'
  label: string // 短标签：今日/昨日/本周/上周/本月/上月 或日期
  dateLabel: string // 日期细节：7/16 / 7/10–7/16 / 2026年7月
  ref: Date
  isCurrent: boolean
}

// 短标签 + 日期标签：offset=0 当前，1 上一期（昨日/上周/上月），更早用日期。
function periodLabels(
  scope: AggregateScopeType,
  ref: Date,
  isCurrent: boolean,
  offset: number,
): { label: string; dateLabel: string } {
  if (scope === 'day') {
    const date = fmtMD(ref)
    if (isCurrent) return { label: t('summary.period.today'), dateLabel: date }
    if (offset === 1) return { label: t('summary.period.yesterday'), dateLabel: date }
    return { label: date, dateLabel: date }
  }
  if (scope === 'month') {
    const base = fmtMonthYear(ref)
    if (isCurrent) return { label: t('summary.period.thisMonth'), dateLabel: base }
    if (offset === 1) return { label: t('summary.period.lastMonth'), dateLabel: base }
    return { label: base, dateLabel: base }
  }
  // week — ISO Mon–Sun of ref's week（与 scopeRange 的 ISO 周键逐字对应，A3）。
  const { start, end } = isoWeekBounds(ref)
  const base = `${fmtMD(start)}–${fmtMD(end)}`
  if (isCurrent) return { label: t('summary.period.thisWeek'), dateLabel: base }
  if (offset === 1) return { label: t('summary.period.lastWeek'), dateLabel: base }
  return { label: base, dateLabel: base }
}

// 从今日向后走 N 期，产出 PeriodInfo[]（newest-on-top）。基于 shiftRef 逐期回退。
export function lastRanges(scope: AggregateScopeType, count: number = SCOPE_COUNT[scope]): PeriodInfo[] {
  const now = new Date()
  const currentRange = scopeRange(scope, now)
  const result: PeriodInfo[] = []
  let ref = new Date(now)
  for (let i = 0; i < count; i++) {
    const range = scopeRange(scope, ref)
    const isCurrent = range === currentRange
    const { label, dateLabel } = periodLabels(scope, ref, isCurrent, i)
    result.push({ range, label, dateLabel, ref: new Date(ref), isCurrent })
    ref = shiftRef(scope, ref, -1)
  }
  return result
}
