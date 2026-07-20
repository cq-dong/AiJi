// D4 · LocalNotificationsPort 适配器。
// 平台分流：原生（Android/iOS）走 @capacitor/local-notifications → 系统级本地通知
// （铃声 + 弹窗 + 锁屏，app 后台/被杀仍触发）；PWA web 走浏览器 Notification API
// （前台 setTimeout → new Notification，后台不可靠，仅 best-effort）。
//
// 替代旧 setTimeout-only 调度：旧方案 app 进后台/被杀即失效（D4 根因）。
// store 仍保留 setTimeout 做前台状态更新（标 fired/missed），本适配只负责
// 「通知展示」—— schedule 预约未来通知，cancel 取消，notify 即时推（overdue 补推）。
//
// 原生通知 id 是 32-bit int（Android 限制），Reminder.id 是 UUID 字符串 →
// hashId 映射。冲突概率极低（2^31 空间，用户级提醒量 << 冲突阈值）。

import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'
import type { LocalNotificationsPort } from '@/ports'
import type { Reminder } from '@/domain/types'

// D20 · 前台到点弹窗+声音：原生 LocalNotifications 在 app 前台时常抑制系统横幅
// （Android 不弹横幅、不发声），用户看不到也听不到。此处注册「通知到达」handler，
// 由上层（src/app/reminderFire.ts）注入：收到时触发 in-app 弹窗 + 提示音。
// web 路径在 webNotify 内同步调 handler（web 无 LocalNotifications 事件，setTimeout
// 即「到点」）。handler 在 setReminderFireHandler 调用前为 null（适配器零依赖 store）。
export interface ReminderFirePayload {
  reminderId?: string
  entryId?: string
  label: string
  body: string
}

let fireHandler: ((p: ReminderFirePayload) => void) | null = null

export function setReminderFireHandler(h: ((p: ReminderFirePayload) => void) | null): void {
  fireHandler = h
}

// 原生注册 LocalNotifications 'localNotificationReceived' 监听器。
// app 启动早期调一次（main.tsx → initReminderFire）。
// 非原生平台 no-op（web 路径走 webNotify 内的 handler 触发）。
export async function initNativeNotificationListener(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await LocalNotifications.addListener(
      'localNotificationReceived',
      (notification) => {
        const extra = (notification.extra ?? {}) as Record<string, unknown>
        const reminderId = typeof extra.reminderId === 'string' ? extra.reminderId : undefined
        const entryId = typeof extra.entryId === 'string' ? extra.entryId : undefined
        const label = notification.title ?? 'AiJi 提醒'
        const body = notification.body ?? ''
        try {
          fireHandler?.({ reminderId, entryId, label, body })
        } catch (e) {
          console.error('[localNotifications] fireHandler failed', e)
        }
      },
    )
  } catch (e) {
    console.error('[localNotifications] addListener(localNotificationReceived) failed', e)
  }
}

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0
  }
  return Math.abs(h) || 1 // 0 保留（部分平台拒 id=0），fallback 1
}

// ── Web fallback（PWA 浏览器）──────────────────────────────────────────
// 前台 only：setTimeout 到点 fire Notification。app 关闭后不推（web 无后台通知）。
// 降级：无 Notification API / 权限 denied → CustomEvent toast（AppShell 监听）。
// D20: 同步调 fireHandler 触发 in-app 弹窗+声音（与原生 listener 对齐）。
const webTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

function webNotify(label: string, body: string, tag: string): void {
  // D20: 先触发 in-app handler（弹窗+声音），不依赖 Notification API 是否可用。
  try {
    fireHandler?.({ reminderId: tag, label, body })
  } catch (e) {
    console.error('[localNotifications] web fireHandler failed', e)
  }
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(label, { body, tag })
      return
    }
  } catch {
    // fall through to toast
  }
  window.dispatchEvent(new CustomEvent('aiji:toast', { detail: { label, body, tag } }))
}

const webImpl: LocalNotificationsPort = {
  async requestPermission(): Promise<boolean> {
    try {
      if (!('Notification' in window)) return false
      if (Notification.permission === 'granted') return true
      if (Notification.permission === 'denied') return false
      const perm = await Notification.requestPermission()
      return perm === 'granted'
    } catch {
      return false
    }
  },
  async schedule(reminder: Reminder): Promise<void> {
    const due = new Date(reminder.dueAt).getTime()
    const diff = due - Date.now()
    if (diff <= 0) return // overdue；store 的 scheduleReminders 走 fireReminder/notify 补推
    // reschedule：同 id 先清旧 timeout
    const existing = webTimeouts.get(reminder.id)
    if (existing !== undefined) clearTimeout(existing)
    const h = setTimeout(() => {
      webTimeouts.delete(reminder.id)
      webNotify('AiJi 提醒', reminder.label, reminder.id)
    }, diff)
    webTimeouts.set(reminder.id, h)
  },
  async cancel(id: string): Promise<void> {
    const h = webTimeouts.get(id)
    if (h !== undefined) {
      clearTimeout(h)
      webTimeouts.delete(id)
    }
  },
  notify(label: string, body: string, tag: string): void {
    webNotify(label, body, tag)
  },
}

// ── Native（Capacitor Android/iOS）─────────────────────────────────────
// LocalNotifications.schedule 预约系统级通知：到点原生 NotificationManager 发通知
// （铃声 + 弹窗 + 锁屏横幅），app 在后台/被杀/锁屏均触发。allowWhileIdle 穿 Doze。
// cancel 取消未触发的预约。notify 即时发（overdue 补推 / 前台即时确认）。
let nativeChannelReady = false
async function ensureChannel(): Promise<void> {
  if (nativeChannelReady) return
  if (Capacitor.getPlatform() !== 'android') {
    nativeChannelReady = true
    return
  }
  try {
    // Android 8+ 需 notification channel 才能发声。默认 channel 可能无声/不存在，
    // 自建 'reminders' channel 设 IMPORTANCE_HIGH（系统默认铃声 + 横幅）。
    // D4 修复：去掉 sound: 'beep.wav'——res/raw 无此资源会导致 channel 创建异常/无声。
    // IMPORTANCE_HIGH 保证系统用默认通知声，去掉 sound 不影响发声。
    await LocalNotifications.createChannel({
      id: 'reminders',
      name: '提醒',
      description: 'AiJi 待办提醒通知',
      importance: 5, // IMPORTANCE_HIGH
      visibility: 1, // PUBLIC
      vibration: true,
    })
  } catch (e) {
    console.error('[localNotifications] createChannel failed', e)
  }
  nativeChannelReady = true
}

// D4 修复：schedule/notify 前确保 POST_NOTIFICATIONS 已授权（Android 13+ 运行时权限）。
// checkPermissions 先查当前状态；仅 'prompt'（从未问过）才 requestPermissions 弹原生框。
// 'granted' 直接通过；'denied' 跳过（避免静默 schedule 后被系统拦截）。
async function ensurePermission(): Promise<boolean> {
  try {
    const check = await LocalNotifications.checkPermissions()
    if (check.display === 'granted') return true
    if (check.display === 'denied') return false
    // 'prompt' → 请求（原生弹框）
    const res = await LocalNotifications.requestPermissions()
    return res.display === 'granted'
  } catch (e) {
    console.error('[localNotifications] ensurePermission failed', e)
    return false
  }
}

const nativeImpl: LocalNotificationsPort = {
  async requestPermission(): Promise<boolean> {
    try {
      const res = await LocalNotifications.requestPermissions()
      return res.display === 'granted'
    } catch (e) {
      console.error('[localNotifications] requestPermissions failed', e)
      return false
    }
  },
  async schedule(reminder: Reminder): Promise<void> {
    // D35: 不再因 ensurePermission 返 false 静默跳过 schedule——checkPermissions 在部分
    // Android 上返 'prompt'（即使用户已授），导致 schedule 被吃掉、到点不响。改为：
    // 先 ensureChannel，再尽力 schedule；权限确实 denied 时系统会拒，但至少不会被
    // 我们的 check 误杀。ensurePermission 只用于 requestPermission 主动请求场景。
    await ensureChannel()
    const ok = await ensurePermission()
    if (!ok) {
      console.warn('[localNotifications] permission not granted, schedule may be suppressed by system')
    }
    const id = hashId(reminder.id)
    const due = new Date(reminder.dueAt)
    // reschedule：同 id 先 cancel 旧预约（否则 schedule 重复 id 行为未定义）
    try {
      await LocalNotifications.cancel({ notifications: [{ id }] })
    } catch {
      // ignore（首次无旧预约）
    }
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: 'AiJi 提醒',
            body: reminder.label,
            schedule: { at: due, allowWhileIdle: true },
            channelId: 'reminders',
            extra: { reminderId: reminder.id, entryId: reminder.entryId },
          },
        ],
      })
    } catch (e) {
      console.error('[localNotifications] schedule failed', e)
    }
  },
  async cancel(id: string): Promise<void> {
    try {
      await LocalNotifications.cancel({ notifications: [{ id: hashId(id) }] })
    } catch (e) {
      console.error('[localNotifications] cancel failed', e)
    }
  },
  notify(label: string, body: string, tag: string): void {
    // 即时通知（overdue 补推 / 前台即时）。用 tag 末段作 id hash 源，保证去重。
    void (async () => {
      // D4 修复：权限未授权则不 notify（避免静默失败）。
      const ok = await ensurePermission()
      if (!ok) return
      await ensureChannel()
      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: hashId(tag),
              title: label,
              body,
              schedule: { at: new Date(), allowWhileIdle: true },
              channelId: 'reminders',
              extra: { tag },
            },
          ],
        })
      } catch (e) {
        console.error('[localNotifications] notify failed', e)
      }
    })()
  },
}

export const localNotifications: LocalNotificationsPort = Capacitor.isNativePlatform()
  ? nativeImpl
  : webImpl
