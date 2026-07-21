export interface PlanTier {
  id: string // 'free' | 'monthly' | 'yearly'
  name: string
  price: number // 分；free=0
  period: 'once' | 'monthly' | 'yearly'
  limits: { llmLimit: number; sttLimitSec: number; aggLimit: number } // -1=无限
  features: string[]
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'free', name: '免费', price: 0, period: 'once',
    limits: { llmLimit: 20, sttLimitSec: 120, aggLimit: 5 },
    features: ['每日 20 次 LLM', '每日 120 秒 STT', '内置 Key', '图片理解'],
  },
  {
    id: 'monthly', name: '月度会员', price: 1800, period: 'monthly',
    limits: { llmLimit: 300, sttLimitSec: 1800, aggLimit: 50 },
    features: ['每日 300 次 LLM', '每日 30 分钟 STT', '图片/视频理解'],
  },
  {
    id: 'yearly', name: '年度会员', price: 16800, period: 'yearly',
    limits: { llmLimit: -1, sttLimitSec: -1, aggLimit: -1 },
    features: ['LLM 无限', 'STT 无限', '所有付费功能'],
  },
]
