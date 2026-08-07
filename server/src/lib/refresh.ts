import { randomBytes, createHash } from 'node:crypto'
import { env } from '../env.js'
import { getDb, type RefreshTokenRow } from '../db/index.js'

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token + env.refreshSecret).digest('hex')
}

export function expiryIso(): string {
  return new Date(Date.now() + env.refreshTtl * 1000).toISOString()
}

// 插入新 refresh token，返回明文 token（仅此一次返回）。
export function issueRefreshToken(userId: string): string {
  const token = generateRefreshToken()
  const db = getDb()
  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    userId,
    hashToken(token),
    expiryIso(),
    new Date().toISOString(),
  )
  return token
}

// 校验 refresh token：有效且未过期未作废 → 返回 user_id；否则返回 null。
// 2026-08-07：移除「重放检测作废全部 token」——移动端弱网下轮换响应丢失后客户端持旧 token
// 重试会误判为重放，把合法新 token 一并炸掉（自我 DoS，dcq 账号 8/6 实锤：最新 token 被
// 作废且无后继 → 全端会话死亡）。旧 token 重放只 401 持有者本人，合法会话不受影响。
export function consumeRefreshToken(token: string): { userId: string } | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`)
    .get(hashToken(token)) as RefreshTokenRow | undefined
  if (!row) return null
  if (row.revoked_at) {
    console.warn('[auth] revoked refresh token presented (replay or lost-rotation retry), user:', row.user_id)
    return null
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) return null
  // 单次轮换：作废当前 token。
  db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), row.id)
  return { userId: row.user_id }
}

export function revokeAllUserTokens(userId: string): void {
  const db = getDb()
  db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), userId)
}
