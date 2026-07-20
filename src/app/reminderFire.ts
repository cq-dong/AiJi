// D20 · 提醒到点「弹窗+声音」初始化。main.tsx 启动早期调一次。
// 三件事：
//   1. 首次用户交互 unlock AudioContext（Android WebView 需 gesture 才能播音频）。
//   2. 注册 fire handler——原生 LocalNotifications listener / web webNotify 均回调此 handler，
//      handler 内置 firingReminder state + 播 playReminderBeep。
//   3. 原生平台注册 LocalNotifications 'localNotificationReceived' 监听器。
//
// 与 store 的 setTimeout 状态更新（标 fired/missed）解耦：本模块只负责「用户感知」
// （弹窗+声音），store.fireReminder 只负责状态+落库，两路并行不互斥。

import { initNativeNotificationListener, setReminderFireHandler } from '@/adapters/localNotifications'
import { playReminderBeep, unlockAudio } from '@/adapters/reminderSound'
import { HeadsUpNotifier } from '@/adapters/headsUpNotifierPlugin'
import { Capacitor } from '@capacitor/core'
import { useUiStore } from './store'

export function initReminderFire(): void {
  // 1. audio unlock on first user gesture（once，只解一次）。
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', unlockAudio, { once: true })
    document.addEventListener('keydown', unlockAudio, { once: true })
  }

  // 2. fire handler：原生 listener / web webNotify 到达时调。
  //    查 reminders state 补 entryId/dueAt（web overdue 路径 payload 只带 reminderId）。
  setReminderFireHandler((p) => {
    const reminders = useUiStore.getState().reminders
    const r = p.reminderId ? reminders.find((x) => x.id === p.reminderId) : undefined
    const label = p.label || r?.label || '提醒'
    const reminderId = p.reminderId ?? r?.id ?? ''
    const entryId = p.entryId ?? r?.entryId
    const dueAt = r?.dueAt
    useUiStore.getState().showFiringReminder({ reminderId, entryId, label, dueAt })
    playReminderBeep()
  })

  // 3. 原生平台注册 listener（web no-op）。
  void initNativeNotificationListener()

  // D41: 原生平台预建 PRIORITY_HIGH channel（heads-up 横幅）。删后重建刷新 importance。
  if (Capacitor.isNativePlatform()) {
    void HeadsUpNotifier.ensureChannel().catch((e) => console.warn('[reminderFire] ensureChannel failed', e))
  }
}
