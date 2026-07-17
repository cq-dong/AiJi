import type { Account } from '@/domain/account'

// 账号身份 localStorage 读写（非 Port，plain module）。镜像 localStorageSecrets 的 try/catch 静默降级。
// 单条记录，key='aiji:account'。隐私模式 / QuotaExceeded → 静默降级，不阻断 UI。
const KEY = 'aiji:account'

export const localAccount = {
  get(): Account | null {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      return JSON.parse(raw) as Account
    } catch {
      return null
    }
  },
  set(a: Account): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(a))
    } catch {
      // QuotaExceeded / 隐私模式 → 静默降级
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // 同上
    }
  },
}
