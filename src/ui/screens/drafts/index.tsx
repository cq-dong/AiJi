import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bookmark, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import type { Draft } from '@/domain/types'
import { draftPreview, draftTitle, relTime } from './helpers'

// 裸路由顶栏：返回 ‹ + 页标题（24/Bold）。返回至 /categories（草稿入口挂在类别页）。
function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回"
        className="flex size-11 cursor-pointer items-center justify-center rounded-btn text-t2 transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <ArrowLeft size={22} strokeWidth={2} />
      </button>
      <h1 className="text-[24px] font-bold leading-tight text-ink">草稿</h1>
    </div>
  )
}

// 单条草稿卡：主体按钮点 → loadDraft(id) 后跳 /capture 续记；
// 右侧删除按钮（Trash2）→ confirm 后 deleteDraft(id)。两按钮平级，不嵌套。
function DraftRow({
  draft,
  onResume,
  onDelete,
}: {
  draft: Draft
  onResume: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [resuming, setResuming] = useState(false)
  const title = draftTitle(draft)
  const preview = draftPreview(draft)

  const handleResume = async () => {
    setResuming(true)
    try {
      await onResume(draft.id)
    } finally {
      setResuming(false)
    }
  }

  const handleDelete = () => {
    if (window.confirm('删除该草稿？删除后不可恢复。')) void onDelete(draft.id)
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={handleResume}
          disabled={resuming}
          className="flex-1 cursor-pointer px-3 py-3 text-left transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
        >
          <p className="line-clamp-1 text-[14px] font-medium text-ink">{title}</p>
          {preview && (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-t2">{preview}</p>
          )}
          <p className="mt-1.5 text-[11px] text-t3">
            {draft.parts.length} 段 · {relTime(draft.updatedAt)}
          </p>
        </button>
        <button
          type="button"
          onClick={handleDelete}
          aria-label="删除草稿"
          className="flex size-11 cursor-pointer items-center justify-center text-t3 transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card active:text-catFail"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </Card>
  )
}

export default function Drafts() {
  const navigate = useNavigate()
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
          title="没有草稿"
          subtitle="采集时点「存草稿」可暂停，稍后从这里继续"
          action={
            <Button size="sm" onClick={() => navigate('/capture')}>
              记一笔
            </Button>
          }
        />
      ) : (
        <>
          <p className="mt-1 px-1 text-[12px] text-t3">
            共 {drafts.length} 份草稿 · 点击继续记录
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
