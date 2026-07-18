import { useUiStore } from '@/app/store'
import { Button } from './Button'

// D20 · 到点触发的前台弹窗。原生 LocalNotifications listener / web webNotify handler
// → setReminderFireHandler → store.showFiringReminder → 本组件渲染 overlay。
// 与 ReminderPopup（保存后确认创建）区分：那是 ReminderCreator 容器，本组件是「已到点」
// 强提示，只展示 label + 完成 / 稍后 10 分钟 / 关闭 三按钮。
// 完成 = dismissReminder（删 Reminder 落库）；稍后 = snoozeReminder(10)（重 schedule）；
// 关闭 = 只关弹窗不删 Reminder（用户可选择手动处理）。
export function FiringReminderPopup() {
  const firing = useUiStore((s) => s.firingReminder)
  const dismiss = useUiStore.getState().dismissFiringReminder
  if (!firing) return null

  const handleComplete = () => {
    const id = firing.reminderId
    dismiss()
    if (id) void useUiStore.getState().dismissReminder(id)
  }
  const handleSnooze = () => {
    const id = firing.reminderId
    dismiss()
    if (id) void useUiStore.getState().snoozeReminder(id, 10)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="提醒触发"
      onClick={(e) => {
        // 点击遮罩（非内容区）关闭
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div className="m-4 w-full max-w-sm animate-slide-up rounded-card bg-card p-4 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-pri animate-pulse" />
          <p className="text-[12px] font-bold text-pri">提醒</p>
        </div>
        <p className="mt-2 text-[15px] font-medium leading-snug text-ink">{firing.label}</p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={handleComplete}>
            完成
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSnooze}>
            稍后 10 分钟
          </Button>
          <Button size="sm" variant="ghost" className="text-t3" onClick={dismiss}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  )
}
