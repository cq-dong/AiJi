// HTTP PlanPort 适配器：GET /api/plans + POST /api/plan/upgrade。
import type { PlanPort } from '@/ports'
import { NotNetworkError } from '@/ports'
import type { PlanTier } from '@/domain/plan'
import type { Account } from '@/domain/account'
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
      // 后端 {error, message} 的 message 已是面向用户的中文且为本端点定制（AUTH_409 在 upgrade
      // 语义与 i18n error.AUTH_409=该邮箱已注册 冲突）→ 直透 message，不走 AUTH_ code 映射；
      // localizeError 查不到 key 会回落原 msg。
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      throw new Error(body?.message ?? `upgrade HTTP ${res.status}`)
    }
    return (await res.json()) as {
      orderId: string
      paidPlanId: string
      paidExpiresAt: string
      payUrl?: string
      account?: Account
    }
  },

  async redeem(code) {
    const session = localSession.get()
    let res: Response
    try {
      res = await fetch(`${BASE}/api/plan/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.jwt ?? ''}` },
        body: JSON.stringify({ code }),
      })
    } catch {
      throw new NotNetworkError('网络不可用')
    }
    if (!res.ok) {
      // 后端 {error, message} 的 message 已是面向用户的中文且为本端点定制（AUTH_409 在 redeem
      // 语义=兑换码已用尽，与 i18n error.AUTH_409=该邮箱已注册 冲突）→ 直透 message，
      // 不走 AUTH_ code 映射；localizeError 查不到 key 会回落原 msg。
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      throw new Error(body?.message ?? `redeem HTTP ${res.status}`)
    }
    return (await res.json()) as { account: Account }
  },
}
