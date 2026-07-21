import { useUiStore } from '@/app/store'
import { ReminderCreator } from './ReminderCreator'

// 保存后即时弹窗：processEntry(isFresh=true) 检出 reminderSuggestion → store.pendingReminder →
// AppShell(MainLayout) 渲本组件。modal 承载 ReminderCreator（与 detail 内联同组件同语义）。
// onDone=dismissPendingReminder 关 modal。detail 的 reprocess 走 isFresh=false 不弹。
//
// D4: 弹窗 UI 配合通知触发——用户在弹窗内确认后，store.confirmReminder 会调
// di.localNotifications.schedule() 预约系统级通知（原生铃声+弹窗 / web 浏览器 Notification）。
// 到点由系统触发，不再依赖前台 setTimeout。弹窗本身加 slide-up 动画 + 点击遮罩关闭。

export function ReminderPopup() {
  const pending = useUiStore((s) => s.pendingReminder)
  const dismiss = useUiStore.getState().dismissPendingReminder
  if (!pending) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] animate-fade-in sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="提醒确认"
      onClick={(e) => {
        // 点击遮罩（非内容区）关闭
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div className="m-4 w-full max-w-sm animate-slide-up">
        <ReminderCreator
          entryId={pending.entryId}
          title={pending.label}
          suggestion={{ dueAt: pending.dueAt, label: pending.label }}
          onDone={dismiss}
        />
      </div>
    </div>
  )
}
