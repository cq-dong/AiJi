import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { PLAN_TIERS } from '../types.js'

const plan = new Hono<AppEnv>()

// GET /api/plans — 返 3 档套餐（与前端 PLAN_TIERS 一致）。
plan.get('/', (c) => c.json(PLAN_TIERS))

// POST /api/plan/upgrade — 本期 stub，不接支付。返订单号 + 套餐 + 到期 + payUrl=undefined。
plan.post('/upgrade', async (c) => {
  const body = await c.req.json().catch(() => null) as { planId?: string } | null
  const planId = body?.planId
  if (!planId || !PLAN_TIERS.some((t) => t.id === planId)) {
    return c.json({ error: 'AUTH_400', message: '无效的套餐' }, 400 as any)
  }
  const days = planId === 'yearly' ? 365 : 30
  const paidExpiresAt = new Date(Date.now() + days * 86400_000).toISOString()
  return c.json({
    orderId: 'order_' + crypto.randomUUID(),
    paidPlanId: planId,
    paidExpiresAt,
    payUrl: undefined,
  })
})

export default plan
