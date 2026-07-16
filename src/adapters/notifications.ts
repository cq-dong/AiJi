// PWA Notification 适配（Phase 9 Batch 2b · B8）。
// 前台 only（Q1）：无 push server，app 开着时 setTimeout 到点 fire Notification；
// 关闭后不推。无权限/不支持 → 降级 in-app toast（CustomEvent，AppShell/B6 可后置监听）。
// 纯 PWA API 耦合——是适配层不是 domain port，故不入 ports/index.ts。

export const notifications = {
  /** Request Notification.permission. Returns true if granted. Idempotent-ish:
   *  granted → true；denied → false；default → 走 requestPermission 弹窗。 */
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

  /** Fire a notification (or toast fallback). tag = reminder id → 浏览器去重同 id。 */
  notify(label: string, body: string, tag: string): void {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(label, { body, tag })
        return
      }
    } catch {
      // fall through to toast
    }
    // 降级：in-app toast 事件（UI 层后置监听，本批不建 UI）。
    window.dispatchEvent(new CustomEvent('aiji:toast', { detail: { label, body, tag } }))
  },
}
