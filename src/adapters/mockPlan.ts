// Slice B · PlanPort mock adapter.
// getPlans 直接返回 domain 的 PLAN_TIERS（3 档）；upgrade 是支付 stub——
// 只回 {orderId, paidPlanId, paidExpiresAt, payUrl: undefined}，不 mutate account。
// 真正修改账号 paidPlanId/paidExpiresAt 由 accountStore.upgradePlan（后续 task）负责，
// PlanPort 层对 accountStore 无感知（单向 port→app 依赖）。
import type { PlanPort } from '@/ports'
import { PLAN_TIERS } from '@/domain/plan'

export const mockPlan: PlanPort = {
  async getPlans() {
    return PLAN_TIERS
  },
  async upgrade(planId) {
    const days = planId === 'yearly' ? 365 : 30
    const paidExpiresAt = new Date(Date.now() + days * 86400_000).toISOString()
    return {
      orderId: 'order_' + crypto.randomUUID(),
      paidPlanId: planId,
      paidExpiresAt,
      payUrl: undefined,
    }
  },
}
