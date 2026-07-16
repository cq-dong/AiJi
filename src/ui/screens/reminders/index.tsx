import { useNavigate } from 'react-router-dom'
import { Button } from '@/ui/components'
import { useUiStore } from '@/app/store'

// 本地 helper：格式化到期时间为「M/D HH:MM」（月/日不补零，时分补零）。
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDueAt(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const STATUS_LABELS = {
  pending: '待提醒',
  fired: '已提醒',
  snoozed: '已稍后',
  missed: '已错过',
} as const

function EmptyPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-card border border-dashed border-brd py-3">
      <p className="text-[12px] text-t3">{text}</p>
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[12px] font-semibold text-t2">{title}</h2>
      {count > 0 && (
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-priS px-1 text-[11px] font-medium text-pri">
          {count}
        </span>
      )}
    </div>
  )
}

export default function Reminders() {
  const navigate = useNavigate()
  const reminders = useUiStore((s) => s.reminders)
  const snoozeReminder = useUiStore((s) => s.snoozeReminder)
  const dismissReminder = useUiStore((s) => s.dismissReminder)

  // 待提醒：pending + snoozed，按到期时间升序（最近到期的在前）。
  const pending = reminders
    .filter((r) => r.status === 'pending' || r.status === 'snoozed')
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())

  // 已提醒：fired，按到期时间降序（最新触发的在前）。
  const fired = reminders
    .filter((r) => r.status === 'fired')
    .sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime())

  // 已错过：missed，按到期时间降序。
  const missed = reminders
    .filter((r) => r.status === 'missed')
    .sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime())

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-[24px] font-bold text-ink">提醒与待办</h1>
      <p className="mt-1 text-[11px] text-t3">查看与管理提醒事项 · 共 {reminders.length} 条</p>

      {/* 待提醒 */}
      <section className="mt-6">
        <SectionHeader title="待提醒" count={pending.length} />
        <div className="mt-2 space-y-2">
          {pending.length === 0 ? (
            <EmptyPlaceholder text="暂无待提醒事项" />
          ) : (
            pending.map((r) => (
              <div key={r.id} className="rounded-card border border-brd bg-card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-t3">{formatDueAt(r.dueAt)}</span>
                  <span className="rounded-chip bg-priS px-2 py-0.5 text-[11px] font-medium text-pri">
                    {STATUS_LABELS[r.status]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/detail/${r.entryId}`)}
                  className="mt-2 block text-left text-[13px] text-ink underline"
                >
                  {r.label}
                </button>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void snoozeReminder(r.id, 10)}>
                    稍后提醒
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void dismissReminder(r.id)}>
                    取消
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 已提醒 */}
      <section className="mt-6">
        <SectionHeader title="已提醒" count={fired.length} />
        <div className="mt-2 space-y-2">
          {fired.length === 0 ? (
            <EmptyPlaceholder text="暂无已提醒记录" />
          ) : (
            fired.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/detail/${r.entryId}`)}
                className="flex w-full items-center justify-between rounded-card border border-brd bg-card p-3"
              >
                <div className="flex flex-col items-start gap-1">
                  <span className="text-[12px] text-t3">{formatDueAt(r.dueAt)}</span>
                  <span className="text-[13px] text-ink">{r.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-chip bg-priS px-2 py-0.5 text-[11px] font-medium text-t2">
                    {STATUS_LABELS[r.status]}
                  </span>
                  <span className="text-[16px] text-t3">›</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* 已错过 */}
      <section className="mt-6">
        <SectionHeader title="已错过" count={missed.length} />
        <div className="mt-2 space-y-2">
          {missed.length === 0 ? (
            <EmptyPlaceholder text="暂无错过记录" />
          ) : (
            missed.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/detail/${r.entryId}`)}
                className="flex w-full items-center justify-between rounded-card border border-brd bg-card p-3"
              >
                <div className="flex flex-col items-start gap-1">
                  <span className="text-[12px] text-t3">{formatDueAt(r.dueAt)}</span>
                  <span className="text-[13px] text-ink">{r.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-chip bg-priS px-2 py-0.5 text-[11px] font-medium text-catFail">
                    {STATUS_LABELS[r.status]}
                  </span>
                  <span className="text-[16px] text-t3">›</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
