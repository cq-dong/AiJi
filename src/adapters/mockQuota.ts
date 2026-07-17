// src/adapters/mockQuota.ts
import type { QuotaPort } from '@/ports'
import type { Quota } from '@/domain/quota'

const KEY = 'aiji:mock:quota'
const FREE_LIMITS = { llmLimit: 20, sttLimitSec: 120, aggLimit: 5 }
const exhausted = () => import.meta.env.VITE_AIJI_MOCK_QUOTA_EXHAUSTED === '1'

function nextResetAt(): string {
  const d = new Date()
  d.setHours(8, 0, 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return d.toISOString()
}
function today(): string {
  return new Date().toISOString().slice(0, 10)
}
interface Counts { llmUsed: number; sttUsedSec: number; aggUsed: number; date: string }
function read(): Counts {
  const t = today()
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Counts | null
    if (c && c.date === t) return c
  } catch { /* fallthrough */ }
  return { llmUsed: 0, sttUsedSec: 0, aggUsed: 0, date: t }
}
function write(c: Counts): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* 静默 */ }
}

export const mockQuotaInternal = {
  bumpLlm(n = 1): void { const c = read(); c.llmUsed += n; write(c) },
  bumpStt(sec = 5): void { const c = read(); c.sttUsedSec += sec; write(c) },
  bumpAgg(n = 1): void { const c = read(); c.aggUsed += n; write(c) },
}

export const mockQuota: QuotaPort = {
  async getQuota(): Promise<Quota> {
    if (exhausted()) {
      return { ...FREE_LIMITS, llmUsed: FREE_LIMITS.llmLimit, sttUsedSec: FREE_LIMITS.sttLimitSec, aggUsed: FREE_LIMITS.aggLimit, resetAt: nextResetAt() }
    }
    const c = read()
    return { ...FREE_LIMITS, llmUsed: c.llmUsed, sttUsedSec: c.sttUsedSec, aggUsed: c.aggUsed, resetAt: nextResetAt() }
  },
}
