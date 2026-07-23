import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Clock, Trash2 } from 'lucide-react'
import { SwipeableCard } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import type { Reminder, ReminderStatus } from '@/domain/types'

// 本地 helper：格式化到期时间为「M/D HH:MM」（月/日不补零，时分补零）。
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDueAt(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function EmptyPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-card border border-dashed border-brd py-4">
      <p className="text-[12px] text-t3">{text}</p>
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-t2">{title}</h2>
      {count > 0 && (
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-priS px-1.5 text-[11px] font-semibold tabular-nums text-pri">
          {count}
        </span>
      )}
      <span className="h-px flex-1 bg-gradient-to-r from-brd to-transparent" aria-hidden="true" />
    </div>
  )
}

export default function Reminders() {
  const navigate = useNavigate()
  const t = useT()
  const reminders = useUiStore((s) => s.reminders)
  const snoozeReminder = useUiStore((s) => s.snoozeReminder)
  const dismissReminder = useUiStore((s) => s.dismissReminder)

  // 状态标签：组件内用 t() 构建，切语言随渲染更新。
  const STATUS_LABELS: Record<ReminderStatus, string> = {
    pending: t('reminders.status.pending'),
    fired: t('reminders.status.fired'),
    snoozed: t('reminders.status.snoozed'),
    missed: t('reminders.status.missed'),
  }

  const byDueAsc = (a: Reminder, b: Reminder) =>
    new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  const byDueDesc = (a: Reminder, b: Reminder) =>
    new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime()

  // 待提醒：pending + snoozed，按到期时间升序（最近到期的在前）。
  const pending = reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed').sort(byDueAsc)
  // 已提醒：fired，按到期时间降序（最新触发的在前）。
  const fired = reminders.filter((r) => r.status === 'fired').sort(byDueDesc)
  // 已错过：missed，按到期时间降序。
  const missed = reminders.filter((r) => r.status === 'missed').sort(byDueDesc)

  const open = (entryId: string) => navigate(`/detail/${entryId}`)

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-[24px] font-bold text-ink">{t('reminders.title')}</h1>
      <p className="mt-1 text-[11px] text-t3">
        {t('reminders.subtitle', { count: reminders.length })}
      </p>

      {/* 待提醒：右滑「稍后」，左滑「完成」 */}
      <section className="mt-6">
        <SectionHeader title={t('reminders.section.pending')} count={pending.length} />
        <div className="mt-2 space-y-2">
          {pending.length === 0 ? (
            <EmptyPlaceholder text={t('reminders.empty.pending')} />
          ) : (
            pending.map((r) => (
              <SwipeableCard
                key={r.id}
                className="shadow-card"
                onClick={() => open(r.entryId)}
                leftActions={[
                  {
                    key: 'snooze',
                    label: t('reminders.action.snooze'),
                    icon: <Clock size={16} />,
                    color: 'bg-amber-500',
                    onAction: () => snoozeReminder(r.id, 10),
                  },
                ]}
                rightActions={[
                  {
                    key: 'done',
                    label: t('common.done'),
                    icon: <Check size={16} />,
                    color: 'bg-emerald-500',
                    hapticStyle: 'success',
                    onAction: () => dismissReminder(r.id),
                  },
                ]}
              >
                <div className="p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] tabular-nums text-t3">{formatDueAt(r.dueAt)}</span>
                    <span className="rounded-chip border border-pri/10 bg-priS px-2 py-0.5 text-[11px] font-medium text-pri">
                      {STATUS_LABELS[r.status]}
                    </span>
                  </div>
                  <p className="mt-2 min-h-11 py-2 text-[13px] text-ink">{r.label}</p>
                </div>
              </SwipeableCard>
            ))
          )}
        </div>
      </section>

      {/* 已提醒：左滑「清除」 */}
      <section className="mt-6">
        <SectionHeader title={t('reminders.section.fired')} count={fired.length} />
        <div className="mt-2 space-y-2">
          {fired.length === 0 ? (
            <EmptyPlaceholder text={t('reminders.empty.fired')} />
          ) : (
            fired.map((r) => (
              <SwipeableCard
                key={r.id}
                className="shadow-card"
                onClick={() => open(r.entryId)}
                rightActions={[
                  {
                    key: 'clear',
                    label: t('reminders.action.clear'),
                    icon: <Trash2 size={16} />,
                    color: 'bg-t3',
                    onAction: () => dismissReminder(r.id),
                  },
                ]}
              >
                <div className="flex items-center justify-between p-3">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-[12px] text-t3">{formatDueAt(r.dueAt)}</span>
                    <span className="text-[13px] text-ink">{r.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-chip bg-priS px-2 py-0.5 text-[11px] font-medium text-t2">
                      {STATUS_LABELS[r.status]}
                    </span>
                    <ChevronRight size={16} className="text-t3" />
                  </div>
                </div>
              </SwipeableCard>
            ))
          )}
        </div>
      </section>

      {/* 已错过：左滑「清除」（危险色） */}
      <section className="mt-6">
        <SectionHeader title={t('reminders.section.missed')} count={missed.length} />
        <div className="mt-2 space-y-2">
          {missed.length === 0 ? (
            <EmptyPlaceholder text={t('reminders.empty.missed')} />
          ) : (
            missed.map((r) => (
              <SwipeableCard
                key={r.id}
                className="shadow-card"
                onClick={() => open(r.entryId)}
                rightActions={[
                  {
                    key: 'clear',
                    label: t('reminders.action.clear'),
                    icon: <Trash2 size={16} />,
                    color: 'bg-catFail',
                    hapticStyle: 'warning',
                    onAction: () => dismissReminder(r.id),
                  },
                ]}
              >
                <div className="flex items-center justify-between p-3">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-[12px] text-t3">{formatDueAt(r.dueAt)}</span>
                    <span className="text-[13px] text-ink">{r.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-chip bg-priS px-2 py-0.5 text-[11px] font-medium text-catFail">
                      {STATUS_LABELS[r.status]}
                    </span>
                    <ChevronRight size={16} className="text-t3" />
                  </div>
                </div>
              </SwipeableCard>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
