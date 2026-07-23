import type { ReactNode } from 'react'
import type { Category, EntryAi, Facets, Tag } from '@/domain/types'
import { Button, Card, Chip, Skeleton, Spinner } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import {
  Image as ImageIcon,
  Pencil,
  RefreshCw,
  Trash2,
  Video as VideoIcon,
} from 'lucide-react'
import { categoryLabel, categoryTone, relativeTime, tagLabel } from './helpers'

export type AiState = 'ready' | 'processing' | 'failed'

// footer 操作钮：图标+文字的 quiet ghost 风格（编辑/重处理），删除单独 catFail。
const actionCls =
  'inline-flex min-h-9 items-center gap-1 rounded-chip px-2.5 text-[12px] font-medium cursor-pointer transition-all duration-base ease-out active:scale-95 active:bg-page focus-visible:ring-2 focus-visible:ring-pri/40 outline-none'

// 多模态理解子卡：图片/视频内容与摘要分区展示（此前直接拼接在摘要段尾，结构含糊）。
// icon + 小标签 + 理解文本，bg-page 浅底与主卡区分层级。
function MediaBlock({ icon, label, text }: { icon: ReactNode; label: string; text: string }) {
  return (
    <div className="rounded-chip border border-brd/60 bg-page/70 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-t2">
        {icon}
        {label}
      </p>
      <p className="mt-1 whitespace-pre-line text-[12px] leading-[1.7] text-t2">{text}</p>
    </div>
  )
}

// 侧面 chips：全部 default 浅调——facet 值自带「情绪·/地点·」前缀，可自我描述；
// 不再按类型上色（旧版 event 用 fail 红，视觉上像报错）。
function FacetChips({ facets }: { facets: Facets }) {
  const t = useT()
  const chips: string[] = []
  if (facets.mood) chips.push(t('detail.facet.mood', { value: facets.mood }))
  if (facets.place) chips.push(t('detail.facet.place', { value: facets.place }))
  if (facets.project) chips.push(t('detail.facet.project', { value: facets.project }))
  if (facets.event) chips.push(t('detail.facet.event', { value: facets.event }))
  facets.person?.forEach((p) => chips.push(t('detail.facet.person', { value: p })))
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Chip key={c} tone="default">
          {c}
        </Chip>
      ))}
    </div>
  )
}

// 阅读优先的分层结构：标题建议= headline、摘要=正文（ typography 承载层级，
// 不要表单式小标签）→ 多模态子卡 → 类别+#标签一行 → 侧面 → 发丝线 + 操作行。
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
  const images = ai.mediaDescription?.images?.trim()
  const videos = ai.mediaDescription?.videos?.trim()
  return (
    <div className="flex flex-col">
      {ai.titleSuggestion && (
        <p className="text-[16px] font-bold leading-snug text-ink">{ai.titleSuggestion}</p>
      )}
      {ai.summary && (
        <p className="mt-1.5 whitespace-pre-line text-[13px] leading-[1.8] text-t2">
          {ai.summary}
        </p>
      )}
      {(images || videos) && (
        <div className="mt-3 flex flex-col gap-2">
          {images && (
            <MediaBlock
              icon={<ImageIcon size={12} strokeWidth={2.2} className="text-pri" />}
              label={t('detail.mediaImages')}
              text={images}
            />
          )}
          {videos && (
            <MediaBlock
              icon={<VideoIcon size={12} strokeWidth={2.2} className="text-pri" />}
              label={t('detail.mediaVideos')}
              text={videos}
            />
          )}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <Chip tone={categoryTone(ai.category, categories)}>
          {categoryLabel(ai.category, categories)}
        </Chip>
        {ai.tags.map((slug) => (
          <Chip key={slug} tone="default">
            #{tagLabel(slug, tags)}
          </Chip>
        ))}
      </div>
      <div className="mt-2">
        <FacetChips facets={ai.facets} />
      </div>

      <div className="mt-4 flex items-center gap-1 border-t border-brd/60 pt-2">
        <button type="button" onClick={onEdit} className={`${actionCls} text-t2`}>
          <Pencil size={13} strokeWidth={2.2} />
          {t('common.edit')}
        </button>
        <button type="button" onClick={onReprocess} className={`${actionCls} text-t2`}>
          <RefreshCw size={13} strokeWidth={2.2} />
          {t('detail.reprocess')}
        </button>
        <button type="button" onClick={onDelete} className={`${actionCls} ml-auto text-catFail`}>
          <Trash2 size={13} strokeWidth={2.2} />
          {t('common.delete')}
        </button>
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
      : error.includes('无文本') || error.includes('空') || error.includes('empty')
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
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-bold text-ink">
          <span className="inline-block size-2 rounded-full bg-gradient-to-br from-pri to-pri/50 ring-2 ring-pri/15" aria-hidden="true" />
          {t('detail.aiPanelTitle')}
        </h2>
        {/* 模型元信息从正文头部挪到标题行右侧——正文留给内容本身。 */}
        {state === 'ready' && ai && (
          <p className="shrink-0 text-[10px] tabular-nums text-t3">
            {ai.modelUsed} · {relativeTime(ai.createdAt)}
          </p>
        )}
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
