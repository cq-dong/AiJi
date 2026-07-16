import type { SecretStorePort } from '@/ports'

// PWA SecretStorePort 适配：API key 存 localStorage（BYOK 本地优先）。
// 安全权衡：localStorage XSS 可读，但单用户本地 PWA 风险可接受；TODO 升级 crypto.subtle 加密 IDB。
// key 永不入源码/commit——只由用户在 BYOK 设置 UI 填入。
export const localStorageSecrets: SecretStorePort = {
  async get(key) {
    try {
      return localStorage.getItem(key) ?? undefined
    } catch {
      // 隐私模式 / storage 禁用 → 视作无 key（AI 层降级，采集存储不受影响）
      return undefined
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // 与 get 对称：QuotaExceeded / 隐私模式 → 静默降级（AI 层无 key，采集存储不伤）
    }
  },
  async delete(key) {
    try {
      localStorage.removeItem(key)
    } catch {
      // 同上
    }
  },
}
