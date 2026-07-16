// Pure date-range math (zero I/O). Shared by app/store.ts and summary/aggregate.ts
// so the range key used to FILE entries is computed identically to the key used to
// NAVIGATE periods. A3: the two files previously each had their own copy of a broken
// ISO-week algorithm (it produced `2026-W00` for early-January / late-December dates
// and was off-by-one for many weeks — e.g. 2026-07-15 → W28, correct is W29). The
// label helpers also rendered a rolling [ref-6, ref] window that did not match the
// ISO key, so entries appeared under the wrong week label. This module is the single
// source of truth; the label helpers now derive the Mon–Sun range from the same ISO
// bounds used to build the key, so label and key can never drift.

import type { AggregateScopeType } from './types'

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// ISO 8601 week bounds (Mon–Sun, local time) for the week containing ref.
// Mon=0 .. Sun=6. Used both to compute the week key and to render its label.
export function isoWeekBounds(ref: Date): { start: Date; end: Date } {
  const d = startOfDay(ref)
  const dayNum = (d.getDay() + 6) % 7 // Mon=0 .. Sun=6
  const start = new Date(d)
  start.setDate(start.getDate() - dayNum)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start, end }
}

// Canonical range key: day → '2026-07-15' · week → '2026-W29' · month → '2026-07'.
// Week is ISO 8601: the ISO year is the year of the week's Thursday, so late-Dec /
// early-Jan dates land in the correct year's week (no W00, no off-by-one).
export function scopeRange(scope: AggregateScopeType, ref: Date): string {
  const y = ref.getFullYear()
  const m = String(ref.getMonth() + 1).padStart(2, '0')
  const d = String(ref.getDate()).padStart(2, '0')
  if (scope === 'day') return `${y}-${m}-${d}`
  if (scope === 'month') return `${y}-${m}`
  const { start } = isoWeekBounds(ref)
  // Thursday of this ISO week determines the ISO year.
  const thursday = new Date(start)
  thursday.setDate(thursday.getDate() + 3)
  const isoYear = thursday.getFullYear()
  // Monday of ISO week 1 = Monday of the week containing Jan 4.
  const jan4 = new Date(isoYear, 0, 4)
  const jan4Day = (jan4.getDay() + 6) % 7
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - jan4Day)
  const weeks = Math.round((start.getTime() - week1Monday.getTime()) / (7 * 86_400_000))
  return `${isoYear}-W${String(weeks + 1).padStart(2, '0')}`
}

// Shift a reference date by N whole periods (day=±1d, week=±7d, month=±1 month).
export function shiftRef(scope: AggregateScopeType, ref: Date, periods: number): Date {
  const next = new Date(ref)
  if (scope === 'day') next.setDate(next.getDate() + periods)
  else if (scope === 'month') next.setMonth(next.getMonth() + periods)
  else next.setDate(next.getDate() + periods * 7)
  return next
}
