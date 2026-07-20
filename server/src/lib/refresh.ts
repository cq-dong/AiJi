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

// 校验 refresh token：有效且未过期未作废 → 返回 user_id；已作废 → 返回 null（并触发重放保护作废该用户全部）。
export function consumeRefreshToken(token: string): { userId: string } | { replay: true } | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`)
    .get(hashToken(token)) as RefreshTokenRow | undefined
  if (!row) return null
  if (row.revoked_at) {
    // 重放检测：被盗用旧 token 再次出现 → 作废该用户全部 refresh（受害者踢下线，攻击者也失效）。
    db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), row.user_id)
    return { replay: true }
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
