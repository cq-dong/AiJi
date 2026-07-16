import { useEffect, useState } from 'react'
import type { Category } from '@/domain/types'
import { Button, cn } from '@/ui/components'

type Accent = NonNullable<Category['accent']>

// 4 accents are PROTOTYPE PLACEHOLDERS (CLAUDE.md §1) — no semantic labels,
// just swatches + hex. User picks freely.
const SWATCHES: { accent: Accent; hex: string }[] = [
  { accent: 'catIdea', hex: '#4f46e5' },
  { accent: 'catProject', hex: '#0d9488' },
  { accent: 'catPending', hex: '#d97706' },
  { accent: 'catFail', hex: '#dc2626' },
]

const DOT: Record<Accent, string> = {
  catIdea: 'bg-catIdea',
  catProject: 'bg-catProject',
  catPending: 'bg-catPending',
  catFail: 'bg-catFail',
}

interface CategoryEditSheetProps {
  category: Category
  liveCount: number
  onClose: () => void
  onSave: (cat: Category) => void
  onDelete: (slug: string) => void
}

export function CategoryEditSheet({
  category,
  liveCount,
  onClose,
  onSave,
  onDelete,
}: CategoryEditSheetProps) {
  const [label, setLabel] = useState(category.label)
  const [accent, setAccent] = useState<Accent>(category.accent ?? 'catIdea')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(r)
  }, [])

  const labelTrim = label.trim()
  const canSave =
    labelTrim.length > 0 &&
    (labelTrim !== category.label || accent !== (category.accent ?? 'catIdea'))

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-ink/40 transition-opacity duration-200',
          entered ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="编辑类别"
        className={cn(
          'relative rounded-t-card bg-card px-4 pt-3 pb-6 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] transition-transform duration-200',
          entered ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-brd" />

        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-ink">编辑类别</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid size-8 place-items-center rounded-btn text-t3 active:scale-95"
          >
            ✕
          </button>
        </div>

        <label className="block mt-3">
          <span className="text-[12px] font-medium text-t2">名称</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="类别名称"
            className="mt-1.5 h-11 w-full rounded-btn border border-brd bg-page px-3 text-[14px] text-ink outline-none focus:border-pri"
          />
        </label>

        <div className="mt-4">
          <span className="text-[12px] font-medium text-t2">颜色</span>
          <div className="mt-2 flex items-center gap-3">
            {SWATCHES.map(({ accent: a, hex }) => {
              const selected = a === accent
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAccent(a)}
                  aria-label={hex}
                  aria-pressed={selected}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className={cn(
                      'size-9 rounded-full',
                      DOT[a],
                      selected
                        ? 'ring-2 ring-ink ring-offset-2'
                        : 'ring-1 ring-brd',
                    )}
                  />
                  <span
                    className={cn(
                      'text-[10px] font-medium',
                      selected ? 'text-ink' : 'text-t3',
                    )}
                  >
                    {hex}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-5">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-[13px] font-medium text-catFail active:opacity-60"
            >
              删除类别
            </button>
          ) : (
            <div className="rounded-card border border-catFail/30 bg-catFail/5 p-3">
              <p className="text-[12px] leading-relaxed text-ink">
                确定删除「{category.label}」？
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-t2">
                该类别下的 {liveCount} 条将移至「未分类」。
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
                <button
                  type="button"
                  onClick={() => onDelete(category.slug)}
                  className="inline-flex h-9 items-center justify-center rounded-btn bg-catFail px-4 text-[12px] font-medium text-card active:scale-[0.98]"
                >
                  确认删除
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!canSave}
            onClick={() => onSave({ ...category, label: labelTrim, accent })}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
