import { create } from 'zustand'
import type { Quota } from '@/domain/quota'
import { di } from './di'
import { registerQuotaReset } from './accountStore'

type ConsumeType = 'llm' | 'stt' | 'agg'

interface QuotaState {
  quota: Quota | null
  hydrated: boolean
  exhausted: boolean
  hydrate: () => Promise<void>
  refresh: () => Promise<void>
  consume: (type: ConsumeType, amount: number) => void
  // 账号切换（login/register/bindNetwork/logout）时由 accountStore 触发：清旧账号内存态
  // 配额快照，避免新账号看到旧账号「今日 LLM 4 次」。reset 只清内存态，refresh 随后拉新账号
  // 配额；logout 时无 session → refresh 静默失败 → quota 保持 null → UI 显 skeleton（正确）。
  reset: () => void
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
  reset: () => {
    // 清内存态配额快照 + hydrated 守卫，使 refresh 必走网络拉新账号配额（不再被守卫跳过）。
    set({ quota: null, hydrated: false, exhausted: false })
  },
}))

// 账号切换时 accountStore 调本回调：reset 内存态 → refresh 拉新账号配额。
// 与 store.ts 模块尾 registerStoreRehydrate 同槽模式（accountStore 持可变槽，避免反向 import 成环）。
// logout 场景 refresh 会因无 session 静默失败（catch 内不 set）→ quota 保持 null → UI skeleton。
registerQuotaReset(async () => {
  useQuotaStore.getState().reset()
  await useQuotaStore.getState().refresh()
})
