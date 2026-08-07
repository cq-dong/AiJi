import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { getDb, type UserRow } from '../db/index.js'
import { verifyPassword } from '../lib/password.js'
import { errorJson } from '../lib/http.js'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { MEDIA_ROOT } from './sync.js'

const account = new Hono<AppEnv>()

// 注销账号：二次确认密码 → 硬删 users + refresh_tokens + quotas + redeem_logs + sync_rows + 媒体目录。
// （refresh_tokens 有 ON DELETE CASCADE，但显式删更稳。）
account.post('/delete', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as { password?: string } | null
  if (!body?.password) return errorJson(c, 400, 'AUTH_400', '请输入密码确认')
  const db = getDb()
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined
  if (!row) return errorJson(c, 401, 'AUTH_401', '账号不存在')
  const ok = await verifyPassword(body.password, row.password_hash)
  if (!ok) return errorJson(c, 401, 'AUTH_401', '密码错误')
  db.transaction(() => {
    db.prepare(`DELETE FROM quotas WHERE user_id = ?`).run(userId)
    db.prepare(`DELETE FROM redeem_logs WHERE user_id = ?`).run(userId)
    db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).run(userId)
    db.prepare(`DELETE FROM sync_rows WHERE user_id = ?`).run(userId)
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId)
  })()
  // 媒体文件在 tx 外删（fs 副作用不进 sqlite tx）：rm -rf media/<userId>。best-effort。
  try {
    rmSync(join(MEDIA_ROOT, userId), { recursive: true, force: true })
  } catch (e) {
    console.error('[account] media rm failed', e)
  }
  return c.json({ ok: true })
})

export default account
