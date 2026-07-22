import type { AuthSession } from '@/domain/account'

const KEY = 'aiji:auth'

export const localSession = {
  get(): AuthSession | null {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      return JSON.parse(raw) as AuthSession
    } catch {
      return null
    }
  },
  set(s: AuthSession): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
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
