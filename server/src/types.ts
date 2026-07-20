// 服务端类型镜像 —— 与前端 src/domain/* 字段一致，但复制而非 import，
// 避免把前端 Dexie/react 依赖图拉进后端 bundle。纯 interface，零依赖。

export type AccountType = 'guest' | 'network'
export type AccountPlan = 'guest' | 'free' | 'paid'

export interface Account {
  id: string
  type: AccountType
  nickname: string
  email?: string
  plan: AccountPlan
  createdAt: string
  boundAt?: string
  avatar?: string
  paidPlanId?: string
  paidExpiresAt?: string
}

export interface AuthSession {
  jwt: string
  refreshToken: string
  expiresAt: string
}

export interface Quota {
  llmUsed: number
  llmLimit: number
  sttUsedSec: number
  sttLimitSec: number
  aggUsed: number
  aggLimit: number
  resetAt: string
}

export interface PlanTier {
  id: string
  name: string
  price: number
  period: 'once' | 'monthly' | 'yearly'
  limits: { llmLimit: number; sttLimitSec: number; aggLimit: number }
  features: string[]
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'free', name: '免费', price: 0, period: 'once',
    limits: { llmLimit: 20, sttLimitSec: 120, aggLimit: 5 },
    features: ['每日 20 次 LLM', '每日 120 秒 STT', '内置 Key'],
  },
  {
    id: 'monthly', name: '月度会员', price: 1800, period: 'monthly',
    limits: { llmLimit: 300, sttLimitSec: 1800, aggLimit: 50 },
    features: ['每日 300 次 LLM', '每日 30 分钟 STT', 'VLM 多模态（远期）'],
  },
  {
    id: 'yearly', name: '年度会员', price: 16800, period: 'yearly',
    limits: { llmLimit: -1, sttLimitSec: -1, aggLimit: -1 },
    features: ['LLM 无限', 'STT 无限', '所有付费功能'],
  },
]

// 按 account.plan + paidPlanId 解析今日额度。paid 且未过期 → 用付费档额度，否则 free。
export function resolveLimits(account: Account): { llmLimit: number; sttLimitSec: number; aggLimit: number } {
  if (account.plan === 'paid' && account.paidPlanId && account.paidExpiresAt) {
    if (new Date(account.paidExpiresAt).getTime() > Date.now()) {
      const tier = PLAN_TIERS.find((t) => t.id === account.paidPlanId)
      if (tier) return tier.limits
    }
  }
  return PLAN_TIERS[0].limits
}
