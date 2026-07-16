import { useState } from 'react'
import type { Aggregate, Category, EntryAi } from '@/domain/types'
import { Button, Card, Chip, Skeleton, Spinner } from '@/ui/components'
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
  onRegen?: () => void
  label?: string // override scopeDisplay label（期间列表用真实日期）
  rangeLabel?: string // override scopeDisplay range
  empty?: boolean // 该期间无条目 → 紧凑空态
}

const DETAIL_LABELS = ['', '极简', '简洁', '标准', '详细', '详尽'] as const

export function DigestCard({
  aggregate,
  entryAi,
  categories,
  recalculating = false,
  onRegen,
  label,
  rangeLabel,
  empty = false,
}: DigestCardProps) {
  const [expanded, setExpanded] = useState(false)
  const scopeInfo = scopeDisplay(aggregate)
  const cardLabel = label ?? scopeInfo.label
  const cardRange = rangeLabel ?? scopeInfo.range
  const chips = aggregateChips(aggregate, entryAi, categories)
  const highlights = aggregate.highlights ?? []
  const hasSummary = aggregate.summary.trim().length > 0
  const canExpand = hasSummary || highlights.length > 0
  const detailLevel = aggregate.detailLevel ?? 3

  return (
    <Card className={recalculating ? 'bg-priS' : 'bg-card'}>
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-bold text-pri">{cardLabel}</span>
          {!empty && (
            <span className="rounded-chip bg-priS px-1.5 py-0.5 text-[10px] font-medium text-pri">
              {DETAIL_LABELS[detailLevel] ?? '标准'}
            </span>
          )}
        </div>
        <span className="text-[12px] text-t3">{cardRange}</span>
      </div>

      {empty ? (
        <p className="mt-2 text-[13px] text-t3">暂无内容</p>
      ) : recalculating ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Spinner size={14} />
            <span className="text-[11px] font-medium text-pri">
              正在重新生成{cardLabel}摘要…
            </span>
          </div>
          <Skeleton className="h-2 w-full" rounded="rounded-[4px]" />
          <Skeleton className="h-2 w-3/4" rounded="rounded-[4px]" />
        </div>
      ) : (
        <>
          <div
            className="overflow-hidden transition-[max-height] duration-300 ease-out"
            style={{ maxHeight: expanded ? 640 : 60 }}
          >
            {hasSummary ? (
              <p className="mt-2 text-[13px] leading-relaxed text-t2">
                {aggregate.summary}
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-t3">暂无摘要内容。</p>
            )}
            {expanded && highlights.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 text-[12px] leading-relaxed text-t2"
                  >
                    <span className="mt-[5px] inline-block h-1 w-1 shrink-0 rounded-full bg-pri" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-pri"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                className={[
                  'transition-transform',
                  expanded ? 'rotate-180' : '',
                ].join(' ')}
                aria-hidden
              >
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {expanded ? '收起' : '展开'}
            </button>
          )}

          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-t3">
              {aggregate.entryIds.length} 条 · 挂链
            </span>
            {aggregate.stale && (
              <Chip tone="pending" className="text-[10px]">
                已过期
              </Chip>
            )}
          </div>

          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <Chip key={c.label} tone={c.tone}>
                  {c.label}
                </Chip>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-t3">
              生成于 {formatCreated(aggregate.createdAt)} ·{' '}
              {friendlyModel(aggregate.modelUsed)}
            </span>
            {onRegen && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={onRegen}
              >
                重新生成
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
