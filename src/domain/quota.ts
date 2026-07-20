export interface Quota {
  llmUsed: number
  llmLimit: number
  sttUsedSec: number
  sttLimitSec: number
  aggUsed: number
  aggLimit: number
  resetAt: string // ISO，下次重置时间
}
