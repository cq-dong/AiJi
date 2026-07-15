import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState, cn } from '@/ui/components'
import { seedEntries, seedEntryAi } from '@/data/seed'
import type { EntryStatus } from '@/domain/types'
import { PartView } from './PartView'
import { AiPanel, type AiState } from './AiPanel'
import { formatTitle } from './helpers'

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

function DemoToggle({ value, onChange }: { value: AiState; onChange: (s: AiState) => void }) {
  const segs: { key: AiState; label: string }[] = [
    { key: 'ready', label: '完成' },
    { key: 'processing', label: '处理中' },
    { key: 'failed', label: '失败' },
  ]
  return (
    <div className="flex items-center gap-2 rounded-card border border-brd bg-card p-2">
      <span className="text-[11px] text-t3">预览</span>
      <div className="flex flex-1 rounded-btn bg-page p-0.5">
        {segs.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(s.key)}
            className={cn(
              'flex-1 rounded-[10px] py-1.5 text-[11px] font-medium transition',
              value === s.key ? 'bg-card text-ink shadow-sm' : 'text-t3',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Detail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [override, setOverride] = useState<AiState | null>(null)

  useEffect(() => {
    setOverride(null)
  }, [id])

  const found = id ? seedEntries.find((e) => e.id === id) : undefined

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
  const ai = seedEntryAi.find((a) => a.entryId === entry.id)
  const state: AiState = override ?? statusToAiState(entry.status)

  return (
    <div className="flex flex-col gap-3 px-4 pb-8">
      <TopBar title={formatTitle(entry.createdAt)} onBack={() => navigate(-1)} />

      {entry.parts.map((part, i) => (
        <PartView key={i} part={part} iso={entry.createdAt} />
      ))}

      <AiPanel state={state} ai={ai} />

      {state === 'ready' && ai && (ai.category === 'errand' || !!ai.facets.event) && (
        <TodoConfirm title={ai.titleSuggestion ?? ''} />
      )}

      <p className="text-[11px] text-t3">◎ 地点：未记录（设置中可开启）</p>

      <DemoToggle value={state} onChange={setOverride} />
    </div>
  )
}
