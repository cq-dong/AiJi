import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { getDb, type SyncRow } from '../db/index.js'
import { errorJson } from '../lib/http.js'
import { resolveLimits, type SyncChange } from '../types.js'
import { getAccount } from '../lib/quota.js'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

const sync = new Hono<AppEnv>()

// push 接受的 kind。media 经 PUT /media/:ref 上行（自动落 kind='media' 行），
// 但 media tombstone 由 push 携带（客户端删条目时级联），故 'media' 必须在集合内。
const KINDS = new Set(['entry', 'category', 'tag', 'reminder', 'draft', 'media'])

// 媒体根：server/media/<userId>/<ref>（prod cwd=/opt/aiji → /opt/aiji/media）。
// ref 白名单字符集防路径穿越。
export const MEDIA_ROOT = resolve(process.cwd(), 'media')
const REF_RE = /^[A-Za-z0-9_-]{1,128}$/
const MAX_MEDIA_BYTES = 20 * 1024 * 1024 // nginx client_max_body_size 20m 同限

function mediaPath(userId: string, ref: string): string {
  return join(MEDIA_ROOT, userId, ref)
}

function mediaUsage(db: ReturnType<typeof getDb>, userId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(json_extract(payload, '$.size')), 0) AS u FROM sync_rows WHERE user_id = ? AND kind = 'media' AND deleted_at IS NULL`,
    )
    .get(userId) as { u: number }
  return row.u
}

// POST /api/sync/push {changes:[...]} — 批量 LWW 写入。tombstone 优先于非 tombstone；
// 否则 updatedAt 严格大者胜（等值 incoming 输，天然幂等）。败方进 rejected，客户端下次 pull 拿胜方。
// 删+插（同事务）让 seq 换新值——pull 游标才能观测到本次变更（UPDATE 不换 rowid）。
sync.post('/push', async (c) => {
  const userId = c.get('userId') as string
  const body = (await c.req.json().catch(() => null)) as { changes?: SyncChange[] } | null
  if (!Array.isArray(body?.changes) || body.changes.length === 0) {
    return errorJson(c, 400, 'AUTH_400', 'changes 必填')
  }
  if (body.changes.length > 200) return errorJson(c, 400, 'AUTH_400', '单批最多 200 条')
  // 账号存在性校验：JWT 是 stateless 的，注销后旧 token 仍能验签，故在此显式查库。
  if (!getAccount(userId)) return errorJson(c, 401, 'AUTH_401', '账号不存在')
  const db = getDb()
  const rejected: { kind: string; id: string }[] = []
  const tx = db.transaction((changes: SyncChange[]) => {
    for (const ch of changes) {
      if (!KINDS.has(ch.kind) || !ch.id || !ch.updatedAt || Number.isNaN(new Date(ch.updatedAt).getTime())) {
        rejected.push({ kind: String(ch.kind ?? ''), id: String(ch.id ?? '') })
        continue
      }
      const existing = db
        .prepare(`SELECT * FROM sync_rows WHERE user_id = ? AND kind = ? AND id = ?`)
        .get(userId, ch.kind, ch.id) as SyncRow | undefined
      if (existing) {
        const existTs = new Date(existing.updated_at).getTime()
        const inTs = new Date(ch.updatedAt).getTime()
        const inTomb = !!ch.deletedAt
        const existTomb = !!existing.deleted_at
        const incomingWins = inTomb !== existTomb ? inTomb : inTs > existTs
        if (!incomingWins) {
          rejected.push({ kind: ch.kind, id: ch.id })
          continue
        }
      }
      db.prepare(`DELETE FROM sync_rows WHERE user_id = ? AND kind = ? AND id = ?`).run(userId, ch.kind, ch.id)
      db.prepare(
        `INSERT INTO sync_rows (user_id, kind, id, payload, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        ch.kind,
        ch.id,
        ch.deletedAt ? null : JSON.stringify(ch.payload ?? null),
        ch.updatedAt,
        ch.deletedAt ?? null,
      )
      // media tombstone：同步删磁盘文件释放配额（best-effort，文件可能已不存在）。
      if (ch.kind === 'media' && ch.deletedAt) {
        try {
          unlinkSync(mediaPath(userId, ch.id))
        } catch {
          // 文件不存在——忽略
        }
      }
    }
  })
  tx(body.changes)
  return c.json({ applied: body.changes.length - rejected.length, rejected })
})

// GET /api/sync/pull?since=<seq>&limit=200 — 游标增量拉取（含 tombstone 与 kind='media' 行）。
sync.get('/pull', (c) => {
  const userId = c.get('userId') as string
  if (!getAccount(userId)) return errorJson(c, 401, 'AUTH_401', '账号不存在')
  const since = Number(c.req.query('since') ?? '0') || 0
  const limit = Math.min(Number(c.req.query('limit') ?? '200') || 200, 500)
  const db = getDb()
  const rows = db
    .prepare(`SELECT * FROM sync_rows WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
    .all(userId, since, limit + 1) as SyncRow[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const changes = page.map((r) => ({
    seq: r.seq,
    kind: r.kind as SyncChange['kind'],
    id: r.id,
    payload: r.payload ? (JSON.parse(r.payload) as unknown) : undefined,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }))
  const cursor = page.length > 0 ? page[page.length - 1].seq : since
  return c.json({ changes, cursor, hasMore })
})

// GET /api/sync/status — 存储用量（kind='media' 未 tombstone 行 payload.size 求和）+ 套餐上限。
sync.get('/status', (c) => {
  const userId = c.get('userId') as string
  const db = getDb()
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(json_extract(payload, '$.size')), 0) AS u FROM sync_rows WHERE user_id = ? AND kind = 'media' AND deleted_at IS NULL`,
    )
    .get(userId) as { u: number }
  const account = getAccount(userId)
  if (!account) return errorJson(c, 401, 'AUTH_401', '账号不存在')
  return c.json({ usedBytes: row.u, limitBytes: resolveLimits(account).storageLimitBytes })
})

// PUT /api/sync/media/:ref — raw body 直传。配额按套餐 storageLimitBytes；覆盖同 ref 只计增量。
sync.put('/media/:ref', async (c) => {
  const userId = c.get('userId') as string
  const ref = c.req.param('ref')
  if (!REF_RE.test(ref)) return errorJson(c, 400, 'AUTH_400', 'ref 非法')
  const mime = c.req.header('content-type') ?? 'application/octet-stream'
  const buf = Buffer.from(await c.req.arrayBuffer())
  if (buf.length === 0) return errorJson(c, 400, 'AUTH_400', '空文件')
  if (buf.length > MAX_MEDIA_BYTES) return errorJson(c, 400, 'AUTH_400', '单文件最大 20MB')
  const db = getDb()
  const account = getAccount(userId)
  if (!account) return errorJson(c, 401, 'AUTH_401', '账号不存在')
  const limit = resolveLimits(account).storageLimitBytes
  const existing = db
    .prepare(`SELECT payload FROM sync_rows WHERE user_id = ? AND kind = 'media' AND id = ? AND deleted_at IS NULL`)
    .get(userId, ref) as { payload: string } | undefined
  const oldSize = existing ? (JSON.parse(existing.payload) as { size?: number }).size ?? 0 : 0
  if (limit >= 0 && mediaUsage(db, userId) - oldSize + buf.length > limit) {
    return errorJson(c, 403, 'AUTH_403', '云存储空间不足，请升级套餐')
  }
  mkdirSync(join(MEDIA_ROOT, userId), { recursive: true })
  writeFileSync(mediaPath(userId, ref), buf)
  const now = new Date().toISOString()
  db.prepare(`DELETE FROM sync_rows WHERE user_id = ? AND kind = 'media' AND id = ?`).run(userId, ref)
  db.prepare(
    `INSERT INTO sync_rows (user_id, kind, id, payload, updated_at, deleted_at) VALUES (?, 'media', ?, ?, ?, NULL)`,
  ).run(userId, ref, JSON.stringify({ ref, mime, size: buf.length }), now)
  return c.json({ ok: true, size: buf.length })
})

// GET /api/sync/media/:ref — 按行存在且未 tombstone 才发文件。
sync.get('/media/:ref', (c) => {
  const userId = c.get('userId') as string
  const ref = c.req.param('ref')
  if (!REF_RE.test(ref)) return errorJson(c, 400, 'AUTH_400', 'ref 非法')
  if (!getAccount(userId)) return errorJson(c, 401, 'AUTH_401', '账号不存在')
  const db = getDb()
  const row = db
    .prepare(`SELECT payload FROM sync_rows WHERE user_id = ? AND kind = 'media' AND id = ? AND deleted_at IS NULL`)
    .get(userId, ref) as { payload: string } | undefined
  if (!row) return errorJson(c, 404, 'AUTH_404', '媒体不存在')
  let buf: Buffer
  try {
    buf = readFileSync(mediaPath(userId, ref))
  } catch {
    return errorJson(c, 404, 'AUTH_404', '媒体文件缺失')
  }
  const mime = (JSON.parse(row.payload) as { mime?: string }).mime ?? 'application/octet-stream'
  return c.body(new Uint8Array(buf), 200, { 'Content-Type': mime })
})

export default sync
