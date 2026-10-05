import type { Reminder } from '@/domain/types'
import { playReminderBeep } from '@/adapters/reminderSound'
import { di } from './di'
import type { UiState } from '@/app/store'

// ── 提醒调度（Phase 9 Batch 2b · B5 · D4 重构）──────────────────────────
// D4：旧方案纯 setTimeout 前台 only——app 进后台/被杀后到点不触发（无铃声无弹窗）。
// 新方案：di.localNotifications.schedule(r) 预约系统级本地通知（原生：铃声+弹窗+
// 锁屏，后台/被杀仍触发；web：浏览器 Notification 前台 best-effort）。store 仍保留
// setTimeout 做前台状态更新（标 fired/missed）——两路并行，通知展示归 port，状态归 store。
// module-level timeout 句柄表，key=reminder.id，供 dismiss/snooze cancel。
// E2（2026-10-05 store 拆分一阶）：本簇自 store.ts 逐字迁入，函数体零改动；运行时对
// useUiStore 的依赖经 initReminderScheduler 晚绑定注入（句柄沿用 useUiStore 命名保逐字一致），
// UiState 走 import type（verbatimModuleSyntax 编译期抹除）→ 零运行时环。
const scheduledTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
// Q4：仅在首次 confirmReminder 时请求权限一次（permission !== 'default' 后不再弹）。
let permissionRequested = false

// 晚绑定注入面（契约 docs/acceptance/e2-eng-debt.md §范围②）。
type SchedulerStore = {
  getState: () => Pick<UiState, 'reminders' | 'trashed' | 'showFiringReminder'>
  setState: (fn: (s: Pick<UiState, 'reminders'>) => Pick<UiState, 'reminders'>) => void
}
// store.ts 在 create 完成后立即 initReminderScheduler 注入。definite-assignment：
// init 先于任何调度调用（模块级无调用，store hydrate 才首次触发）。
let useUiStore!: SchedulerStore

export function initReminderScheduler(store: SchedulerStore): void {
  useUiStore = store
}

export function clearScheduledTimeout(id: string): void {
  const h = scheduledTimeouts.get(id)
  if (h !== undefined) {
    clearTimeout(h)
    scheduledTimeouts.delete(id)
  }
  // D4: 同步取消系统级本地通知预约（原生 cancel pending notification；web 清 adapter timeout）
  void di.localNotifications.cancel(id)
}

// 到点 fire：置 fired + 落库 + 更新 state + 清 timeout 表。
// D39: 始终显式 notify 一次系统通知。原非 overdue 路径省略 notify（依赖 schedule 预约），
// 但 Android 前台 schedule 触发的系统横幅常被抑制 → 用户只看到 in-app 弹窗，通知栏无横幅。
// notify 用 hashId(r.id) 与 schedule 同 id → NotificationManager 替换，不产生重复通知。
export function fireReminder(r: Reminder, _opts?: { fromOverdue?: boolean }): void {
  clearScheduledTimeout(r.id)
  di.localNotifications.notify('AiJi 提醒', r.label, r.id)
  // 前台 setTimeout 到点：直接 in-app 弹窗 + beep 兜底（不依赖 listener）。后台时
  // setTimeout 不跑，靠原生 schedule 发系统通知 + listener；notify 亦补一发系统横幅。
  useUiStore.getState().showFiringReminder({ reminderId: r.id, entryId: r.entryId, label: r.label, dueAt: r.dueAt })
  playReminderBeep()
  const fired: Reminder = { ...r, status: 'fired' }
  void di.storage.saveReminder(fired).catch((e) => console.error('[store] saveReminder(fired) failed', e))
  useUiStore.setState((s) => ({ reminders: s.reminders.map((x) => (x.id === r.id ? fired : x)) }))
}

// Q3：>1h overdue pending → 标 missed 不打扰。
export function markMissed(r: Reminder): void {
  clearScheduledTimeout(r.id)
  const missed: Reminder = { ...r, status: 'missed' }
  void di.storage.saveReminder(missed).catch((e) => console.error('[store] saveReminder(missed) failed', e))
  useUiStore.setState((s) => ({ reminders: s.reminders.map((x) => (x.id === r.id ? missed : x)) }))
}

// 扫 reminders state：pending 的 → 未来预约系统通知 + setTimeout 状态更新；overdue <1h 补 fire；>1h 标 missed。
// 去重守卫：已在 timeout 表的 id 跳过（confirm/snooze 先 clearScheduledTimeout 再调本函数）。
export function scheduleReminders(): void {
  const { reminders, trashed } = useUiStore.getState()
  const trashedIds = new Set(trashed.map((e) => e.id))
  const now = Date.now()
  for (const r of reminders) {
    if (r.status !== 'pending' && r.status !== 'snoozed') continue
    if (scheduledTimeouts.has(r.id)) continue
    // P-F：entryId 可选（chat 建的提醒无源头条目）——无 entryId 不可能在回收站，正常调度。
    if (r.entryId && trashedIds.has(r.entryId)) continue // Wave 4: 条目在回收站 → 不调度其提醒（recover 后 scheduleReminders 重 arm）
    const due = new Date(r.dueAt).getTime()
    const diff = due - now
    if (diff <= 0) {
      // overdue（含到点 0ms）
      if (-diff < 3_600_000) fireReminder(r, { fromOverdue: true }) // <1h 补推（Q3）
      else markMissed(r) // ≥1h 标错过
    } else {
      // D4: 预约系统级本地通知（原生铃声+弹窗 / web 浏览器 Notification）——后台/被杀仍触发
      void di.localNotifications.schedule(r).catch((e) => console.error('[store] localNotifications.schedule failed', e))
      // 前台状态更新：setTimeout 到点标 fired；fire 前 re-check（可能已被 dismiss/snooze）
      const h = setTimeout(() => {
        const cur = useUiStore.getState().reminders.find((x) => x.id === r.id)
        if (cur && (cur.status === 'pending' || cur.status === 'snoozed')) fireReminder(cur)
        else scheduledTimeouts.delete(r.id)
      }, diff)
      scheduledTimeouts.set(r.id, h)
    }
  }
}

// Q4/D4：首次确认提醒时请求通知权限一次（情境相关，不无脑弹；denied 后不再骚扰）。
// 未授权仍落库 Reminder 但 warn（不阻塞）。自 store.ts confirmReminder / resolveChatAction
// 两处逐字节相同的内联块原样提取（permissionRequested 模块态随本簇迁入，store 侧不再可见）。
export async function requestReminderPermissionOnce(): Promise<void> {
  if (!permissionRequested) {
    permissionRequested = true
    const ok = await di.localNotifications.requestPermission()
    if (!ok) {
      console.warn('[store] notification permission not granted; reminder saved but alerts may be suppressed')
    }
  }
}
