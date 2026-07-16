import { useEffect, useRef, useState } from 'react'
import type { Aggregate, AggregateScopeType } from '@/domain/types'
import { useUiStore } from '@/app/store'
import { DigestCard } from './DigestCard'
import { periodLabel, scopeRange, shiftRef } from './aggregate'

type Scope = AggregateScopeType

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
]

const SCOPE_UNIT: Record<Scope, string> = { day: '日', week: '周', month: '月' }

export default function Summary() {
  const [scope, setScope] = useState<Scope>('week')
  const [ref, setRef] = useState<Date>(() => new Date())
  const aggregates = useUiStore((s) => s.aggregates)
  const recalculatingMap = useUiStore((s) => s.recalculating)
  const recomputeAggregate = useUiStore((s) => s.recomputeAggregate)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const categories = useUiStore((s) => s.categories)
  const entryAi = Object.values(aiByEntry)

  const range = scopeRange(scope, ref)
  const currentRange = scopeRange(scope, new Date())
  const isCurrent = range === currentRange
  const key = `${scope}:${range}`
  const isRecalculating = recalculatingMap[key] === true
  const current = aggregates.find(
    (a) => a.scope.type === scope && a.scope.range === range,
  ) ?? null

  // latest aggregates without re-subscribing the effect (avoids recompute loop).
  const aggregatesRef = useRef(aggregates)
  aggregatesRef.current = aggregates

  // 1b 根因：过去时段从未被命中。导航到任一 scope+range 时，若该时段摘要缺失或
  // 已过期，触发 recomputeAggregate(scope, range)——不读 recalculating/stale 作依赖，
  // 防止失败后 stale 仍在 → 重入 → 死循环（失败由 DigestCard 显「重新生成」兜底）。
  useEffect(() => {
    const cur = aggregatesRef.current.find(
      (a) => a.scope.type === scope && a.scope.range === range,
    )
    if (!cur || cur.stale) {
      void recomputeAggregate(scope, range)
    }
  }, [scope, range, recomputeAggregate])

  const onScopeChange = (s: Scope) => {
    setScope(s)
    setRef(new Date())
  }
  const onPrev = () => setRef((r) => shiftRef(scope, r, -1))
  const onNext = () => {
    if (!isCurrent) setRef((r) => shiftRef(scope, r, +1))
  }
  const onRegen = () => {
    void recomputeAggregate(scope, range)
  }

  return (
    <div className="px-4 pb-4 pt-4">
      <h1 className="text-[24px] font-bold text-ink">时间摘要</h1>

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

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          aria-label="上一时段"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-brd bg-card text-t2 active:scale-95"
        >
          <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden>
            <path d="M6 1L1.5 6L6 11" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-[13px] font-medium text-ink">
          {periodLabel(scope, ref, isCurrent)}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={isCurrent}
          aria-label="下一时段"
          className={[
            'flex h-8 w-8 items-center justify-center rounded-full border active:scale-95',
            isCurrent
              ? 'border-brd bg-page text-t3/40'
              : 'border-brd bg-card text-t2',
          ].join(' ')}
        >
          <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden>
            <path d="M2 1L6.5 6L2 11" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {current ? (
          <DigestCard
            aggregate={current}
            entryAi={entryAi}
            categories={categories}
            recalculating={isRecalculating}
            onRegen={onRegen}
          />
        ) : isRecalculating ? (
          <DigestCard
            aggregate={placeholderAggregate(scope, range)}
            entryAi={entryAi}
            categories={categories}
            recalculating
          />
        ) : (
          <p className="mt-10 text-center text-[13px] text-t3">
            本{SCOPE_UNIT[scope]}暂无摘要
          </p>
        )}
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
