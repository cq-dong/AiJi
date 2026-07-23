import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react'
import { Button, EmptyState, SwipeableCard, cn } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import type { Entry, EntryAi } from '@/domain/types'
import { daysSince, entryPreview, entryTitle, mmdd } from './helpers'

function TopBar({ onBack }: { onBack: () => void }) {
  const t = useT()
  return (
    <div className="flex h-11 items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('common.back')}
        className="flex size-11 cursor-pointer items-center justify-center rounded-btn text-t2 transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <ArrowLeft size={22} strokeWidth={2} />
      </button>
      <h1 className="text-[24px] font-bold leading-tight text-ink">{t('trash.title')}</h1>
    </div>
  )
}

// Confirm before hard delete (deleteEntry cascades AI + reminders; unrecoverable).
// Matches the detail screen's ConfirmDeleteDialog visual pattern.
function ConfirmHardDeleteDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: () => Promise<void> | void
  onClose: () => void
}) {
  const t = useT()
  const [deleting, setDeleting] = useState(false)
  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onConfirm()
    } finally {
      setDeleting(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label={t('common.cancel')}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-fade-in"
      />
      <div className="relative flex w-full max-w-[300px] flex-col gap-3 rounded-card border border-brd/80 bg-card p-4 animate-scale-in shadow-pop">
        <h3 className="text-[14px] font-bold text-ink">{t('trash.permanentDelete')}</h3>
        <p className="text-[12px] leading-relaxed text-t2">{t('trash.hardDeleteConfirm')}</p>
        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="flex-1 bg-catFail"
            onClick={handleDelete}
            disabled={deleting}
          >
            {t('trash.permanentDelete')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// 右滑「恢复」（直接生效，清 deletedAt 移回活动列表）；左滑「删除」→ 开不可逆确认对话框。
function TrashedCard({
  entry,
  ai,
  onRecover,
  onRequestHardDelete,
}: {
  entry: Entry
  ai: EntryAi | undefined
  onRecover: () => Promise<void>
  onRequestHardDelete: () => void
}) {
  const t = useT()
  // Countdown anchored at deletedAt (the trash time), not createdAt.
  const days = daysSince(entry.deletedAt ?? entry.createdAt)
  const remaining = Math.max(0, 30 - days)
  const urgent = remaining <= 3
  const countdownText =
    remaining === 0 ? t('trash.cleaningSoon') : t('trash.autoCleanIn', { n: remaining })
  const title = entryTitle(ai, entry.parts)
  const preview = entryPreview(entry.parts)

  return (
    <SwipeableCard
      className="shadow-card"
      leftActions={[
        {
          key: 'recover',
          label: t('trash.recover'),
          icon: <RotateCcw size={16} />,
          color: 'bg-pri',
          hapticStyle: 'success',
          onAction: () => onRecover(),
        },
      ]}
      rightActions={[
        {
          key: 'hardDelete',
          label: t('common.delete'),
          icon: <Trash2 size={16} />,
          color: 'bg-catFail',
          hapticStyle: 'warning',
          onAction: onRequestHardDelete,
        },
      ]}
    >
      <div className="flex flex-col gap-2 p-3">
        <p className="line-clamp-1 text-[14px] font-medium text-ink">{title}</p>
        <p className="line-clamp-2 text-[13px] leading-relaxed text-t2">
          {preview || t('trash.mediaOnly')}
        </p>
        <div className="flex items-center gap-2">
          <span className={cn('text-[11px]', urgent ? 'text-catFail' : 'text-t3')}>
            {countdownText}
          </span>
          <span className="text-[11px] text-t3">·</span>
          <span className="text-[11px] text-t3">
            {t('trash.originalDate', { date: mmdd(entry.createdAt) })}
          </span>
        </div>
      </div>
    </SwipeableCard>
  )
}

export default function Trash() {
  const navigate = useNavigate()
  const t = useT()
  const trashed = useUiStore((s) => s.trashed)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const recoverEntry = useUiStore((s) => s.recoverEntry)
  const deleteEntry = useUiStore((s) => s.deleteEntry)
  // 删除 is destructive → confirm dialog keyed by entry id. 恢复 is non-destructive
  // (clears deletedAt, moves back to active) → no confirm, item leaves list on success.
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const handleHardDelete = async () => {
    if (!confirmId) return
    await deleteEntry(confirmId)
    setConfirmId(null)
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-8">
      <TopBar onBack={() => navigate('/categories')} />
      {trashed.length === 0 ? (
        <EmptyState
          title={t('trash.emptyTitle')}
          subtitle={t('trash.emptySubtitle')}
        />
      ) : (
        <>
          <p className="text-[12px] text-t3">{t('trash.retentionNote')}</p>
          <div className="flex flex-col gap-3">
            {trashed.map((e) => (
              <TrashedCard
                key={e.id}
                entry={e}
                ai={aiByEntry[e.id]}
                onRecover={() => recoverEntry(e.id)}
                onRequestHardDelete={() => setConfirmId(e.id)}
              />
            ))}
          </div>
        </>
      )}
      {confirmId && (
        <ConfirmHardDeleteDialog
          onConfirm={handleHardDelete}
          onClose={() => setConfirmId(null)}
        />
      )}
    </div>
  )
}
