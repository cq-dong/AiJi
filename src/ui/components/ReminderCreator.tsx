import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import { getCurrentLang } from '@/app/currentLang'
import type { I18nKey } from '@/app/i18n'
import { Button } from './Button'
import { cn } from './cn'
import type { Reminder } from '@/domain/types'

// 统一的待办创建/编辑器：弹窗(ReminderPopup)与 detail 内联两处复用，修四问题——
//   1) 旧「创建待办/提醒我」两按钮都建 Reminder 只差 dueAt 来源 → 合并成单按钮+时间选择。
//   2) 旧 TodoConfirm 条件 `!reminderSuggestion` 在确认后反而为真 + 靠 local state 藏卡 → 重进重现；
//      本组件不靠 local，confirmReminder/updateEntryAi 置持久 ai.todoDismissed 由父级条件 reactive 藏。
//   3) 旧「创建待办」硬编码今日 23:59 丢检出时间 → 时间选择器：检出时间默认选中，无则给快捷选项+自定义。
//   4) D4: 卡片 UI 按设计 tokens 美化 + 已设提醒可编辑（改时间/内容，调 store.editReminder 重新 schedule）。
//
// 两种模式：
//   - 创建模式（mode='create'）：从 AI suggestion 或用户手建新 Reminder。
//   - 编辑模式（mode='edit'）：传入 existing Reminder，改 dueAt/label 后调 editReminder。

type TFn = (key: I18nKey, params?: Record<string, string | number>) => string

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

function locale(): string {
  return getCurrentLang() === 'zh' ? 'zh-CN' : 'en-US'
}

// ISO → "今天 15:00" / "明天 09:00" / "后天 18:00" / "7/18 15:00"（相对词走 t()，数字日期走 Intl）
function fmtRel(iso: string, t: TFn): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return t('comp.reminder.custom')
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (diff === 0) return `${t('date.today')} ${hhmm}`
  if (diff === 1) return `${t('comp.rel.tomorrow')} ${hhmm}`
  if (diff === 2) return `${t('comp.rel.dayAfter')} ${hhmm}`
  return `${new Intl.DateTimeFormat(locale(), { month: 'numeric', day: 'numeric' }).format(d)} ${hhmm}`
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

function buildPicks(detectedIso: string | undefined, t: TFn): TimePick[] {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayAfter = new Date(now)
  dayAfter.setDate(dayAfter.getDate() + 2)
  // coming Saturday (0=Sun..6=Sat)
  const sat = new Date(now)
  sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7))
  const picks: TimePick[] = []
  if (detectedIso) picks.push({ key: 'detected', label: `AI · ${fmtRel(detectedIso, t)}`, iso: detectedIso })
  picks.push({ key: 'today', label: `${t('date.today')} 23:59`, iso: atTime(now, 23, 59).toISOString() })
  picks.push({ key: 'tmw-am', label: `${t('comp.rel.tomorrow')} 09:00`, iso: atTime(tomorrow, 9, 0).toISOString() })
  picks.push({ key: 'tmw-pm', label: `${t('comp.rel.tomorrow')} 18:00`, iso: atTime(tomorrow, 18, 0).toISOString() })
  picks.push({ key: 'day-after', label: `${t('comp.rel.dayAfter')} 09:00`, iso: atTime(dayAfter, 9, 0).toISOString() })
  picks.push({ key: 'weekend', label: `${t('comp.rel.saturday')} 09:00`, iso: atTime(sat, 9, 0).toISOString() })
  return picks
}

interface ReminderCreatorProps {
  entryId: string
  title: string
  suggestion?: { dueAt: string; label: string }
  onDone: () => void
  // D4: 编辑模式。传入 existing Reminder → 编辑其 dueAt/label（调 store.editReminder）。
  // 不传 → 创建模式（调 store.confirmReminder 建新 Reminder）。
  existing?: Reminder
}

export function ReminderCreator({
  entryId,
  title,
  suggestion,
  onDone,
  existing,
}: ReminderCreatorProps) {
  const t = useT()
  // useT 已订阅 language；lang 入 useMemo 依赖，语言切换时快捷选项 label 重算（否则 stale）。
  const lang = getCurrentLang()
  const mode: 'create' | 'edit' = existing ? 'edit' : 'create'
  const initialDueAt = existing?.dueAt ?? suggestion?.dueAt
  const picks = useMemo(() => buildPicks(initialDueAt, t), [initialDueAt, lang, t])
  const [selectedKey, setSelectedKey] = useState<string>(() => {
    if (mode === 'edit' && initialDueAt) {
      // 编辑模式：若初始时间不在快捷选项里，默认选 custom 并填入
      const match = picks.find((p) => p.iso === initialDueAt)
      return match?.key ?? 'custom'
    }
    return picks[0]?.key ?? 'custom'
  })
  const [customLocal, setCustomLocal] = useState<string>(() =>
    initialDueAt ? isoToLocalInput(initialDueAt) : '',
  )
  const [label, setLabel] = useState<string>(existing?.label ?? suggestion?.label ?? title)
  const [busy, setBusy] = useState(false)
  // confirmReminder/updateEntryAi/editReminder 置持久态 → 父级条件 reactive 卸载本组件；
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

  const headerLabel = mode === 'edit' ? t('comp.reminder.header.edit') : t('comp.reminder.header.create')
  const submitLabel = mode === 'edit' ? t('comp.reminder.submit.edit') : t('comp.reminder.submit.create')
  const submitAction =
    mode === 'edit' && existing
      ? () => useUiStore.getState().editReminder(existing.id, resolvedIso, label)
      : () => useUiStore.getState().confirmReminder(entryId, resolvedIso, label)

  return (
    <div className="flex flex-col gap-3 rounded-card border border-pri/15 bg-gradient-to-b from-priS to-priS/60 p-4 shadow-card animate-fade-in-up">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-pri shadow-glowPriSm" />
        <p className="text-[12px] font-bold text-pri">{headerLabel}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t2">{t('comp.reminder.contentLabel')}</label>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t2">{t('comp.reminder.timeLabel')}</label>
        <div className="flex flex-wrap gap-1.5">
          {picks.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setSelectedKey(p.key)}
              className={cn(
                'rounded-chip px-3 py-1.5 text-[12px] font-medium transition-all duration-base ease-out active:scale-95',
                selectedKey === p.key
                  ? 'bg-pri text-white shadow-glowPriSm'
                  : 'bg-card text-t2 border border-brd/80 shadow-sm hover:border-t3/40',
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedKey('custom')}
            className={cn(
              'rounded-chip px-3 py-1.5 text-[12px] font-medium transition-all duration-base ease-out active:scale-95',
              selectedKey === 'custom'
                ? 'bg-pri text-white shadow-glowPriSm'
                : 'bg-card text-t2 border border-brd/80 shadow-sm hover:border-t3/40',
            )}
          >
            {t('comp.reminder.custom')}
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
        <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => run(submitAction)}>
          {submitLabel}
        </Button>
        {mode === 'create' && (
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
            {t('comp.reminder.ignore')}
          </Button>
        )}
      </div>
    </div>
  )
}
