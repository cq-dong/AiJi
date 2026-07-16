import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { di } from '@/app/di'
import type { EntryAi, EntryPart, EntryStatus } from '@/domain/types'
import { PartView } from './PartView'
import { AiPanel, type AiState } from './AiPanel'
import { Sheet } from './Sheet'
import { formatTitle, formatDuration, partTypeLabel, tagLabel } from './helpers'

// ISO 8601 → datetime-local input format (YYYY-MM-DDTHH:MM, local time)
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// datetime-local input value → ISO 8601 string
function localInputToIso(local: string): string {
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

// 「创建待办」无具体时间 → 默认今日 23:59 到点（domain 无 Todo 类型，复用 Reminder）。
function endOfTodayIso(): string {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}

function statusToAiState(s: EntryStatus): AiState {
  if (s === 'processing') return 'processing'
  if (s === 'failed') return 'failed'
  if (s === 'ready') return 'ready'
  return 'processing'
}

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex h-11 items-center">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回"
        className="flex size-8 items-center justify-center text-[26px] leading-none font-light text-t2"
      >
        ‹
      </button>
      <h1 className="flex-1 text-center text-[17px] font-bold text-ink">{title}</h1>
      <button
        type="button"
        aria-label="更多"
        className="flex size-8 items-center justify-center text-[20px] leading-none text-t2"
      >
        ···
      </button>
    </div>
  )
}

function TodoConfirm({
  entryId,
  title,
  suggestion,
  onDismissed,
}: {
  entryId: string
  title: string
  suggestion?: { dueAt: string; label: string }
  onDismissed: () => void
}) {
  // domain 只有 Reminder（无 Todo 类型）。「待办/提醒我」均建 Reminder，区别在 dueAt 来源：
  // 待办 → 今日 23:59（无具体时间）；提醒我 → 用 LLM 建议 dueAt（无建议亦回落今日 23:59）。
  // 忽略 → 清 reminderSuggestion（有建议才写）+ 本地藏卡。
  const [busy, setBusy] = useState(false)
  const label = suggestion?.label ?? title
  const remindDue = suggestion?.dueAt ?? endOfTodayIso()

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      onDismissed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-card bg-catPending/10 p-4">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-catPending" />
        <p className="text-[12px] font-bold text-catPending">LLM 检测到 · 待办</p>
      </div>
      <p className="text-[13px] font-medium text-ink">「{title}」</p>
      <p className="text-[11px] text-t3">作为待办创建？可设提醒时间。</p>
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => run(() => useUiStore.getState().confirmReminder(entryId, endOfTodayIso(), label))}
        >
          创建待办
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => useUiStore.getState().confirmReminder(entryId, remindDue, label))}
        >
          提醒我
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-t3"
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (suggestion) await useUiStore.getState().updateEntryAi(entryId, { reminderSuggestion: undefined })
            })
          }
        >
          忽略
        </Button>
      </div>
    </div>
  )
}

function ReminderConfirm({
  entryId,
  suggestion,
  onDismissed,
}: {
  entryId: string
  suggestion: { dueAt: string; label: string }
  onDismissed: () => void
}) {
  const [dueAt, setDueAt] = useState(() => isoToLocalInput(suggestion.dueAt))
  const [label, setLabel] = useState(suggestion.label)
  const [confirming, setConfirming] = useState(false)

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      await useUiStore.getState().confirmReminder(entryId, localInputToIso(dueAt), label)
      onDismissed()
    } finally {
      setConfirming(false)
    }
  }

  const inputCls =
    'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

  return (
    <div className="flex flex-col gap-3 rounded-card bg-priS p-4">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-pri" />
        <p className="text-[12px] font-bold text-pri">AI 建议 · 提醒</p>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-[11px] text-t2">提醒时间</label>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className={inputCls}
        />
        <label className="text-[11px] text-t2">提醒内容</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={inputCls}
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button type="button" size="sm" variant="primary" onClick={handleConfirm} disabled={confirming}>
          确认提醒
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-t3" onClick={onDismissed}>
          忽略
        </Button>
      </div>
    </div>
  )
}

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

  const inputCls = 'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

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

  const inputCls = 'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

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
      <button type="button" aria-label="取消" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative flex w-full max-w-[300px] flex-col gap-3 rounded-card bg-card p-4">
        <h3 className="text-[14px] font-bold text-ink">删除条目</h3>
        <p className="text-[12px] leading-relaxed text-t2">删除后不可恢复，关联提醒也会一并删除。</p>
        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="primary" className="flex-1 bg-catFail" onClick={handleDelete} disabled={deleting}>
            删除
          </Button>
        </div>
      </div>
    </div>
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
  // B6: 本地旗标——确认/忽略后隐藏提醒卡。keyed by entry id，不持久化。
  const [reminderHidden, setReminderHidden] = useState<Record<string, boolean>>({})
  // 待办卡本地旗标——创建/提醒/忽略后藏卡（TodoConfirm 基于 errand/event 显，不随 reminderSuggestion 变）。
  const [todoHidden, setTodoHidden] = useState<Record<string, boolean>>({})
  // 编辑/删除 sheet 本地开关。编辑 AI 面板走 updateEntryAi；手动编辑 parts 走 updateEntry；删除走 deleteEntry + 返回首页。
  const [editingAi, setEditingAi] = useState(false)
  const [editingParts, setEditingParts] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const entries = useUiStore((s) => s.entries)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
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
    await useUiStore.getState().deleteEntry(id)
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
      />

      {entry.parts.map((part, i) => (
        <PartView key={i} part={part} iso={entry.createdAt} />
      ))}

      <AiPanel
        state={state}
        ai={ai}
        onReprocess={handleReprocess}
        onEdit={() => setEditingAi(true)}
        onManualEdit={() => setEditingParts(true)}
        onDelete={() => setConfirmingDelete(true)}
      />

      {state === 'ready' && ai && (ai.category === 'errand' || !!ai.facets.event) && !todoHidden[entry.id] && (
        <TodoConfirm
          entryId={entry.id}
          title={ai.titleSuggestion ?? ''}
          suggestion={ai.reminderSuggestion}
          onDismissed={() => setTodoHidden((h) => ({ ...h, [entry.id]: true }))}
        />
      )}

      {state === 'ready' && ai?.reminderSuggestion && !reminderHidden[entry.id] && (
        <ReminderConfirm
          entryId={entry.id}
          suggestion={ai.reminderSuggestion}
          onDismissed={() => setReminderHidden((h) => ({ ...h, [entry.id]: true }))}
        />
      )}

      <p className="text-[11px] text-t3">◎ 地点：未记录（设置中可开启）</p>

      {editingAi && ai && (
        <AiEditSheet ai={ai} onSave={handleSaveAi} onClose={() => setEditingAi(false)} />
      )}
      {editingParts && (
        <PartsEditSheet parts={entry.parts} onSave={handleSaveParts} onClose={() => setEditingParts(false)} />
      )}
      {confirmingDelete && (
        <ConfirmDeleteDialog onConfirm={handleConfirmDelete} onClose={() => setConfirmingDelete(false)} />
      )}
    </div>
  )
}
