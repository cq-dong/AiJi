// HTTP PlanPort 适配器：GET /api/plans + POST /api/plan/upgrade。
import type { PlanPort } from '@/ports'
import { NotNetworkError } from '@/ports'
import type { PlanTier } from '@/domain/plan'
import { localSession } from '@/app/session'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

export const httpPlan: PlanPort = {
  async getPlans() {
    let res: Response
    try {
      res = await fetch(`${BASE}/api/plan`)
    } catch {
      throw new NotNetworkError('网络不可用')
    }
    if (!res.ok) throw new Error(`plans HTTP ${res.status}`)
    return (await res.json()) as PlanTier[]
  },

  async upgrade(planId) {
    const session = localSession.get()
    let res: Response
    try {
      res = await fetch(`${BASE}/api/plan/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.jwt ?? ''}` },
        body: JSON.stringify({ planId }),
      })
    } catch {
      throw new NotNetworkError('网络不可用')
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`upgrade HTTP ${res.status}: ${t.slice(0, 120)}`)
    }
    return (await res.json()) as {
      orderId: string
      paidPlanId: string
      paidExpiresAt: string
      payUrl?: string
    }
  },
}
