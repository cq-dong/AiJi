import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import type { Category } from '@/domain/types'
import { Button, cn } from '@/ui/components'
import { useT } from '@/app/i18n/useT'
import { t } from '@/app/i18n'
import { exportCategoryZip } from '@/adapters/zipExport'
import { canShareFiles, type SaveResult } from '@/adapters/fileShare'

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

// D10: SaveResult → 反馈文案（与 settings/CategoryDetail 一致语义）。
function formatSaveFeedback(result: SaveResult): string {
  if (!result.ok) return result.error ? t('categories.export.failWith', { error: result.error }) : t('categories.export.fail')
  if (result.method === 'share') return t('categories.export.shared')
  if (result.method === 'filesystem') {
    const p = result.path ?? ''
    const tail = p ? p.replace(/^file:\/\//, '').replace(/^content:\/\//, '') : ''
    return tail ? t('categories.export.savedTo', { path: tail }) : t('categories.export.savedDefault')
  }
  if (result.method === 'download') return t('categories.export.downloaded')
  return t('categories.export.done')
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
  const t = useT()
  // D10: .zip 导出确认 + 反馈状态。
  const [zipConfirm, setZipConfirm] = useState(false)
  const [zipExporting, setZipExporting] = useState(false)
  const [zipToast, setZipToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(r)
  }, [])

  const labelTrim = label.trim()
  const canSave =
    labelTrim.length > 0 &&
    (labelTrim !== category.label || accent !== (category.accent ?? 'catIdea'))

  const filename = `aiji-category-${category.slug}.zip`

  async function handleExport() {
    setZipConfirm(false)
    setZipExporting(true)
    try {
      const result = await exportCategoryZip(category.slug)
      // 'CANCELLED' 是 fileShare 适配器返回的协议 sentinel（用户取消分享面板）→ 静默。
      if (!result.ok && result.method === 'none' && result.error === 'CANCELLED') return
      setZipToast({ msg: formatSaveFeedback(result), ok: result.ok })
    } catch (e) {
      setZipToast({ msg: t('categories.export.failWith', { error: e instanceof Error ? e.message : String(e) }), ok: false })
    } finally {
      setZipExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-ink/45 backdrop-blur-[2px] animate-fade-in transition-opacity duration-200',
          entered ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('categories.edit.title')}
        className={cn(
          'relative rounded-t-card border-t border-white/10 bg-card px-4 pt-3 pb-6 shadow-sheet animate-slide-up transition-transform duration-200',
          entered ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-brd" />

        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-ink">{t('categories.edit.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid size-11 place-items-center rounded-btn text-t3 transition duration-base ease-out active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <label className="block mt-3">
          <span className="text-[12px] font-medium text-t2">{t('categories.edit.name')}</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('categories.edit.namePlaceholder')}
            className="mt-1.5 h-11 w-full rounded-btn border border-brd/80 bg-card px-3 text-[14px] text-ink shadow-sm placeholder:text-t3 transition-all focus:border-pri/50 focus:shadow-glowPriSm focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/20"
          />
        </label>

        <div className="mt-4">
          <span className="text-[12px] font-medium text-t2">{t('categories.edit.color')}</span>
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
                  className="flex cursor-pointer flex-col items-center gap-1 transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  <span
                    className={cn(
                      'size-11 rounded-full',
                      DOT[a],
                      selected
                        ? 'ring-2 ring-ink/80 ring-offset-2 shadow-sm'
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
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={zipExporting}
                onClick={() => setZipConfirm(true)}
                className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-pri transition duration-base ease-out active:opacity-60 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
              >
                <Download size={14} strokeWidth={2} />
                {zipExporting ? t('categories.edit.exporting') : t('categories.edit.export')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="cursor-pointer text-[13px] font-medium text-catFail transition duration-base ease-out active:opacity-60 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {t('categories.edit.delete')}
              </button>
            </div>
          ) : (
            <div className="rounded-card border border-catFail/30 bg-catFail/5 p-3 animate-scale-in">
              <p className="text-[12px] leading-relaxed text-ink">
                {t('categories.edit.deleteConfirm.title', { label: category.label })}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-t2">
                {t('categories.edit.deleteConfirm.hint', { count: liveCount })}
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel')}
                </Button>
                <button
                  type="button"
                  onClick={() => onDelete(category.slug)}
                  className="inline-flex h-11 cursor-pointer items-center justify-center rounded-btn bg-catFail px-4 text-[12px] font-medium text-card transition duration-base ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  {t('categories.edit.deleteConfirm.confirm')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!canSave}
            onClick={() => onSave({ ...category, label: labelTrim, accent })}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>

      {/* D10: 导出确认 sheet——z-[110] 盖在编辑 sheet（z-[100]）之上。 */}
      {zipConfirm && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/45 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setZipConfirm(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-screen border-t border-white/10 bg-page p-4 shadow-sheet animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-[17px] font-bold text-ink">{t('categories.export.sheet.title')}</p>
              <button
                type="button"
                onClick={() => setZipConfirm(false)}
                aria-label={t('common.close')}
                className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
                <span className="text-[13px] text-t2">{t('categories.export.sheet.scopeLabel')}</span>
                <span className="text-[13px] font-medium text-ink">{t('categories.export.sheet.scopeValue', { label: category.label })}</span>
              </div>
              <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
                <span className="text-[13px] text-t2">{t('categories.export.sheet.entryCount')}</span>
                <span className="text-[13px] font-medium text-ink">{t('common.itemsCount', { count: liveCount })}</span>
              </div>
              <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
                <span className="text-[13px] text-t2">{t('categories.export.sheet.filename')}</span>
                <span className="text-[12px] font-medium text-ink">{filename}</span>
              </div>
              <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
                <span className="text-[13px] text-t2">{t('categories.export.sheet.locationLabel')}</span>
                <span className="text-[12px] font-medium text-t2">
                  {canShareFiles()
                    ? t('categories.export.sheet.location.shareShort')
                    : Capacitor.isNativePlatform()
                      ? t('categories.export.sheet.location.nativeShort')
                      : t('categories.export.sheet.location.browserShort')}
                </span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-[38px] flex-1 rounded-btn"
                onClick={() => setZipConfirm(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="h-[38px] flex-1 rounded-btn"
                onClick={() => void handleExport()}
              >
                {t('categories.export.sheet.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* D10: 导出反馈 toast——z-[120] 盖在确认 sheet 之上。 */}
      {zipToast && (
        <div className="fixed inset-x-0 bottom-24 z-[120] flex justify-center px-4 pointer-events-none">
          <div
            className={cn(
              'pointer-events-auto max-w-[360px] rounded-btn px-4 py-2.5 text-[12px] font-medium shadow-sheet animate-slide-up',
              zipToast.ok ? 'bg-ink text-card' : 'bg-catFail text-card',
            )}
            role="status"
            onClick={() => setZipToast(null)}
          >
            {zipToast.msg}
          </div>
        </div>
      )}
    </div>
  )
}
