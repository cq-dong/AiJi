// 账号身份模型（纯 TS，零 I/O）。单一本地池：Account 是身份叠加层，非数据分区键。
// 见 docs/design/account-system-slice-a-plan.md §0/§1。
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
}
