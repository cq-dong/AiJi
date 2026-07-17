import { useUiStore } from '@/app/store'
import { ReminderCreator } from './ReminderCreator'

// 保存后即时弹窗：processEntry(isFresh=true) 检出 reminderSuggestion → store.pendingReminder →
// AppShell(MainLayout) 渲本组件。modal 承载 ReminderCreator（与 detail 内联同组件同语义）。
// onDone=dismissPendingReminder 关 modal。detail 的 reprocess 走 isFresh=false 不弹。

export function ReminderPopup() {
  const pending = useUiStore((s) => s.pendingReminder)
  if (!pending) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="m-4 w-full max-w-sm">
        <ReminderCreator
          entryId={pending.entryId}
          title={pending.label}
          suggestion={{ dueAt: pending.dueAt, label: pending.label }}
          onDone={() => useUiStore.getState().dismissPendingReminder()}
        />
      </div>
    </div>
  )
}
