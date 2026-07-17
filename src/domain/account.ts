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
  // 头像 data URL（base64 JPEG）。供个人中心展示 + AI 内置模型读取（Slice B）；
  // data URL 形式存 localStorage（随 Account 一起持久化），避免额外存储依赖。
  avatar?: string
}
