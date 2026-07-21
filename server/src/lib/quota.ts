import { getDb, type QuotaRow, type UserRow } from '../db/index.js'
import { resolveLimits, type Account } from '../types.js'

// Asia/Shanghai 当地日期 YYYY-MM-DD。禁用 toISOString().slice(0,10)（UTC 凌晨错位）。
export function shanghaiDate(d = new Date()): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  // zh-CN 格式 YYYY/MM/DD
  const s = fmt.format(d)
  return s.replace(/\//g, '-')
}

// 下一重置时间：北京时间次日 00:00 → 转 ISO。
export function nextResetAt(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value) - 1
  const day = Number(parts.find((p) => p.type === 'day')!.value)
  // 次日 00:00 北京时间 = UTC 16:00 前一天（+8 时区）
  const tomorrow = new Date(Date.UTC(y, m, day + 1, -8, 0, 0))
  return tomorrow.toISOString()
}

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

export function getAccount(userId: string): Account | null {
  const db = getDb()
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined
  return row ? rowToAccount(row) : null
}

export function todayQuota(userId: string): QuotaRow {
  const db = getDb()
  const date = shanghaiDate()
  const existing = db.prepare(`SELECT * FROM quotas WHERE user_id = ? AND date = ?`).get(userId, date) as QuotaRow | undefined
  if (existing) return existing
  db.prepare(`INSERT OR IGNORE INTO quotas (user_id, date) VALUES (?, ?)`).run(userId, date)
  return { user_id: userId, date, llm_used: 0, stt_used_sec: 0, agg_used: 0 }
}

export function getQuotaForUser(userId: string) {
  const account = getAccount(userId)
  if (!account) throw new Error('user not found')
  const limits = resolveLimits(account)
  const q = todayQuota(userId)
  return {
    llmUsed: q.llm_used,
    llmLimit: limits.llmLimit,
    sttUsedSec: q.stt_used_sec,
    sttLimitSec: limits.sttLimitSec,
    aggUsed: q.agg_used,
    aggLimit: limits.aggLimit,
    resetAt: nextResetAt(),
  }
}

// 原子 check+deduct：BEGIN IMMEDIATE 事务内检查余额并扣减。返回 true=成功，false=超限。
// amount 为负=回滚（减扣，不检查上限）。
export function consumeQuota(userId: string, type: 'llm' | 'stt' | 'agg', amount: number): boolean {
  const db = getDb()
  const tx = db.transaction(() => {
    const account = getAccount(userId)
    if (!account) throw new Error('user not found')
    const limits = resolveLimits(account)
    const q = todayQuota(userId)
    if (amount > 0) {
      if (type === 'llm' && limits.llmLimit >= 0 && q.llm_used + amount > limits.llmLimit) return false
      if (type === 'stt' && limits.sttLimitSec >= 0 && q.stt_used_sec + amount > limits.sttLimitSec) return false
      if (type === 'agg' && limits.aggLimit >= 0 && q.agg_used + amount > limits.aggLimit) return false
    }
    const col = type === 'llm' ? 'llm_used' : type === 'stt' ? 'stt_used_sec' : 'agg_used'
    db.prepare(`UPDATE quotas SET ${col} = ${col} + ? WHERE user_id = ? AND date = ?`)
      .run(amount, q.user_id, q.date)
    return true
  })
  return tx()
}
