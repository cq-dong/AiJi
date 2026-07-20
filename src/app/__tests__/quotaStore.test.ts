import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Quota } from '@/domain/quota'

// Mock di.quota.getQuota — 默认返回正常配额（未耗尽、resetAt 未来）。
const mocks = vi.hoisted(() => ({
  getQuota: vi.fn<() => Promise<Quota>>(),
}))

vi.mock('@/app/di', () => ({
  di: {
    quota: {
      getQuota: () => mocks.getQuota(),
    },
  },
}))

import { useQuotaStore } from '@/app/quotaStore'

const futureIso = new Date(Date.now() + 86_400_000).toISOString()

const normalQuota: Quota = {
  llmUsed: 5,
  llmLimit: 20,
  sttUsedSec: 30,
  sttLimitSec: 120,
  aggUsed: 2,
  aggLimit: 5,
  resetAt: futureIso,
}

beforeEach(() => {
  mocks.getQuota.mockReset()
  // 重置 store 状态（zustand 没有 reset API，直接 set 初始值）
  useQuotaStore.setState({ quota: null, hydrated: false, exhausted: false })
})

describe('quotaStore', () => {
  it('hydrate() 后 quota 非 null 且 hydrated=true', async () => {
    mocks.getQuota.mockResolvedValue(normalQuota)
    await useQuotaStore.getState().hydrate()
    const s = useQuotaStore.getState()
    expect(s.quota).not.toBeNull()
    expect(s.hydrated).toBe(true)
  })

  it("consume('llm', 1) 乐观地 llmUsed +1", async () => {
    mocks.getQuota.mockResolvedValue(normalQuota)
    await useQuotaStore.getState().hydrate()
    expect(useQuotaStore.getState().quota!.llmUsed).toBe(5)
    useQuotaStore.getState().consume('llm', 1)
    expect(useQuotaStore.getState().quota!.llmUsed).toBe(6)
  })

  it('refresh() 当 resetAt 已过去时 used 全部归 0', async () => {
    const pastQuota: Quota = {
      llmUsed: 8,
      llmLimit: 20,
      sttUsedSec: 60,
      sttLimitSec: 120,
      aggUsed: 3,
      aggLimit: 5,
      resetAt: new Date(Date.now() - 86_400_000).toISOString(), // 过去
    }
    mocks.getQuota.mockResolvedValue(pastQuota)
    await useQuotaStore.getState().refresh()
    const q = useQuotaStore.getState().quota!
    expect(q.llmUsed).toBe(0)
    expect(q.sttUsedSec).toBe(0)
    expect(q.aggUsed).toBe(0)
  })

  it('used>=limit 时 exhausted=true', async () => {
    const exhaustedQuota: Quota = {
      llmUsed: 20,
      llmLimit: 20,
      sttUsedSec: 30,
      sttLimitSec: 120,
      aggUsed: 2,
      aggLimit: 5,
      resetAt: futureIso,
    }
    mocks.getQuota.mockResolvedValue(exhaustedQuota)
    await useQuotaStore.getState().refresh()
    expect(useQuotaStore.getState().exhausted).toBe(true)
  })

  it('limit=-1 (unlimited) 永不 exhausted', async () => {
    const unlimitedQuota: Quota = {
      llmUsed: 9999,
      llmLimit: -1,
      sttUsedSec: 9999,
      sttLimitSec: -1,
      aggUsed: 2,
      aggLimit: 5,
      resetAt: futureIso,
    }
    mocks.getQuota.mockResolvedValue(unlimitedQuota)
    await useQuotaStore.getState().refresh()
    expect(useQuotaStore.getState().exhausted).toBe(false)
  })

  it('hydrate() 幂等：第二次调用不再请求', async () => {
    mocks.getQuota.mockResolvedValue(normalQuota)
    await useQuotaStore.getState().hydrate()
    await useQuotaStore.getState().hydrate()
    expect(mocks.getQuota).toHaveBeenCalledTimes(1)
  })
})
