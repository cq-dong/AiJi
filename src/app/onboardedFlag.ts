// 设备级「已看过 onboarding 引导」标志。
//
// 为什么需要它：settings.onboarded 是 per-owner（随账号隔离，存 Dexie）。但「看过 App 功能
// 引导」是设备级概念——一个设备看过一次即可，不该因切换/新建账号（游客注册 registerGuest
// 切新 owner + rehydrate 重载空 settings.onboarded=false）而重复弹 onboarding。
//
// 用法：OnboardingGate 与 login 的跳转判定，取 settings.onboarded || deviceOnboarded.get()。
// onStart（引导完成）时 deviceOnboarded.set() + setSettings({onboarded:true}) 双写。
// settings.onboarded 保留作 per-owner 兼容；deviceOnboarded 是兜底 superset。
const KEY = 'aiji:onboarded'

export const deviceOnboarded = {
  get(): boolean {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  },
  set(): void {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // 隐私模式/配额写失败——本次会话仍生效（内存 settings），仅不持久化设备级
    }
  },
}
