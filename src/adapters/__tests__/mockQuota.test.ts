import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockQuota, mockQuotaInternal } from '@/adapters/mockQuota'
beforeEach(() => localStorage.clear())
describe('mockQuota', () => {
  it('initial used=0', async () => {
    const q = await mockQuota.getQuota()
    expect(q.llmUsed).toBe(0)
  })
  it('bumpLlm increments llmUsed', async () => {
    mockQuotaInternal.bumpLlm(); mockQuotaInternal.bumpLlm()
    const q = await mockQuota.getQuota()
    expect(q.llmUsed).toBe(2)
  })
  it('bumpStt increments by 5 default', async () => {
    mockQuotaInternal.bumpStt()
    expect((await mockQuota.getQuota()).sttUsedSec).toBe(5)
  })
  it('bumpAgg increments aggUsed', async () => {
    mockQuotaInternal.bumpAgg()
    expect((await mockQuota.getQuota()).aggUsed).toBe(1)
  })
  it('exhausted env returns used=limit', async () => {
    vi.stubEnv('VITE_AIJI_MOCK_QUOTA_EXHAUSTED', '1')
    const q = await mockQuota.getQuota()
    expect(q.llmUsed).toBe(q.llmLimit)
    vi.unstubAllEnvs()
  })
  it('resetAt is in future', async () => {
    const q = await mockQuota.getQuota()
    expect(new Date(q.resetAt).getTime()).toBeGreaterThan(Date.now() - 1000)
  })
})
