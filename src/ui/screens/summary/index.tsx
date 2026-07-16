import { useMemo, useState } from 'react'
import { seedAggregates } from '@/data/seed'
import { useUiStore } from '@/app/store'
import { DigestCard } from './DigestCard'

type Scope = 'day' | 'week' | 'month'

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
]

export default function Summary() {
  const [scope, setScope] = useState<Scope>('week')
  // Demo toggle: tap the top card to flip it between done / recalculating.
  // Defaults to the seeded stale flag of the topmost aggregate.
  const [topRecalc, setTopRecalc] = useState<boolean>(
    seedAggregates[0]?.stale ?? false,
  )

  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const categories = useUiStore((s) => s.categories)
  const entryAi = useMemo(() => Object.values(aiByEntry), [aiByEntry])

  // scope tab 真正驱动内容：只渲染匹配当前范围的聚合（seed 无 month 聚合 → 空）
  const visible = seedAggregates.filter((ag) => ag.scope.type === scope)

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
          visible.map((ag, i) => {
            const isTop = i === 0
            const recalculating = isTop ? topRecalc : ag.stale
            return (
              <DigestCard
                key={ag.id}
                aggregate={ag}
                entryAi={entryAi}
                categories={categories}
                recalculating={recalculating}
                onToggle={isTop ? () => setTopRecalc((v) => !v) : undefined}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
