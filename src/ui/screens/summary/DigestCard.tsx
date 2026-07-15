import type { Aggregate, Category, EntryAi } from '@/domain/types'
import { Card, Chip, Skeleton, Spinner } from '@/ui/components'
import {
  aggregateChips,
  formatCreated,
  friendlyModel,
  scopeDisplay,
} from './aggregate'

interface DigestCardProps {
  aggregate: Aggregate
  entryAi: EntryAi[]
  categories: Category[]
  recalculating?: boolean
  onToggle?: () => void
}

export function DigestCard({
  aggregate,
  entryAi,
  categories,
  recalculating = false,
  onToggle,
}: DigestCardProps) {
  const { label, range } = scopeDisplay(aggregate)
  const chips = aggregateChips(aggregate, entryAi, categories)
  const interactive = Boolean(onToggle)

  return (
    <Card
      className={[
        recalculating ? 'bg-priS' : 'bg-card',
        interactive ? 'cursor-pointer' : '',
      ].join(' ')}
      onClick={onToggle}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] font-bold text-pri">{label}</span>
        <span className="text-[12px] text-t3">{range}</span>
      </div>

      {recalculating ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Spinner size={14} />
            <span className="text-[11px] font-medium text-pri">
              正在重新生成{label}摘要…
            </span>
          </div>
          <Skeleton className="h-2 w-full" rounded="rounded-[4px]" />
          <Skeleton className="h-2 w-3/4" rounded="rounded-[4px]" />
        </div>
      ) : (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-t2">
            {aggregate.summary}
          </p>
          <p className="mt-2 text-[11px] text-t3">
            {aggregate.entryIds.length} 条 · 挂链
          </p>
          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <Chip key={c.label} tone={c.tone}>
                  {c.label}
                </Chip>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-t3">
            生成于 {formatCreated(aggregate.createdAt)} ·{' '}
            {friendlyModel(aggregate.modelUsed)}
          </p>
        </>
      )}
    </Card>
  )
}
