import { useEffect, useMemo, useState } from 'react'
import type { AggregateScopeType } from '@/domain/types'
import { useUiStore } from '@/app/store'
import { DigestCard } from './DigestCard'

type Scope = AggregateScopeType

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
]

export default function Summary() {
  const [scope, setScope] = useState<Scope>('week')
  const aggregates = useUiStore((s) => s.aggregates)
  const recomputeAggregate = useUiStore((s) => s.recomputeAggregate)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const categories = useUiStore((s) => s.categories)
  const entryAi = useMemo(() => Object.values(aiByEntry), [aiByEntry])

  // 切 scope → fire-and-forget 触发该 scope 当前时段重算（stale 时 DigestCard 显「重新生成中」）
  useEffect(() => {
    void recomputeAggregate(scope)
  }, [scope, recomputeAggregate])

  const visible = aggregates.filter((ag) => ag.scope.type === scope)

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
              onClick={() => setScope(s.key)}
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

      <div className="mt-4 flex flex-col gap-3">
        {visible.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-t3">
            本{scope === 'day' ? '日' : scope === 'week' ? '周' : '月'}暂无摘要
          </p>
        ) : (
          visible.map((ag) => (
            <DigestCard
              key={ag.id}
              aggregate={ag}
              entryAi={entryAi}
              categories={categories}
              recalculating={ag.stale}
            />
          ))
        )}
      </div>
    </div>
  )
}
