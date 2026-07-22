import type { Category, EntryAi, Facets, Tag } from '@/domain/types'
import { Button, Card, Chip, Skeleton, Spinner } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import { categoryLabel, categoryTone, relativeTime, tagLabel, type ChipTone } from './helpers'

export type AiState = 'ready' | 'processing' | 'failed'

function FacetChips({ facets }: { facets: Facets }) {
  const t = useT()
  const chips: { label: string; tone: ChipTone }[] = []
  if (facets.mood) chips.push({ label: t('detail.facet.mood', { value: facets.mood }), tone: 'pending' })
  if (facets.place) chips.push({ label: t('detail.facet.place', { value: facets.place }), tone: 'project' })
  if (facets.project) chips.push({ label: t('detail.facet.project', { value: facets.project }), tone: 'project' })
  if (facets.event) chips.push({ label: t('detail.facet.event', { value: facets.event }), tone: 'fail' })
  facets.person?.forEach((p) => chips.push({ label: t('detail.facet.person', { value: p }), tone: 'idea' }))
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-t3">{t('detail.facets')}</span>
      {chips.map((c) => (
        <Chip key={c.label} tone={c.tone}>
          {c.label}
        </Chip>
      ))}
    </div>
  )
}

function ReadyBody({
  ai,
  categories,
  tags,
  onReprocess,
  onEdit,
  onDelete,
}: {
  ai: EntryAi
  categories: Category[]
  tags: Tag[]
  onReprocess: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] tabular-nums text-t3">
        {ai.modelUsed} · {relativeTime(ai.createdAt)}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-t3">{t('detail.category')}</span>
        <Chip tone={categoryTone(ai.category, categories)}>{categoryLabel(ai.category, categories)}</Chip>
      </div>
      {ai.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-t3">{t('detail.tags')}</span>
          {ai.tags.map((slug) => (
            <Chip key={slug} tone="default">
              {tagLabel(slug, tags)}
            </Chip>
          ))}
        </div>
      )}
      <FacetChips facets={ai.facets} />
      <div className="h-px bg-gradient-to-r from-transparent via-brd to-transparent" />
      {ai.titleSuggestion && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-t3">{t('detail.title')}</span>
          <p className="text-[14px] font-bold text-ink">{ai.titleSuggestion}</p>
        </div>
      )}
      {ai.summary && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-t3">{t('detail.summary')}</span>
          <p className="text-[12px] leading-relaxed text-t2 whitespace-pre-line">
            {ai.summary}
            {ai.mediaDescription?.images?.trim() && `\n${t('detail.imageContent')}${ai.mediaDescription.images.trim()}`}
            {ai.mediaDescription?.videos?.trim() && `\n${t('detail.videoContent')}${ai.mediaDescription.videos.trim()}`}
          </p>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center rounded-btn border border-brd/80 bg-card px-3 text-[12px] font-medium text-t2 shadow-sm cursor-pointer transition-all duration-base ease-out hover:border-t3/40 active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">{t('common.edit')}</button>
        <button type="button" onClick={onReprocess} className="inline-flex min-h-9 items-center rounded-btn border border-brd/80 bg-card px-3 text-[12px] font-medium text-t2 shadow-sm cursor-pointer transition-all duration-base ease-out hover:border-t3/40 active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">{t('detail.reprocess')}</button>
        <button type="button" onClick={onDelete} className="inline-flex min-h-9 items-center rounded-btn border border-catFail/20 bg-catFail/5 px-3 text-[12px] font-medium text-catFail cursor-pointer transition-all duration-base ease-out hover:bg-catFail/10 active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">{t('common.delete')}</button>
      </div>
    </div>
  )
}

function ProcessingBody() {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Spinner size={14} />
        <p className="text-[14px] font-medium text-pri">{t('detail.aiProcessing')}</p>
      </div>
      <p className="text-[11px] text-t3">{t('detail.processingHint')}</p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-[200px]" rounded="rounded" />
        <Skeleton className="h-3 w-[260px]" rounded="rounded" />
        <Skeleton className="h-3 w-[180px]" rounded="rounded" />
      </div>
      <p className="text-[11px] text-t3">{t('detail.processingHint2')}</p>
    </div>
  )
}

function FailedBody({ error, onReprocess, onManualEdit }: { error?: string; onReprocess: () => void; onManualEdit: () => void }) {
  const t = useT()
  // D25: 显示具体失败原因，让用户能判断是该配 BYOK key、补转写文本，还是单纯网络抖动重试。
  // .includes 检查的是原始 error 文本（适配器落库的原始码/消息），不本地化；仅输出 hint 本地化。
  const hint = error
    ? error.includes('未配置') || error.includes('BYOK')
      ? t('detail.fail.noKey')
      : error.includes('空') || error.includes('empty')
        ? t('detail.fail.emptyText')
        : t('detail.fail.reason', { error })
    : t('detail.fail.network')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] font-bold text-catFail">{t('detail.failed')}</p>
      <p className="text-[11px] text-t2">{hint}</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="primary" className="bg-catFail" onClick={onReprocess}>
          {t('common.retry')}
        </Button>
        <Button type="button" variant="secondary" onClick={onManualEdit}>
          {t('detail.manualEdit')}
        </Button>
      </div>
    </div>
  )
}

export function AiPanel({
  state,
  ai,
  processError,
  onReprocess,
  onEdit,
  onManualEdit,
  onDelete,
}: {
  state: AiState
  ai?: EntryAi
  processError?: string
  onReprocess: () => void
  onEdit: () => void
  onManualEdit: () => void
  onDelete: () => void
}) {
  // 读侧从 store 取类别/标签（含涌现），不再依赖 seed 静态数组。
  const categories = useUiStore((s) => s.categories)
  const tags = useUiStore((s) => s.tags)
  const t = useT()
  return (
    <Card className="flex flex-col gap-3 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[13px] font-bold text-ink">
          <span className="inline-block size-2 rounded-full bg-gradient-to-br from-pri to-pri/50 ring-2 ring-pri/15" aria-hidden="true" />
          {t('detail.aiPanelTitle')}
        </h2>
      </div>
      {state === 'ready' && ai && (
        <ReadyBody
          ai={ai}
          categories={categories}
          tags={tags}
          onReprocess={onReprocess}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      {state === 'ready' && !ai && <p className="text-[12px] text-t3">{t('detail.noAiResult')}</p>}
      {state === 'processing' && <ProcessingBody />}
      {state === 'failed' && <FailedBody error={processError} onReprocess={onReprocess} onManualEdit={onManualEdit} />}
    </Card>
  )
}
