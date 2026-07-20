import { describe, it, expect } from 'vitest'
import { PLAN_TIERS } from '@/domain/plan'
describe('PLAN_TIERS', () => {
  it('has free/monthly/yearly', () => {
    expect(PLAN_TIERS.map((p) => p.id)).toEqual(['free', 'monthly', 'yearly'])
    expect(PLAN_TIERS[0].price).toBe(0)
    expect(PLAN_TIERS[2].limits.llmLimit).toBe(-1)
  })
})
