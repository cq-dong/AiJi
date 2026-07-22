import { useState } from 'react'
import type { Aggregate, Category, EntryAi } from '@/domain/types'
import { Button, Card, Chip, Skeleton, Spinner, cn } from '@/ui/components'
import { useT } from '@/app/i18n/useT'
import type { I18nKey } from '@/app/i18n'
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

// 详细度档位 i18n key（1~5）。档位数字 → key；超界回落「标准」(3)。
const DETAIL_LABEL_KEYS: Partial<Record<number, I18nKey>> = {
  1: 'summary.detailLevel.1',
  2: 'summary.detailLevel.2',
  3: 'summary.detailLevel.3',
  4: 'summary.detailLevel.4',
  5: 'summary.detailLevel.5',
}

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
  const t = useT()
  const scopeInfo = scopeDisplay(aggregate)
  const cardLabel = label ?? scopeInfo.label
  const cardRange = rangeLabel ?? scopeInfo.range
  const chips = aggregateChips(aggregate, entryAi, categories)
  const highlights = aggregate.highlights ?? []
  const hasSummary = aggregate.summary.trim().length > 0
  const canExpand = hasSummary || highlights.length > 0
  const detailLevel = aggregate.detailLevel ?? 3

  return (
    <Card className={cn('animate-fade-in-up shadow-card', recalculating && 'border-pri/20 bg-priS/50')}>
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-full bg-gradient-to-br from-pri to-pri/50 ring-2 ring-pri/15" aria-hidden="true" />
          <span className="text-[15px] font-bold text-pri">{cardLabel}</span>
          {!empty && (
            <span className="rounded-chip border border-pri/10 bg-priS/80 px-2 py-0.5 text-[10px] font-semibold text-pri/80">
              {t(DETAIL_LABEL_KEYS[detailLevel] ?? 'summary.detailLevel.3')}
            </span>
          )}
        </div>
        <span className="text-[12px] tabular-nums text-t3">{cardRange}</span>
      </div>

      {empty ? (
        <p className="mt-2 text-[13px] text-t3">{t('summary.empty')}</p>
      ) : recalculating ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Spinner size={14} />
            <span className="text-[11px] font-medium text-pri">
              {t('summary.recalculating', { label: cardLabel })}
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
              <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-t2">
                {aggregate.summary}
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-t3">{t('summary.noSummary')}</p>
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
              className="mt-1.5 inline-flex min-h-11 cursor-pointer items-center gap-1 px-1 text-[11px] font-medium text-pri transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
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
              {expanded ? t('summary.collapse') : t('summary.expand')}
            </button>
          )}

          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-t3">
              {t('summary.entryCount', { count: aggregate.entryIds.length })}
            </span>
            {aggregate.stale && (
              <Chip tone="pending" className="text-[10px]">
                {t('summary.stale')}
              </Chip>
            )}
          </div>

          {chips.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <Chip key={c.label} tone={c.tone}>
                  {c.label}
                </Chip>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-brd/50 pt-2.5">
            <span className="text-[11px] tabular-nums text-t3">
              {t('summary.generatedAt', {
                time: formatCreated(aggregate.createdAt),
                model: friendlyModel(aggregate.modelUsed),
              })}
            </span>
            {onRegen && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 px-2 text-[11px]"
                onClick={onRegen}
              >
                {t('summary.regenerate')}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
