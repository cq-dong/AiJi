import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '@/app/store'
import { Button } from './Button'
import { cn } from './cn'

// 统一的待办创建器：弹窗(ReminderPopup)与 detail 内联两处复用，修三问题——
//   1) 旧「创建待办/提醒我」两按钮都建 Reminder 只差 dueAt 来源 → 合并成单按钮+时间选择。
//   2) 旧 TodoConfirm 条件 `!reminderSuggestion` 在确认后反而为真 + 靠 local state 藏卡 → 重进重现；
//      本组件不靠 local，confirmReminder/updateEntryAi 置持久 ai.todoDismissed 由父级条件 reactive 藏。
//   3) 旧「创建待办」硬编码今日 23:59 丢检出时间 → 时间选择器：检出时间默认选中，无则给快捷选项+自定义。

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function atTime(base: Date, h: number, m: number): Date {
  const x = new Date(base)
  x.setHours(h, m, 0, 0)
  return x
}

// ISO → "今天 15:00" / "明天 09:00" / "后天 18:00" / "7/18 15:00"
function fmtRel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '自定义'
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (diff === 0) return `今天 ${hhmm}`
  if (diff === 1) return `明天 ${hhmm}`
  if (diff === 2) return `后天 ${hhmm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`
}

// ISO → datetime-local input value (YYYY-MM-DDTHH:MM, local)
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(local: string): string {
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) {
    const t = new Date()
    t.setHours(23, 59, 0, 0)
    return t.toISOString()
  }
  return d.toISOString()
}

type TimePick = { key: string; label: string; iso: string }

function buildPicks(detectedIso: string | undefined): TimePick[] {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayAfter = new Date(now)
  dayAfter.setDate(dayAfter.getDate() + 2)
  // coming Saturday (0=Sun..6=Sat)
  const sat = new Date(now)
  sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7))
  const picks: TimePick[] = []
  if (detectedIso) picks.push({ key: 'detected', label: `AI · ${fmtRel(detectedIso)}`, iso: detectedIso })
  picks.push({ key: 'today', label: '今天 23:59', iso: atTime(now, 23, 59).toISOString() })
  picks.push({ key: 'tmw-am', label: '明天 09:00', iso: atTime(tomorrow, 9, 0).toISOString() })
  picks.push({ key: 'tmw-pm', label: '明天 18:00', iso: atTime(tomorrow, 18, 0).toISOString() })
  picks.push({ key: 'day-after', label: '后天 09:00', iso: atTime(dayAfter, 9, 0).toISOString() })
  picks.push({ key: 'weekend', label: '周六 09:00', iso: atTime(sat, 9, 0).toISOString() })
  return picks
}

export function ReminderCreator({
  entryId,
  title,
  suggestion,
  onDone,
}: {
  entryId: string
  title: string
  suggestion?: { dueAt: string; label: string }
  onDone: () => void
}) {
  const picks = useMemo(() => buildPicks(suggestion?.dueAt), [suggestion?.dueAt])
  const [selectedKey, setSelectedKey] = useState<string>(() => picks[0]?.key ?? 'custom')
  const [customLocal, setCustomLocal] = useState<string>(() => (suggestion?.dueAt ? isoToLocalInput(suggestion.dueAt) : ''))
  const [label, setLabel] = useState<string>(suggestion?.label ?? title)
  const [busy, setBusy] = useState(false)
  // confirmReminder/updateEntryAi 置 ai.todoDismissed → 父级条件 reactive 卸载本组件；
  // mounted ref 防 finally setBusy 打到已卸载实例。
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const resolvedIso =
    selectedKey === 'custom'
      ? localInputToIso(customLocal)
      : picks.find((p) => p.key === selectedKey)?.iso ?? localInputToIso(customLocal)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      if (mounted.current) setBusy(false)
      onDone()
    }
  }

  const inputCls =
    'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card'

  return (
    <div className="flex flex-col gap-3 rounded-card bg-priS p-4">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-pri" />
        <p className="text-[12px] font-bold text-pri">AI 检测到 · 待办</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t2">提醒内容</label>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t2">提醒时间</label>
        <div className="flex flex-wrap gap-1.5">
          {picks.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setSelectedKey(p.key)}
              className={cn(
                'rounded-chip px-3 py-1.5 text-[12px] font-medium transition',
                selectedKey === p.key ? 'bg-pri text-white' : 'bg-card text-t2 border border-brd',
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedKey('custom')}
            className={cn(
              'rounded-chip px-3 py-1.5 text-[12px] font-medium transition',
              selectedKey === 'custom' ? 'bg-pri text-white' : 'bg-card text-t2 border border-brd',
            )}
          >
            自定义
          </button>
        </div>
        {selectedKey === 'custom' && (
          <input
            type="datetime-local"
            value={customLocal}
            onChange={(e) => setCustomLocal(e.target.value)}
            className={inputCls}
          />
        )}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => run(() => useUiStore.getState().confirmReminder(entryId, resolvedIso, label))}
        >
          创建待办
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-t3"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await useUiStore.getState().updateEntryAi(entryId, {
                reminderSuggestion: undefined,
                todoDismissed: true,
              })
            })
          }
        >
          忽略
        </Button>
      </div>
    </div>
  )
}
