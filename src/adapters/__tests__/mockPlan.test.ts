import { describe, it, expect } from 'vitest'
import { mockPlan } from '@/adapters/mockPlan'

describe('mockPlan', () => {
  it('getPlans returns 3 tiers', async () => {
    const plans = await mockPlan.getPlans()
    expect(plans.map((p) => p.id)).toEqual(['free', 'monthly', 'yearly'])
  })

  it('upgrade monthly returns paidPlanId + future expiresAt + no payUrl', async () => {
    const r = await mockPlan.upgrade('monthly')
    expect(r.paidPlanId).toBe('monthly')
    expect(new Date(r.paidExpiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(r.payUrl).toBeUndefined()
    expect(r.orderId).toBeTruthy()
  })

  it('upgrade yearly returns 365d expiry', async () => {
    const r = await mockPlan.upgrade('yearly')
    const days = (new Date(r.paidExpiresAt).getTime() - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(364)
  })
})
