import { create } from 'zustand'
import type { Quota } from '@/domain/quota'
import { di } from './di'

type ConsumeType = 'llm' | 'stt' | 'agg'

interface QuotaState {
  quota: Quota | null
  hydrated: boolean
  exhausted: boolean
  hydrate: () => Promise<void>
  refresh: () => Promise<void>
  consume: (type: ConsumeType, amount: number) => void
}

function isExhausted(q: Quota): boolean {
  return (
    (q.llmLimit >= 0 && q.llmUsed >= q.llmLimit) ||
    (q.sttLimitSec >= 0 && q.sttUsedSec >= q.sttLimitSec)
  )
}

export const useQuotaStore = create<QuotaState>((set, get) => ({
  quota: null,
  hydrated: false,
  exhausted: false,
  hydrate: async () => {
    if (get().hydrated) return
    await get().refresh()
    set({ hydrated: true })
  },
  refresh: async () => {
    try {
      const q = await di.quota.getQuota()
      const resetPassed = new Date(q.resetAt).getTime() < Date.now()
      const fixed: Quota = resetPassed
        ? { ...q, llmUsed: 0, sttUsedSec: 0, aggUsed: 0 }
        : q
      set({ quota: fixed, exhausted: isExhausted(fixed) })
    } catch {
      // 静默：UI 显 skeleton（quota=null）
    }
  },
  consume: (type, amount) => {
    const cur = get().quota
    if (!cur) return
    const next: Quota =
      type === 'llm'
        ? { ...cur, llmUsed: cur.llmUsed + amount }
        : type === 'stt'
          ? { ...cur, sttUsedSec: cur.sttUsedSec + amount }
          : { ...cur, aggUsed: cur.aggUsed + amount }
    set({ quota: next, exhausted: isExhausted(next) })
  },
}))
