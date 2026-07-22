import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Download, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import type { Category, Entry, EntryAi, Facets, Tag } from '@/domain/types'
import { Button, Card, EmptyState, cn } from '@/ui/components'
import { useT } from '@/app/i18n/useT'
import { t, type I18nKey } from '@/app/i18n'
import { exportCategoryZip } from '@/adapters/zipExport'
import { canShareFiles, type SaveResult } from '@/adapters/fileShare'
import { LENS_KEYS } from './helpers'
import { EntryRow } from './EntryRow'

// Group-by dimension within a category's detail list.
type GroupBy = 'time' | 'project' | 'person' | 'place'

const GROUP_OPTIONS: { key: GroupBy; labelKey: I18nKey }[] = [
  { key: 'time', labelKey: LENS_KEYS.time },
  { key: 'project', labelKey: LENS_KEYS.project },
  { key: 'person', labelKey: LENS_KEYS.person },
  { key: 'place', labelKey: LENS_KEYS.place },
]

const BAR: Record<NonNullable<Category['accent']>, string> = {
  catIdea: 'bg-catIdea',
  catProject: 'bg-catProject',
  catPending: 'bg-catPending',
  catFail: 'bg-catFail',
}

function facetValues(ai: EntryAi | undefined, kind: Exclude<GroupBy, 'time'>): string[] {
  if (!ai) return []
  const f: Facets = ai.facets
  if (kind === 'project') return f.project ? [f.project] : []
  if (kind === 'place') return f.place ? [f.place] : []
  return f.person ?? []
}

interface CategoryDetailProps {
  category: Category
  entries: Entry[]
  aiByEntry: Record<string, EntryAi>
  tags: Tag[]
  onBack: () => void
}

// D10: SaveResult → 反馈文案（与 settings 一致语义；category 自带 path 截尾逻辑）。
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

function countMedia(parts: Entry['parts']): number {
  let n = 0
  for (const p of parts) {
    if (p.type === 'audio' || p.type === 'video') n++
  }
  return n
}

// D10: 导出确认对话框（底部 sheet 风格，与 settings 对齐）。
function ExportConfirmSheet({
  scopeLabel,
  filename,
  entryCount,
  mediaCount,
  onClose,
  onConfirm,
}: {
  scopeLabel: string
  filename: string
  entryCount: number
  mediaCount: number
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()
  const isNative = Capacitor.isNativePlatform()
  const locationHint = canShareFiles()
    ? t('categories.export.sheet.location.share')
    : isNative
      ? t('categories.export.sheet.location.native')
      : t('categories.export.sheet.location.browser')
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('categories.export.sheet.title')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('categories.export.sheet.scopeLabel')}</span>
            <span className="text-[13px] font-medium text-ink">{scopeLabel}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('categories.export.sheet.entryCount')}</span>
            <span className="text-[13px] font-medium text-ink">{t('common.itemsCount', { count: entryCount })}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('categories.export.sheet.mediaCount')}</span>
            <span className="text-[13px] font-medium text-ink">{t('categories.export.sheet.mediaUnit', { count: mediaCount })}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('categories.export.sheet.filename')}</span>
            <span className="text-[12px] font-medium text-ink">{filename}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('categories.export.sheet.locationLabel')}</span>
            <span className="text-[12px] font-medium text-t2">{locationHint}</span>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onConfirm}>
            {t('categories.export.sheet.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Toast({ message, ok, onDismiss }: { message: string; ok: boolean; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 pointer-events-none">
      <div
        className={cn(
          'pointer-events-auto max-w-[360px] rounded-btn px-4 py-2.5 text-[12px] font-medium shadow-sheet animate-slide-up',
          ok ? 'bg-ink text-card' : 'bg-catFail text-card',
        )}
        role="status"
      >
        {message}
      </div>
    </div>
  )
}

// Inline category-detail view: lists entries whose AI category === category.slug,
// with a group-by toggle (时间 / 项目 / 人物 / 地点). Default 时间 = newest-first flat.
export function CategoryDetail({
  category,
  entries,
  aiByEntry,
  tags,
  onBack,
}: CategoryDetailProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('time')
  const t = useT()

  // D10: .zip 导出确认 + 反馈状态。
  const [zipConfirm, setZipConfirm] = useState(false)
  const [zipExporting, setZipExporting] = useState(false)
  const [zipToast, setZipToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const items = useMemo(
    () =>
      entries
        .filter((e) => aiByEntry[e.id]?.category === category.slug)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [entries, aiByEntry, category.slug],
  )

  // unused param guard: tags are resolved by EntryRow via categories; kept for API compat.
  void tags

  const bar = category.accent ? BAR[category.accent] : 'bg-t3'
  const dot = bar

  const mediaCount = items.reduce((sum, e) => sum + countMedia(e.parts), 0)
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

  if (items.length === 0) {
    return (
      <div>
        <DetailHeader label={category.label} dot={dot} count={0} onBack={onBack} onExportClick={() => setZipConfirm(true)} exporting={zipExporting} />
        <EmptyState
          title={t('categories.detail.empty.title')}
          subtitle={t('categories.detail.empty.subtitle')}
        />
        {zipToast && (
          <Toast message={zipToast.msg} ok={zipToast.ok} onDismiss={() => setZipToast(null)} />
        )}
      </div>
    )
  }

  return (
    <div>
      <DetailHeader
        label={category.label}
        dot={dot}
        count={items.length}
        onBack={onBack}
        onExportClick={() => setZipConfirm(true)}
        exporting={zipExporting}
      />
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-[12px] border border-brd/60 bg-page p-1 shadow-inner">
        {GROUP_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setGroupBy(o.key)}
            aria-pressed={groupBy === o.key}
            className={cn(
              'rounded-[8px] py-1 text-[12px] font-medium transition-all duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              groupBy === o.key
                ? 'bg-card text-ink shadow-sm font-semibold'
                : 'text-t3 active:scale-95',
            )}
          >
            {t(o.labelKey)}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {groupBy === 'time' ? (
          <div className="flex flex-col gap-2">
            {items.map((entry) => {
              const ai = aiByEntry[entry.id]
              return <EntryRow key={entry.id} entry={entry} ai={ai} category={category} />
            })}
          </div>
        ) : (
          <GroupedEntries
            items={items}
            aiByEntry={aiByEntry}
            category={category}
            kind={groupBy}
          />
        )}
      </div>
      {zipConfirm && (
        <ExportConfirmSheet
          scopeLabel={t('categories.export.sheet.scopeValue', { label: category.label })}
          filename={filename}
          entryCount={items.length}
          mediaCount={mediaCount}
          onClose={() => setZipConfirm(false)}
          onConfirm={() => void handleExport()}
        />
      )}
      {zipToast && (
        <Toast message={zipToast.msg} ok={zipToast.ok} onDismiss={() => setZipToast(null)} />
      )}
    </div>
  )
}

interface GroupedEntriesProps {
  items: Entry[]
  aiByEntry: Record<string, EntryAi>
  category: Category
  kind: Exclude<GroupBy, 'time'>
}

function GroupedEntries({ items, aiByEntry, category, kind }: GroupedEntriesProps) {
  const t = useT()
  const clusters = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of items) {
      for (const val of facetValues(aiByEntry[e.id], kind)) {
        if (!val) continue
        const arr = map.get(val)
        if (arr) arr.push(e)
        else map.set(val, [e])
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    return [...map.entries()]
      .map(([value, list]) => ({ value, list, count: list.length, newest: list[0]!.createdAt }))
      .sort((a, b) => new Date(b.newest).getTime() - new Date(a.newest).getTime())
  }, [items, aiByEntry, kind])

  if (clusters.length === 0) {
    return (
      <EmptyState
        title={t('categories.detail.grouped.empty.title', { facet: t(LENS_KEYS[kind]) })}
        subtitle={t('categories.detail.grouped.empty.subtitle')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {clusters.map((c) => (
        <Card key={c.value} padded={false} className="p-3 shadow-card animate-fade-in-up">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-gradient-to-br from-pri to-pri/60 ring-2 ring-pri/15" />
            <h3 className="text-[14px] font-medium text-ink">{c.value}</h3>
            <span className="text-[11px] text-t3">{t('common.itemsCount', { count: c.count })}</span>
          </div>
          <div className="flex flex-col gap-2">
            {c.list.map((e) => {
              const ai = aiByEntry[e.id]
              return <EntryRow key={e.id} entry={e} ai={ai} category={category} />
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}

function DetailHeader({
  label,
  dot,
  count,
  onBack,
  onExportClick,
  exporting,
}: {
  label: string
  dot: string
  count: number
  onBack: () => void
  onExportClick: () => void
  exporting: boolean
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeft size={16} /> {t('common.back')}
      </Button>
      <span className={cn('size-3 rounded-full', dot)} />
      <span className="text-[17px] font-bold text-ink">{label}</span>
      <span className="text-[12px] text-t3">{t('common.itemsCount', { count })}</span>
      <button
        type="button"
        aria-label={t('categories.edit.export')}
        disabled={exporting}
        onClick={onExportClick}
        className="ml-auto grid size-11 cursor-pointer place-items-center rounded-btn text-t2 transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
      >
        <Download size={18} strokeWidth={2} />
      </button>
    </div>
  )
}
