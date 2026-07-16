import { useEffect, useMemo, useRef, useState } from 'react'
import type { Aggregate, AggregateScopeType } from '@/domain/types'
import { useUiStore } from '@/app/store'
import { DigestCard } from './DigestCard'
import { lastRanges, scopeRange } from './aggregate'

type Scope = AggregateScopeType

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
]

const DETAIL_LEVELS = [
  { level: 1 as const, label: '极简' },
  { level: 2 as const, label: '简洁' },
  { level: 3 as const, label: '标准' },
  { level: 4 as const, label: '详细' },
  { level: 5 as const, label: '详尽' },
]

// Limited-concurrency enqueue: avoid LLM stampede when many periods need recompute.
const RECOMPUTE_CONCURRENCY = 2

export default function Summary() {
  const [scope, setScope] = useState<Scope>('week')
  const aggregates = useUiStore((s) => s.aggregates)
  const recalculatingMap = useUiStore((s) => s.recalculating)
  const recomputeAggregate = useUiStore((s) => s.recomputeAggregate)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const categories = useUiStore((s) => s.categories)
  const entries = useUiStore((s) => s.entries)
  const detailLevel = useUiStore((s) => s.settings.aggregateDetailLevel)
  const setSettings = useUiStore((s) => s.setSettings)
  const hydrated = useUiStore((s) => s.hydrated)

  const entryAi = useMemo(() => Object.values(aiByEntry), [aiByEntry])
  // Precompute each entry's range key for the active scope (avoids O(n×m) per render).
  const entryRanges = useMemo(
    () => entries.map((e) => scopeRange(scope, new Date(e.createdAt))),
    [entries, scope],
  )
  const periods = useMemo(() => lastRanges(scope), [scope])

  // Refs to scan latest aggregates/recalculating without re-subscribing the effect
  // (avoids recompute loop — failure leaves stale, effect doesn't re-fire on aggregates change).
  const aggregatesRef = useRef(aggregates)
  aggregatesRef.current = aggregates
  const recalculatingRef = useRef(recalculatingMap)
  recalculatingRef.current = recalculatingMap

  // Sweep: on scope / detailLevel / hydrate change, enqueue recompute for every
  // visible period that is missing OR stale OR generated at a different detail level.
  // Sequential-ish (limited concurrency) so we don't fire 14 LLM calls at once.
  useEffect(() => {
    if (!hydrated) return
    const missing: string[] = []
    for (const { range } of periods) {
      const cur = aggregatesRef.current.find(
        (a) => a.scope.type === scope && a.scope.range === range,
      )
      const key = `${scope}:${range}`
      if (recalculatingRef.current[key] === true) continue
      if (!cur || cur.stale || (cur.detailLevel ?? 3) !== detailLevel) {
        missing.push(range)
      }
    }
    if (missing.length === 0) return
    void (async () => {
      for (let i = 0; i < missing.length; i += RECOMPUTE_CONCURRENCY) {
        const batch = missing.slice(i, i + RECOMPUTE_CONCURRENCY)
        await Promise.all(
          batch.map((range) => recomputeAggregate(scope, range, detailLevel)),
        )
      }
    })()
  }, [scope, detailLevel, hydrated, periods, recomputeAggregate])

  const onScopeChange = (s: Scope) => setScope(s)
  const onLevelChange = (lvl: 1 | 2 | 3 | 4 | 5) => {
    setSettings({ aggregateDetailLevel: lvl })
  }

  return (
    <div className="px-4 pb-4 pt-4">
      <h1 className="text-[24px] font-bold text-ink">时间摘要</h1>

      {/* scope tabs: 日/周/月 */}
      <div className="mt-3 flex gap-2">
        {SCOPES.map((s) => {
          const active = s.key === scope
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onScopeChange(s.key)}
              className={[
                'h-9 flex-1 rounded-[18px] text-[14px] font-medium transition',
                active ? 'bg-pri text-white' : 'border border-brd bg-card text-t3',
              ].join(' ')}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      {/* detail level selector: 极简/简洁/标准/详细/详尽 */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-medium text-t3">详细度</div>
        <div className="flex gap-1 rounded-btn bg-page p-1">
          {DETAIL_LEVELS.map(({ level, label }) => {
            const active = level === detailLevel
            return (
              <button
                key={level}
                type="button"
                onClick={() => onLevelChange(level)}
                className={[
                  'h-7 flex-1 rounded-[10px] text-[11px] font-medium transition',
                  active ? 'bg-card text-ink shadow-sm' : 'text-t3',
                ].join(' ')}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* reverse-chrono period list (newest-on-top) */}
      <div className="mt-4 flex flex-col gap-3">
        {periods.map((p) => {
          const key = `${scope}:${p.range}`
          const current = aggregates.find(
            (a) => a.scope.type === scope && a.scope.range === p.range,
          ) ?? null
          const isRecalculating = recalculatingMap[key] === true
          const hasEntries = entryRanges.some((r) => r === p.range)
          const showSkeleton = !current && (isRecalculating || hasEntries)

          if (current) {
            return (
              <DigestCard
                key={key}
                aggregate={current}
                entryAi={entryAi}
                categories={categories}
                recalculating={isRecalculating}
                onRegen={() => void recomputeAggregate(scope, p.range, detailLevel)}
                label={p.label}
                rangeLabel={p.dateLabel}
              />
            )
          }
          if (showSkeleton) {
            return (
              <DigestCard
                key={key}
                aggregate={placeholderAggregate(scope, p.range)}
                entryAi={entryAi}
                categories={categories}
                recalculating
                label={p.label}
                rangeLabel={p.dateLabel}
              />
            )
          }
          return (
            <DigestCard
              key={key}
              aggregate={placeholderAggregate(scope, p.range)}
              entryAi={entryAi}
              categories={categories}
              empty
              label={p.label}
              rangeLabel={p.dateLabel}
            />
          )
        })}
      </div>
    </div>
  )
}

// Placeholder lets the recalculating skeleton render before the real aggregate
// arrives (covers the gap when current is undefined but recompute is in-flight).
function placeholderAggregate(scope: Scope, range: string): Aggregate {
  return {
    id: `placeholder-${scope}-${range}`,
    scope: { type: scope, range },
    summary: '',
    entryIds: [],
    modelUsed: '',
    createdAt: new Date().toISOString(),
    stale: false,
  }
}
