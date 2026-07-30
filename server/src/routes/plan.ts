import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { getDb, type UserRow } from '../db/index.js'
import { PLAN_TIERS, type Account } from '../types.js'
import { errorJson } from '../lib/http.js'

const plan = new Hono<AppEnv>()

function rowToAccount(row: UserRow): Account {
  return {
    id: row.id,
    type: 'network',
    nickname: row.nickname,
    email: row.email,
    plan: row.plan as Account['plan'],
    createdAt: row.created_at,
    boundAt: row.bound_at ?? undefined,
    avatar: row.avatar ?? undefined,
    paidPlanId: row.paid_plan_id ?? undefined,
    paidExpiresAt: row.paid_expires_at ?? undefined,
    trialEndsAt: row.trial_expires_at ?? undefined,
  }
}

// 把 planId 档的付费状态写入 users（redeem 与 upgrade 共用），返更新后 account。
function applyPaid(userId: string, planId: string): Account | null {
  if (planId !== 'monthly' && planId !== 'yearly') return null
  const durationDays = planId === 'yearly' ? 365 : 30
  const paidExpiresAt = new Date(Date.now() + durationDays * 86400_000).toISOString()
  const db = getDb()
  db.prepare(`UPDATE users SET plan='paid', paid_plan_id=?, paid_expires_at=? WHERE id=?`).run(planId, paidExpiresAt, userId)
  const row = db.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as UserRow | undefined
  return row ? rowToAccount(row) : null
}

// GET /api/plans — 返 3 档套餐（公开，前端未登录可拉）。
plan.get('/', (c) => c.json(PLAN_TIERS))

// POST /api/plan/redeem {code} — 兑换码激活付费档（真落库，事务）。
plan.post('/redeem', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as { code?: string } | null
  const code = body?.code?.trim().toUpperCase()
  if (!code) return errorJson(c, 400, 'AUTH_400', '请输入兑换码')
  const db = getDb()
  const now = new Date().toISOString()
  const outcome = db.transaction(() => {
    const rc = db.prepare(`SELECT * FROM redeem_codes WHERE code = ?`).get(code) as
      | { plan_id: string; used_count: number; max_uses: number; expires_at: string | null }
      | undefined
    if (!rc) return { status: 404 as const, code: 'AUTH_404', message: '兑换码无效或已过期' }
    if (rc.expires_at && rc.expires_at <= now) return { status: 404 as const, code: 'AUTH_404', message: '兑换码无效或已过期' }
    if (rc.used_count >= rc.max_uses) return { status: 409 as const, code: 'AUTH_409', message: '兑换码已用尽' }
    const account = applyPaid(userId, rc.plan_id)
    if (!account) return { status: 400 as const, code: 'AUTH_400', message: '兑换码套餐无效' }
    db.prepare(`UPDATE redeem_codes SET used_count = used_count + 1 WHERE code = ?`).run(code)
    db.prepare(`INSERT INTO redeem_logs (id, code, user_id, redeemed_at) VALUES (?, ?, ?, ?)`)
      .run(crypto.randomUUID(), code, userId, now)
    return { account }
  })()
  if ('account' in outcome) return c.json({ account: outcome.account })
  return errorJson(c, outcome.status, outcome.code, outcome.message)
})

// POST /api/plan/upgrade — 保留路径（兼容前端 upgradePlan），改真落库（不再 stub 不写库），并返 account。
plan.post('/upgrade', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as { planId?: string } | null
  const planId = body?.planId
  if (!planId || !PLAN_TIERS.some((t) => t.id === planId && t.id !== 'free')) {
    return errorJson(c, 400, 'AUTH_400', '无效的套餐')
  }
  const account = applyPaid(userId, planId)
  if (!account) return errorJson(c, 400, 'AUTH_400', '无效的套餐')
  return c.json({
    orderId: 'order_' + crypto.randomUUID(),
    paidPlanId: planId,
    paidExpiresAt: account.paidExpiresAt,
    payUrl: undefined,
    account,
  })
})

export default plan
