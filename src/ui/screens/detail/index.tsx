import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Button, Card, EmptyState, ReminderCreator, Sheet, cn } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { di } from '@/app/di'
import { enrichLocation } from '@/adapters/geocoding'
import { exportEntryZip, shareEntry, canShareEntry } from '@/adapters/zipExport'
import { canShareFiles, type SaveResult } from '@/adapters/fileShare'
import type { EntryAi, EntryPart, EntryStatus, Reminder } from '@/domain/types'
import { AudioPlayer, VideoThumb, LocationBadge } from './PartView'
import { AiPanel, type AiState } from './AiPanel'
import { formatTitle, formatDateTime, formatDuration, partTypeLabel, tagLabel } from './helpers'
import { ChevronLeft, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'

function statusToAiState(s: EntryStatus): AiState {
  if (s === 'processing') return 'processing'
  if (s === 'failed') return 'failed'
  if (s === 'ready') return 'ready'
  return 'processing'
}

function TopBar({ title, onBack, onMore }: { title: string; onBack: () => void; onMore?: () => void }) {
  return (
    <div className="flex h-11 items-center">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回"
        className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink transition-all duration-base ease-out hover:bg-page active:scale-90 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <ChevronLeft size={26} strokeWidth={2} />
      </button>
      <h1 className="flex-1 text-center text-[17px] font-bold text-ink">{title}</h1>
      {onMore ? (
        <button
          type="button"
          onClick={onMore}
          aria-label="更多"
          className="-mr-2 flex size-11 items-center justify-center rounded-full text-t2 transition-all duration-base ease-out hover:bg-page active:scale-90 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <MoreHorizontal size={22} strokeWidth={2} />
        </button>
      ) : (
        <span className="size-11" />
      )}
    </div>
  )
}

// 记录视图：片段自然合并的阅读流。连续文本合并成块，音视频保留播放器，不显示每片时间戳/模态标签。
function RecordView({ parts }: { parts: EntryPart[] }) {
  type Group = { type: 'text'; contents: string[] } | { type: 'media'; part: EntryPart }
  const groups: Group[] = []
  for (const p of parts) {
    if (p.type === 'text') {
      const last = groups[groups.length - 1]
      if (last && last.type === 'text') last.contents.push(p.content)
      else groups.push({ type: 'text', contents: [p.content] })
    } else {
      groups.push({ type: 'media', part: p })
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, i) => {
        if (g.type === 'text') {
          return (
            <div key={i} className="flex flex-col gap-2">
              {g.contents.map((c, j) => (
                <p key={j} className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{c}</p>
              ))}
            </div>
          )
        }
        const p = g.part
        if (p.type === 'audio') {
          return (
            <div key={i} className="flex flex-col gap-2">
              <AudioPlayer mediaRef={p.ref} durationSec={p.durationSec} />
              {p.transcript && (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-t2">{p.transcript}</p>
              )}
            </div>
          )
        }
        if (p.type === 'video') {
          return (
            <div key={i} className="flex flex-col gap-2">
              <VideoThumb mediaRef={p.ref} durationSec={p.durationSec} />
              {p.transcript && (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-t2">{p.transcript}</p>
              )}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

// 原态视图的单片段卡：文本可 inline 编辑（确认→更新 content，取消→还原），所有片段可删除。
function SourcePartView({
  part,
  iso,
  onRemove,
  onEditText,
}: {
  part: EntryPart
  iso: string
  onRemove: () => void
  onEditText: (content: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(part.type === 'text' ? part.content : '')
  const helper = `${formatDateTime(iso)} · ${partTypeLabel(part)}${
    part.type !== 'text' ? ' ' + formatDuration(part.durationSec) : ''
  }`
  const inputCls =
    'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card'
  return (
    <Card className="relative flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 pr-9">
        <p className="text-[11px] text-t3">{helper}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="删除片段"
        className="absolute right-1 top-1 flex size-9 items-center justify-center rounded-full text-t3 cursor-pointer transition duration-base ease-out active:scale-[0.97] active:bg-pri/10 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
      >
        <Trash2 size={14} strokeWidth={2.2} />
      </button>
      {part.type === 'text' && (
        editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              autoFocus
              className={inputCls}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => {
                  const t = draft.trim()
                  if (t) onEditText(t)
                  setEditing(false)
                }}
              >
                确认
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-t3"
                onClick={() => {
                  setDraft(part.content)
                  setEditing(false)
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative pr-9">
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{part.content}</p>
            <button
              type="button"
              onClick={() => { setDraft(part.content); setEditing(true) }}
              aria-label="编辑文本"
              className="absolute right-0 top-0 flex size-9 items-center justify-center rounded-full text-t3 cursor-pointer transition duration-base ease-out active:scale-[0.97] active:bg-pri/10 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
            >
              <Pencil size={13} strokeWidth={2.2} />
            </button>
          </div>
        )
      )}
      {part.type === 'audio' && (
        <>
          {part.transcript && (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{part.transcript}</p>
          )}
          <AudioPlayer mediaRef={part.ref} durationSec={part.durationSec} />
        </>
      )}
      {part.type === 'video' && (
        <>
          <VideoThumb mediaRef={part.ref} durationSec={part.durationSec} />
          {part.transcript && (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-t2">{part.transcript}</p>
          )}
        </>
      )}
    </Card>
  )
}

// 旧 TodoConfirm + ReminderConfirm 两卡已合并成共享 ReminderCreator（修"23:59 异常/两按钮无差别/重弹"）。
// 渲染条件见下方：errand||event||reminderSuggestion 且 !todoDismissed 且 该条目无 Reminder。

// AI 面板编辑：改 title / summary / category / tags → updateEntryAi(entryId, patch)。
function AiEditSheet({
  ai,
  onSave,
  onClose,
}: {
  ai: EntryAi
  onSave: (patch: Partial<EntryAi>) => Promise<void> | void
  onClose: () => void
}) {
  const categories = useUiStore((s) => s.categories)
  const tags = useUiStore((s) => s.tags)
  const [title, setTitle] = useState(ai.titleSuggestion ?? '')
  const [summary, setSummary] = useState(ai.summary ?? '')
  const [category, setCategory] = useState(ai.category)
  // 标签按 label 编辑（逗号分隔），保存时映射回 slug：已知 label→slug，未知 label slugify。
  const [tagsText, setTagsText] = useState(() => ai.tags.map((slug) => tagLabel(slug, tags)).join('，'))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const slugs = tagsText
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label) => {
          const found = tags.find((t) => t.label === label)
          return found?.slug ?? label.toLowerCase().replace(/\s+/g, '-')
        })
      await onSave({
        titleSuggestion: title.trim() || undefined,
        summary: summary.trim() || undefined,
        category,
        tags: slugs,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card'

  return (
    <Sheet
      title="编辑 AI 处理"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="primary" className="flex-1" onClick={handleSave} disabled={saving}>
            保存
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t2">标题</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="无标题" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t2">摘要</label>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className={inputCls} placeholder="无摘要" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t2">类别</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          <option value="">未分类</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t2">标签</label>
        <input type="text" value={tagsText} onChange={(e) => setTagsText(e.target.value)} className={inputCls} placeholder="用逗号分隔" />
      </div>
    </Sheet>
  )
}

// 手动编辑条目 parts：文本可改 content；音视频只能改 transcript（原始媒体不可编辑）→ updateEntry(id, { parts })。
function PartsEditSheet({
  parts,
  onSave,
  onClose,
}: {
  parts: EntryPart[]
  onSave: (parts: EntryPart[]) => Promise<void> | void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<EntryPart[]>(() => parts.map((p) => ({ ...p })))
  const [saving, setSaving] = useState(false)

  const update = (i: number, fn: (p: EntryPart) => EntryPart) =>
    setDraft((d) => d.map((p, idx) => (idx === i ? fn(p) : p)))

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card'

  return (
    <Sheet
      title="手动编辑"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="primary" className="flex-1" onClick={handleSave} disabled={saving}>
            保存
          </Button>
        </>
      }
    >
      {draft.map((p, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <span className="text-[11px] text-t3">
            {partTypeLabel(p)}
            {p.type !== 'text' ? ` · ${formatDuration(p.durationSec)}` : ''}
          </span>
          {p.type === 'text' && (
            <textarea
              value={p.content}
              onChange={(e) => update(i, (x) => (x.type === 'text' ? { ...x, content: e.target.value } : x))}
              rows={4}
              className={inputCls}
            />
          )}
          {(p.type === 'audio' || p.type === 'video') && (
            <>
              <span className="text-[11px] text-t3">转写文本</span>
              <textarea
                value={p.transcript ?? ''}
                onChange={(e) =>
                  update(i, (x) =>
                    x.type === 'audio' || x.type === 'video' ? { ...x, transcript: e.target.value } : x,
                  )
                }
                rows={3}
                className={inputCls}
                placeholder="无转写"
              />
              <span className="text-[10px] text-t3">原始媒体不可编辑</span>
            </>
          )}
        </div>
      ))}
    </Sheet>
  )
}

function ConfirmDeleteDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: () => Promise<void> | void
  onClose: () => void
}) {
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
      <button type="button" aria-label="取消" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-fade-in" />
      <div className="relative flex w-full max-w-[300px] flex-col gap-3 rounded-card border border-brd/60 bg-card p-5 animate-scale-in shadow-pop">
        <h3 className="text-[15px] font-bold text-ink">移到回收站</h3>
        <p className="text-[12px] leading-relaxed text-t2">移到回收站？30 天内可在回收站恢复。</p>
        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="primary" className="flex-1 bg-catFail" onClick={handleDelete} disabled={deleting}>
            移到回收站
          </Button>
        </div>
      </div>
    </div>
  )
}

// D10: SaveResult → 反馈文案（与 settings/categories 同语义）。
function formatSaveFeedback(result: SaveResult): string {
  if (!result.ok) return result.error ? `导出失败：${result.error}` : '导出失败'
  if (result.method === 'share') return '已分享'
  if (result.method === 'filesystem') {
    const p = result.path ?? ''
    const tail = p ? p.replace(/^file:\/\//, '').replace(/^content:\/\//, '') : ''
    return tail ? `已保存到 ${tail}` : '已保存到 文档/AiJi/'
  }
  if (result.method === 'download') return '已下载到浏览器下载目录'
  return '已导出'
}

// D10: 导出确认 sheet（底部 sheet 风格，与 settings/categories 对齐）。
// z-[55] 盖在 MoreSheet(z-50) 之上；MoreSheet 作为兄弟渲染，confirm 以 fixed 脱离 Sheet 容器。
function ExportConfirmSheet({
  filename,
  mediaCount,
  onClose,
  onConfirm,
}: {
  filename: string
  mediaCount: number
  onClose: () => void
  onConfirm: () => void
}) {
  const isNative = Capacitor.isNativePlatform()
  const locationHint = canShareFiles()
    ? '系统分享面板（可选保存到任意位置）'
    : isNative
      ? '文档/AiJi/（文件管理器可见）'
      : '浏览器下载目录'
  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/45 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="导出确认"
    >
      <div
        className="w-full max-w-[420px] rounded-screen border-t border-white/10 bg-page p-5 shadow-sheet animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">导出确认</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="mt-3.5 space-y-1.5">
          <div className="flex items-center justify-between rounded-card border border-brd/80 bg-card px-3.5 py-2.5 shadow-sm">
            <span className="text-[13px] text-t2">导出范围</span>
            <span className="text-[13px] font-semibold text-ink">本条目</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd/80 bg-card px-3.5 py-2.5 shadow-sm">
            <span className="text-[13px] text-t2">媒体数</span>
            <span className="text-[13px] font-semibold tabular-nums text-ink">{mediaCount} 个</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd/80 bg-card px-3.5 py-2.5 shadow-sm">
            <span className="text-[13px] text-t2">文件名</span>
            <span className="text-[12px] font-medium text-ink">{filename}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd/80 bg-card px-3.5 py-2.5 shadow-sm">
            <span className="text-[13px] text-t2">保存位置</span>
            <span className="text-[12px] font-medium text-t2">{locationHint}</span>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onConfirm}>
            确认导出
          </Button>
        </div>
      </div>
    </div>
  )
}

// D10: 轻量 toast——3.5s 后自动消失。成功/失败用颜色区分（与 settings/categories 一致）。
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

// D4: 已设提醒卡片——展示 label + dueAt，带「编辑」入口唤起 ReminderCreator 编辑模式。
// 视觉与 ReminderCreator 同源（bg-priS 圆角卡），让创建→编辑卡之间切换不跳样式。
function ExistingReminderCard({
  reminder,
  onEdit,
}: {
  reminder: Reminder
  onEdit: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-pri/15 bg-gradient-to-b from-priS to-priS/60 p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-pri shadow-glowPriSm" />
        <p className="text-[12px] font-bold text-pri">已设提醒</p>
        <button
          type="button"
          onClick={onEdit}
          aria-label="编辑提醒"
          className="ml-auto flex items-center gap-1 rounded-chip border border-brd/80 bg-card px-2 py-1 text-[11px] font-medium text-pri shadow-sm transition-all duration-base ease-out hover:border-t3/40 active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <Pencil size={11} strokeWidth={2.2} />
          编辑
        </button>
      </div>
      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{reminder.label}</p>
      <p className="text-[11px] text-t2">{formatDateTime(reminder.dueAt)}</p>
    </div>
  )
}

// 更多 sheet：导出（下载单条 .zip，D10 加确认+反馈）+ 分享（Web Share 或剪贴板降级）。
function MoreSheet({
  entryId,
  mediaCount,
  onClose,
  onExportResult,
}: {
  entryId: string
  mediaCount: number
  onClose: () => void
  onExportResult: (msg: string, ok: boolean) => void
}) {
  const [confirmExport, setConfirmExport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)

  const handleExport = async () => {
    setConfirmExport(false)
    setExporting(true)
    try {
      const result = await exportEntryZip(entryId)
      // 用户取消分享面板（method=none, error='已取消'）——静默，不弹 toast。
      if (!result.ok && result.method === 'none' && result.error === '已取消') return
      onExportResult(formatSaveFeedback(result), result.ok)
    } catch (e) {
      onExportResult(`导出失败：${e instanceof Error ? e.message : String(e)}`, false)
    } finally {
      setExporting(false)
      onClose()
    }
  }

  const handleShare = async () => {
    const result = await shareEntry(entryId)
    if (result.method === 'share') setShareFeedback('已分享')
    else if (result.method === 'clipboard') setShareFeedback('已复制到剪贴板')
    else setShareFeedback('分享失败')
  }

  const shareLabel = canShareEntry() ? '分享…' : '分享'

  return (
    <>
      <Sheet title="更多操作" onClose={onClose}>
        <button
          type="button"
          onClick={() => setConfirmExport(true)}
          disabled={exporting}
          className="flex w-full items-center justify-between rounded-btn border border-brd bg-card px-4 py-3 text-[14px] font-medium text-ink transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
        >
          <span>导出</span>
          {exporting && <span className="text-[12px] text-t3">导出中…</span>}
        </button>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={handleShare}
            className="flex w-full items-center justify-between rounded-btn border border-brd bg-card px-4 py-3 text-[14px] font-medium text-ink transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <span>{shareLabel}</span>
          </button>
          {shareFeedback && <p className="text-[11px] text-t3">{shareFeedback}</p>}
        </div>
      </Sheet>
      {confirmExport && (
        <ExportConfirmSheet
          filename={`aiji-entry-${entryId}.zip`}
          mediaCount={mediaCount}
          onClose={() => setConfirmExport(false)}
          onConfirm={() => void handleExport()}
        />
      )}
    </>
  )
}

export default function Detail() {
  const { id } = useParams()
  const navigate = useNavigate()
  // 深链兜底：直接访问 /detail/{id}（刷新）时 store 可能还没 hydrate 完，
  // aiByEntry[id] 可能缺。异步从 di.storage.getEntryAi 载入到本地 state，
  // 渲染时优先用 store 的、回落到异步载入的。
  const [asyncAi, setAsyncAi] = useState<EntryAi | undefined>(undefined)
  const [aiLoading, setAiLoading] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  // 编辑/删除 sheet 本地开关。编辑 AI 面板走 updateEntryAi；手动编辑 parts 走 updateEntry；删除走 deleteEntry + 返回首页。
  const [editingAi, setEditingAi] = useState(false)
  const [editingParts, setEditingParts] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  // 详情视图：record=片段自然合并的阅读流（默认）；source=片段式原态，可编辑/删除单片段。
  const [viewMode, setViewMode] = useState<'record' | 'source'>('record')
  // D4: 已设提醒编辑模式——点「编辑」把对应 Reminder 喂给 ReminderCreator(existing)。
  const [editingReminder, setEditingReminder] = useState<Reminder | undefined>(undefined)
  // D10: 导出反馈 toast（MoreSheet 完成后回调，toast 寿命长于 sheet）。
  const [exportToast, setExportToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const entries = useUiStore((s) => s.entries)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const reminders = useUiStore((s) => s.reminders)
  const found = id ? entries.find((e) => e.id === id) : undefined
  const aiFromStore = id ? aiByEntry[id] : undefined

  // 若 store 的 aiByEntry[id] 缺，但 entry 存在，异步从 Dexie 载入 AI（深链兜底）。
  useEffect(() => {
    setAsyncAi(undefined)
    if (!id || !found) return
    if (aiFromStore) return
    let cancelled = false
    setAiLoading(true)
    void (async () => {
      const ai = await di.storage.getEntryAi(id)
      if (cancelled) return
      setAsyncAi(ai)
      setAiLoading(false)
    })()
    return () => { cancelled = true }
  }, [id, found, aiFromStore])

  // processEntry 完成后 store bump entry.updatedAt（成功→ready / 失败→failed 均如此），
  // 据此清掉乐观「处理中」旗标，让 state 回落到 entry.status 的真值。
  useEffect(() => {
    setReprocessing(false)
  }, [found?.updatedAt])

  // D13: 兜底回填地点地址。processEntry 已对新建条目回填，但导入的旧数据或
  // processEntry 失败（catch 块不调 enrichLocation）的条目可能仍无 address。
  // detail 挂载时对无 address 的 location 做 lazy enrich + updateEntry。address 回填后
  // 依赖变化重跑，但此时 loc.address 已存在直接 return，不死循环。
  useEffect(() => {
    const entryId = found?.id
    const loc = found?.location
    if (!entryId || !loc || loc.address) return
    let cancelled = false
    void (async () => {
      const geoKey = (await di.secrets.get('geocoding:key')) ?? undefined
      const enriched = await enrichLocation(loc, { key: geoKey })
      if (cancelled || !enriched.address) return
      void useUiStore.getState().updateEntry(entryId, { location: enriched })
    })()
    return () => { cancelled = true }
  }, [found?.id, found?.location?.address])

  const handleReprocess = () => {
    if (!id) return
    setReprocessing(true)
    void useUiStore.getState().processEntry(id)
  }

  const handleSaveAi = (patch: Partial<EntryAi>) =>
    id ? useUiStore.getState().updateEntryAi(id, patch) : Promise.resolve()

  const handleSaveParts = (parts: EntryPart[]) =>
    id ? useUiStore.getState().updateEntry(id, { parts }) : Promise.resolve()

  const handleConfirmDelete = async () => {
    if (!id) return
    await useUiStore.getState().trashEntry(id)
    navigate('/')
  }

  if (!found) {
    return (
      <div className="px-4">
        <TopBar title="条目详情" onBack={() => navigate('/')} />
        <EmptyState
          title="条目不存在"
          subtitle="该条目可能已被删除"
          action={
            <Button type="button" variant="secondary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </div>
    )
  }

  const entry = found
  const ai = aiFromStore ?? asyncAi
  // D4: 属于本条目的提醒（创建模式在无提醒时弹；已设提醒走 ExistingReminderCard + 编辑）。
  const entryReminders = reminders.filter((r) => r.entryId === entry.id)
  // D10: 导出确认 sheet 展示用——本条目包含的媒体片段数。
  const mediaCount = entry.parts.filter((p) => p.type === 'audio' || p.type === 'video').length
  // 原态视图：单片段删除 / 文本片段编辑 → updateEntry(id, { parts })。
  const removePartAt = (idx: number) => {
    if (!id) return
    const next = entry.parts.filter((_, i) => i !== idx)
    void useUiStore.getState().updateEntry(id, { parts: next })
  }
  const editPartAt = (idx: number, content: string) => {
    if (!id) return
    const next = entry.parts.map((p, i) => (i === idx && p.type === 'text' ? { ...p, content } : p))
    void useUiStore.getState().updateEntry(id, { parts: next })
  }
  const baseState: AiState = statusToAiState(entry.status)
  // 重处理中：乐观显示 processing（processEntry 不即改 status，需本地旗标过渡；
  // store 在完成时 bump updatedAt，上面 effect 据此清旗标，state 回落到真值）。
  // entry 标记 ready 但 AI 尚在异步载入（深链 race）→ 也显示 processing skeleton，
  // 别闪「暂无 AI 处理结果」。
  const state: AiState = reprocessing
    ? 'processing'
    : baseState === 'ready' && !ai && aiLoading
      ? 'processing'
      : baseState

  return (
    <div className="flex flex-col gap-3 px-4 pb-8">
      <TopBar
        title={formatTitle(entry.createdAt)}
        onBack={() => (window.history.length <= 1 ? navigate('/') : navigate(-1))}
        onMore={() => setMoreOpen(true)}
      />

      <div className="flex items-center gap-1 self-start rounded-[12px] border border-brd/60 bg-page p-1 shadow-inner">
        <button
          type="button"
          onClick={() => setViewMode('record')}
          aria-pressed={viewMode === 'record'}
          className={cn(
            'rounded-[9px] px-3.5 py-1.5 text-[12px] transition-all duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            viewMode === 'record'
              ? 'bg-card font-semibold text-ink shadow-sm'
              : 'font-medium text-t3 hover:text-t2 active:scale-95',
          )}
        >
          记录
        </button>
        <button
          type="button"
          onClick={() => setViewMode('source')}
          aria-pressed={viewMode === 'source'}
          className={cn(
            'rounded-[9px] px-3.5 py-1.5 text-[12px] transition-all duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            viewMode === 'source'
              ? 'bg-card font-semibold text-ink shadow-sm'
              : 'font-medium text-t3 hover:text-t2 active:scale-95',
          )}
        >
          原态
        </button>
      </div>

      {viewMode === 'record' ? (
        <RecordView parts={entry.parts} />
      ) : (
        <div className="flex flex-col gap-3">
          {entry.parts.map((part, i) => (
            <SourcePartView
              key={i}
              part={part}
              iso={entry.createdAt}
              onRemove={() => removePartAt(i)}
              onEditText={(c) => editPartAt(i, c)}
            />
          ))}
        </div>
      )}

      <AiPanel
        state={state}
        ai={ai}
        processError={entry.processError}
        onReprocess={handleReprocess}
        onEdit={() => setEditingAi(true)}
        onManualEdit={() => setEditingParts(true)}
        onDelete={() => setConfirmingDelete(true)}
      />

      {state === 'ready' && ai && (ai.category === 'errand' || !!ai.facets.event || !!ai.reminderSuggestion) && !ai.todoDismissed && entryReminders.length === 0 && (
        <ReminderCreator
          entryId={entry.id}
          title={ai.titleSuggestion ?? ''}
          suggestion={ai.reminderSuggestion}
          onDone={() => {}}
        />
      )}

      {/* D4: 已设提醒卡片——展示 label/dueAt + 编辑入口；点编辑把该 Reminder 传给 ReminderCreator 编辑模式。 */}
      {entryReminders.map((r) =>
        editingReminder?.id === r.id ? (
          <ReminderCreator
            key={r.id}
            entryId={entry.id}
            title={ai?.titleSuggestion ?? ''}
            existing={r}
            onDone={() => setEditingReminder(undefined)}
          />
        ) : (
          <ExistingReminderCard key={r.id} reminder={r} onEdit={() => setEditingReminder(r)} />
        ),
      )}

      {/* D5: 地点标签——entry.location 存在时显示地址（或 lat/lng 回落），否则提示未记录。 */}
      <LocationBadge location={entry.location} />

      {editingAi && ai && (
        <AiEditSheet ai={ai} onSave={handleSaveAi} onClose={() => setEditingAi(false)} />
      )}
      {editingParts && (
        <PartsEditSheet parts={entry.parts} onSave={handleSaveParts} onClose={() => setEditingParts(false)} />
      )}
      {confirmingDelete && (
        <ConfirmDeleteDialog onConfirm={handleConfirmDelete} onClose={() => setConfirmingDelete(false)} />
      )}
      {moreOpen && id && (
        <MoreSheet
          entryId={id}
          mediaCount={mediaCount}
          onClose={() => setMoreOpen(false)}
          onExportResult={(msg, ok) => setExportToast({ msg, ok })}
        />
      )}
      {exportToast && (
        <Toast
          message={exportToast.msg}
          ok={exportToast.ok}
          onDismiss={() => setExportToast(null)}
        />
      )}
    </div>
  )
}
