import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { getDb, type UserRow } from '../db/index.js'
import { hashPassword, verifyPassword, validateEmail, validatePassword } from '../lib/password.js'
import { signAccessToken } from '../lib/jwt.js'
import { issueRefreshToken, consumeRefreshToken, revokeAllUserTokens } from '../lib/refresh.js'
import { errorJson } from '../lib/http.js'
import { rateLimit } from '../lib/rateLimit.js'
import type { Account, AuthSession } from '../types.js'

const auth = new Hono<AppEnv>()

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

async function buildSession(userId: string): Promise<AuthSession> {
  const { jwt, expiresAt } = await signAccessToken(userId)
  const refreshToken = issueRefreshToken(userId)
  return { jwt, refreshToken, expiresAt }
}

// 注册：邮箱密码。30s/IP 限频防爆破。
auth.post('/register', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown'
  if (!rateLimit(`register:${ip}`, 5, 30_000)) {
    return errorJson(c, 429, 'AUTH_429', '操作过于频繁，请稍后再试')
  }
  const body = await c.req.json().catch(() => null) as { email?: string; password?: string } | null
  if (!body?.email || !body?.password) return errorJson(c, 400, 'AUTH_400', '邮箱和密码必填')
  const email = body.email.toLowerCase().trim()
  const password = body.password
  if (!validateEmail(email)) return errorJson(c, 400, 'AUTH_400', '邮箱格式无效')
  if (!validatePassword(password)) return errorJson(c, 400, 'AUTH_400', '密码至少 8 位')

  const db = getDb()
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email)
  if (existing) return errorJson(c, 409, 'AUTH_409', '该邮箱已注册')

  const id = crypto.randomUUID()
  const now = new Date()
  const nowIso = now.toISOString()
  // 24h 试用：新用户内置 LLM/STT 额度全无限。到期后回落 free 档额度。
  const trialExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const nickname = email.split('@')[0]
  const hash = await hashPassword(password)
  db.prepare(
    `INSERT INTO users (id, email, password_hash, nickname, plan, created_at, bound_at, trial_expires_at) VALUES (?, ?, ?, ?, 'free', ?, ?, ?)`,
  ).run(id, email, hash, nickname, nowIso, nowIso, trialExpiresAt)

  const session = await buildSession(id)
  const account: Account = {
    id, type: 'network', nickname, email, plan: 'free', createdAt: nowIso, boundAt: nowIso, trialEndsAt: trialExpiresAt,
  }
  return c.json({ account, session })
})

// 登录：30s/IP 限频。
auth.post('/login', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown'
  if (!rateLimit(`login:${ip}`, 5, 30_000)) {
    return errorJson(c, 429, 'AUTH_429', '操作过于频繁，请稍后再试')
  }
  const body = await c.req.json().catch(() => null) as { email?: string; password?: string } | null
  if (!body?.email || !body?.password) return errorJson(c, 400, 'AUTH_400', '邮箱和密码必填')
  const email = body.email.toLowerCase().trim()

  const db = getDb()
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined
  // 统一不区分"邮箱不存在"vs"密码错误"防枚举。
  if (!row) return errorJson(c, 401, 'AUTH_401', '邮箱或密码错误')
  const ok = await verifyPassword(body.password, row.password_hash)
  if (!ok) return errorJson(c, 401, 'AUTH_401', '邮箱或密码错误')

  const session = await buildSession(row.id)
  return c.json({ account: rowToAccount(row), session })
})

// 刷新：单次轮换 + 重放检测。响应附带最新 account（前端 hydrate 可同步刷新 plan 状态）。
auth.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => null) as { refreshToken?: string } | null
  if (!body?.refreshToken) return errorJson(c, 401, 'AUTH_401', 'refresh token 缺失')
  const result = consumeRefreshToken(body.refreshToken)
  if (!result) return errorJson(c, 401, 'AUTH_401', 'refresh token 已失效')
  if ('replay' in result) return errorJson(c, 401, 'AUTH_401', '检测到异常登录，请重新登录')

  const { userId } = result
  const session = await buildSession(userId)
  const db = getDb()
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined
  if (!row) return errorJson(c, 401, 'AUTH_401', '账号不存在')
  return c.json({ account: rowToAccount(row), session })
})

// 登出：作废该用户全部 refresh token。
auth.post('/logout', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { refreshToken?: string } | null
  if (body?.refreshToken) {
    // 仅作废当前 token（设备级登出）
    consumeRefreshToken(body.refreshToken)
  }
  return c.json({ ok: true })
})

export default auth
