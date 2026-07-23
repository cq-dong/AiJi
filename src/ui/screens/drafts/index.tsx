import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bookmark, Trash2 } from 'lucide-react'
import { Button, EmptyState, SwipeableCard } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import type { Draft } from '@/domain/types'
import { draftPreview, draftTitle, relTime } from './helpers'

// 裸路由顶栏：返回 ‹ + 页标题（24/Bold）。返回至 /categories（草稿入口挂在类别页）。
function TopBar({ onBack }: { onBack: () => void }) {
  const t = useT()
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('common.back')}
        className="flex size-11 cursor-pointer items-center justify-center rounded-btn text-t2 transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <ArrowLeft size={22} strokeWidth={2} />
      </button>
      <h1 className="text-[24px] font-bold leading-tight text-ink">{t('drafts.title')}</h1>
    </div>
  )
}

// 单条草稿卡：点主体 → loadDraft(id) 后跳 /capture 续记；左滑露出「删除」再点按确认
// （swipe+tap 两段确认，替代 window.confirm）。
function DraftRow({
  draft,
  onResume,
  onDelete,
}: {
  draft: Draft
  onResume: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const t = useT()
  const [resuming, setResuming] = useState(false)
  const title = draftTitle(draft)
  const preview = draftPreview(draft)

  const handleResume = async () => {
    if (resuming) return
    setResuming(true)
    try {
      await onResume(draft.id)
    } finally {
      setResuming(false)
    }
  }

  return (
    <SwipeableCard
      className="shadow-card"
      onClick={() => void handleResume()}
      rightActions={[
        {
          key: 'delete',
          label: t('common.delete'),
          icon: <Trash2 size={16} />,
          color: 'bg-catFail',
          hapticStyle: 'warning',
          onAction: () => onDelete(draft.id),
        },
      ]}
    >
      <div className="px-3 py-3">
        <p className="line-clamp-1 text-[14px] font-medium text-ink">{title}</p>
        {preview && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-t2">{preview}</p>
        )}
        <p className="mt-1.5 text-[11px] text-t3">
          {t('drafts.partsCount', { n: draft.parts.length })} · {relTime(draft.updatedAt)}
        </p>
      </div>
    </SwipeableCard>
  )
}

export default function Drafts() {
  const navigate = useNavigate()
  const t = useT()
  const drafts = useUiStore((s) => s.drafts)
  const loadDraft = useUiStore((s) => s.loadDraft)
  const deleteDraft = useUiStore((s) => s.deleteDraft)

  const handleResume = async (id: string) => {
    await loadDraft(id)
    navigate('/capture')
  }

  const handleDelete = async (id: string) => {
    await deleteDraft(id)
  }

  const onBack = () => navigate('/categories')

  return (
    <div className="px-4 pt-2 pb-6">
      <TopBar onBack={onBack} />
      {drafts.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={40} strokeWidth={1.5} />}
          title={t('drafts.emptyTitle')}
          subtitle={t('drafts.emptySubtitle')}
          action={
            <Button size="sm" onClick={() => navigate('/capture')}>
              {t('drafts.newEntry')}
            </Button>
          }
        />
      ) : (
        <>
          <p className="mt-1 px-1 text-[12px] text-t3">
            {t('drafts.countHint', { count: drafts.length })}
          </p>
          <div className="mt-3 space-y-2">
            {drafts.map((d) => (
              <DraftRow
                key={d.id}
                draft={d}
                onResume={handleResume}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
