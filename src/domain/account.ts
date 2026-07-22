// 账号身份模型（纯 TS，零 I/O）。单一本地池：Account 是身份叠加层，非数据分区键。
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
  // Slice B
  paidPlanId?: string // 'monthly' | 'yearly'，plan='paid' 时有值
  paidExpiresAt?: string // 付费到期 ISO
}

// Slice B：JWT 会话。localStorage 'aiji:auth' 持久化（src/app/session.ts）。
export interface AuthSession {
  jwt: string
  refreshToken: string
  expiresAt: string // jwt 过期时间 ISO
}
