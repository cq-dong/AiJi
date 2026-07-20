import { registerPlugin } from '@capacitor/core'

// D41: 自定义 HeadsUpNotifier 插件 TS 绑定。原生侧（HeadsUpNotifierPlugin.java）
// 用 NotificationCompat.PRIORITY_HIGH + channel IMPORTANCE_HIGH 发通知 → heads-up 横幅。
//
// 为什么不用 @capacitor/local-notifications：
//   其 buildNotification 写死 setPriority(PRIORITY_DEFAULT)（源码在 node_modules 不可改），
//   OEM ROM 常因此不弹 heads-up 横幅，只响铃。本插件前后台到点均发 PRIORITY_HIGH。
//
// web impl：PWA 无系统通知栏，调到直接 resolve（web 走 webImpl 的浏览器 Notification）。
export interface HeadsUpNotifierPlugin {
  ensureChannel(): Promise<void>
  notifyNow(opts: { title: string; body: string; id: number }): Promise<void>
  schedule(opts: { title: string; body: string; id: number; at: number }): Promise<void>
  cancel(opts: { id: number }): Promise<void>
}

export const HeadsUpNotifier = registerPlugin<HeadsUpNotifierPlugin>('HeadsUpNotifier', {
  web: {
    async ensureChannel() {},
    async notifyNow() {},
    async schedule() {},
    async cancel() {},
  },
})
