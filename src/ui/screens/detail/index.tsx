import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { di } from '@/app/di'
import type { EntryAi, EntryStatus } from '@/domain/types'
import { PartView } from './PartView'
import { AiPanel, type AiState } from './AiPanel'
import { formatTitle } from './helpers'

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

function TodoConfirm({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-card bg-catPending/10 p-4">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-catPending" />
        <p className="text-[12px] font-bold text-catPending">LLM 检测到 · 待办</p>
      </div>
      <p className="text-[13px] font-medium text-ink">「{title}」</p>
      <p className="text-[11px] text-t3">作为待办创建？可设提醒时间。</p>
      <div className="flex items-center gap-2 pt-1">
        <Button type="button" size="sm" variant="primary">
          创建待办
        </Button>
        <Button type="button" size="sm" variant="secondary">
          提醒我
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-t3">
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

      <AiPanel state={state} ai={ai} onReprocess={handleReprocess} />

      {state === 'ready' && ai && (ai.category === 'errand' || !!ai.facets.event) && (
        <TodoConfirm title={ai.titleSuggestion ?? ''} />
      )}

      {state === 'ready' && ai?.reminderSuggestion && !reminderHidden[entry.id] && (
        <ReminderConfirm
          entryId={entry.id}
          suggestion={ai.reminderSuggestion}
          onDismissed={() => setReminderHidden((h) => ({ ...h, [entry.id]: true }))}
        />
      )}

      <p className="text-[11px] text-t3">◎ 地点：未记录（设置中可开启）</p>
    </div>
  )
}
