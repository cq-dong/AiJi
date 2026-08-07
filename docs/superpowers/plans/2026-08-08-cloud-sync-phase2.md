# 云端同步 Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网络账号的条目/类别/标签/提醒/草稿 + 媒体 blob 在设备间自动同步（保存即推 + 开 App 即拉 + 5min 兜底），离线可写、重连补传。

**Architecture:** 客户端 Dexie outbox（改动即入队）→ debounce 批量 push → 服务端 `sync_rows` 通用表（LWW + tombstone，seq 自增作 pull 游标）；pull 按游标拉增量并应用进 Dexie（绕过 outbox 防回声）。媒体 blob 经 API 直传服务器磁盘（`/opt/aiji/media/<userId>/<ref>`），元数据作为 `kind='media'` 行进同一游标 feed。

**Spec:** `docs/superpowers/specs/2026-07-29-account-center-design.md` §3。两处用户已批准的有意偏离：
1. **媒体存服务器磁盘**，不走 COS 预签名（COS 未开通；磁盘已 87%，单用户测试够用，长期再迁 COS）。
2. **同步实体表合并为通用 `sync_rows`**（spec §3.2 的按实体分表是示意；协议语义不变）。

**Tech Stack:** 前端 React 19 + Dexie + Zustand；后端 Hono + better-sqlite3（WAL）。

## Global Constraints

- 前端 TS strict：`verbatimModuleSyntax`（类型必须 `import type`）、`erasableSyntaxOnly`（禁 enum/namespace/参数属性）、`noUnusedLocals/Parameters`。
- 服务端同 strict（server/tsconfig）；`errorJson(c, status, 'AUTH_<CODE>', '<中文>')` 统一错误。
- **Hono 中间件顺序**：`app.use('/api/sync/*', authMiddleware)` 必须在 `app.route('/api/sync', ...)` **之前**注册（Phase 1 教训）。
- 同步范围：entry（内嵌 EntryAi）、category、tag、reminder、draft、media blob。**不同步**：aggregates/conversations/memories/settings/BYOK keys（spec §3.5）。
- 同步**不吃** LLM/STT 配额；媒体存储按套餐限：free 200MB / monthly 5GB / yearly 20GB（`storageLimitBytes`，-1=不限）。超限提示升级、**不删数据**。
- 冲突：按行 LWW——`updatedAt` 新者胜；**tombstone 优先于非 tombstone**（spec §3.3）。不做 CRDT。
- 只有 network 账号能开同步；guest 禁用 toggle。outbox 行按 `ownerId` 盖章（同本地分区）。
- 媒体单文件 ≤20MB（nginx `client_max_body_size 20m`，与 STT 同限）。>20MB 视频上传会失败——已知限制，本期不做分片。
- 服务器磁盘 87% 已用——媒体写盘要有 size 检查（quota 挡住），部署后关注磁盘。
- 子智能体**不 commit/push**；写完自测回报 lead，lead 负责 commit。并行子智能体自检用 `npx tsc -p tsconfig.app.json`（不用 `npm run typecheck`）。

## 协议契约（前后端共用，任务间对齐的唯一真源）

```ts
// kind：'entry'|'category'|'tag'|'reminder'|'draft'|'media'
interface SyncChange {
  kind: SyncKind
  id: string                 // entry/draft/reminder=uuid；category/tag=slug；media=part.ref
  payload?: unknown          // tombstone 时省略；entry={entry:Entry, ai:EntryAi|null}；media={ref,mime,size}
  updatedAt: string          // ISO，LWW 时间戳
  deletedAt?: string         // 非空 = tombstone
}
// POST /api/sync/push {changes: SyncChange[]} → {applied:number, rejected:{kind,id}[]}
//   单批 ≤200。LWW 判定：tombstone 状态不同 → tombstone 胜；否则 updatedAt 严格大者胜（等值 incoming 输=幂等重推）。
// GET  /api/sync/pull?since=<seq>&limit=200 → {changes:(SyncChange&{seq})[], cursor:number, hasMore:boolean}
//   按 seq 升序；hasMore=true 时客户端续拉。
// GET  /api/sync/status → {usedBytes:number, limitBytes:number}   // limitBytes=-1 不限
// PUT  /api/sync/media/:ref  (raw body= blob, Content-Type=mime) → {ok:true, size:number}
//   403 AUTH_403 '云存储空间不足，请升级套餐'；400 空文件/非法 ref/>20MB。覆盖同 ref 只计增量。
// GET  /api/sync/media/:ref → 200 blob（Content-Type=上传时 mime）；404 不存在/已 tombstone。
```

---

### Task 1: 服务端 schema + 套餐存储配额

**Files:**
- Modify: `server/src/db/index.ts`（exec 块加两表 + Row 接口）
- Modify: `server/src/types.ts`（PLAN_TIERS.limits 加 `storageLimitBytes` + resolveLimits + SyncKind/SyncChange 类型）

**Interfaces:**
- Produces: `sync_rows`/`sync_media` 表；`SyncRow`/`SyncMediaRow` 接口；`types.ts` 的 `SyncKind`、`SyncChange`、`resolveLimits()` 返回值含 `storageLimitBytes`。

注意：实施时把 `sync_media` 表**省略**——设计定稿：媒体元数据直接放 `sync_rows`（`kind='media'`, payload `{ref,mime,size}`），存储用量用 `json_extract` 求和。`sync_media` 不建。下方代码以此为准。

- [ ] **Step 1: 改 `server/src/db/index.ts`**

`getDb()` 的 `db.exec(\`...\`)` 块末尾（redeem_logs 之后）追加：

```sql
    CREATE TABLE IF NOT EXISTS sync_rows (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE (user_id, kind, id)
    );
    CREATE INDEX IF NOT EXISTS idx_sync_user_seq ON sync_rows(user_id, seq);
```

文件末尾追加 Row 接口：

```ts
export interface SyncRow {
  seq: number
  user_id: string
  kind: string
  id: string
  payload: string | null
  updated_at: string
  deleted_at: string | null
}
```

- [ ] **Step 2: 改 `server/src/types.ts`**

PLAN_TIERS 三档 limits 各加 `storageLimitBytes`（free `209715200`、monthly `5368709120`、yearly `21474836480`），`PlanTier.limits` 类型同步加字段。`resolveLimits` 返回类型加 `storageLimitBytes: number`；trial 分支返 `{ llmLimit: -1, sttLimitSec: -1, aggLimit: -1, storageLimitBytes: -1 }`；末尾 `return PLAN_TIERS[0].limits` 不变（free 档自带新字段）。文件末尾追加：

```ts
// ── 云端同步（Phase 2）──
export type SyncKind = 'entry' | 'category' | 'tag' | 'reminder' | 'draft' | 'media'

export interface SyncChange {
  kind: SyncKind
  id: string
  payload?: unknown
  updatedAt: string
  deletedAt?: string
}
```

- [ ] **Step 3: 验证**

```bash
cd server && npx tsc && rm -f /tmp/syncprobe.db && node -e "
process.chdir('/Users/dcq/Desktop/AionUiSpace/AiJi/server');
const {getDb} = await import('./dist/db/index.js');
const db = getDb();
console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='sync_rows'\").all());
" --input-type=module
```
Expected: 编译无错；输出含 sync_rows 行。

- [ ] **Step 4: 报告 lead**（不 commit）

---

### Task 2: 服务端 push 路由（LWW + tombstone）

**Files:**
- Create: `server/src/routes/sync.ts`
- Modify: `server/src/index.ts`（注册中间件+路由）
- Create: `server/scripts/sync-test.sh`（curl 冒烟，后续任务续写）

**Interfaces:**
- Consumes: Task 1 的 `sync_rows`/`SyncChange`/`SyncRow`。
- Produces: `POST /api/sync/push`（协议契约见头部）。

- [ ] **Step 1: 写 `server/src/routes/sync.ts`**

```ts
import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { getDb, type SyncRow } from '../db/index.js'
import { errorJson } from '../lib/http.js'
import type { SyncChange } from '../types.js'

const sync = new Hono<AppEnv>()

// push 接受的 kind。media 经 PUT /media/:ref 上行（自动落 kind='media' 行），
// 但 media tombstone 由 push 携带（客户端删条目时级联），故 'media' 必须在集合内。
const KINDS = new Set(['entry', 'category', 'tag', 'reminder', 'draft', 'media'])

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
    }
  })
  tx(body.changes)
  return c.json({ applied: body.changes.length - rejected.length, rejected })
})

export default sync
```

- [ ] **Step 2: 注册进 `server/src/index.ts`**

import 区加 `import syncRoutes from './routes/sync.js'`；在 `app.route('/api/account', accountRoutes)` 行之后加：

```ts
// sync: 全部端点需鉴权（中间件须在 route 之前，Hono 按注册顺序匹配）。
app.use('/api/sync/*', authMiddleware)
app.route('/api/sync', syncRoutes)
```

- [ ] **Step 3: 写 `server/scripts/sync-test.sh` 并跑通**

```bash
#!/usr/bin/env bash
# 云端同步冒烟：register → push → 再 push 旧时间戳(应 rejected) → tombstone 覆盖(应胜)。
# 用法：BASE=http://localhost:8787 bash scripts/sync-test.sh
set -euo pipefail
BASE="${BASE:-http://localhost:8787}"
EMAIL="synctest_$(date +%s)@test.com"
JWT=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"synctest123\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["session"]["jwt"])')
echo "JWT ok ($EMAIL)"

echo '--- push entry ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{
  "changes":[{"kind":"entry","id":"e1","payload":{"entry":{"id":"e1","createdAt":"2026-08-08T01:00:00.000Z","updatedAt":"2026-08-08T01:00:00.000Z","parts":[{"type":"text","content":"hello"}],"status":"ready"},"ai":null},"updatedAt":"2026-08-08T01:00:00.000Z"}]
}' | tee /tmp/sync_push1.json | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==1 and not d["rejected"],d;print("applied=1 ok")'

echo '--- push stale (older updatedAt, expect rejected) ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{
  "changes":[{"kind":"entry","id":"e1","payload":{"entry":{"id":"e1"},"ai":null},"updatedAt":"2026-08-07T01:00:00.000Z"}]
}' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==0 and len(d["rejected"])==1,d;print("stale rejected ok")'

echo '--- tombstone wins over newer non-tombstone ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{
  "changes":[{"kind":"entry","id":"e1","updatedAt":"2026-08-07T02:00:00.000Z","deletedAt":"2026-08-07T02:00:00.000Z"}]
}' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==1,d;print("tombstone applied ok")'

echo '--- non-tombstone never beats tombstone (even with newer ts) ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{
  "changes":[{"kind":"entry","id":"e1","payload":{"entry":{"id":"e1"},"ai":null},"updatedAt":"2026-08-09T01:00:00.000Z"}]
}' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==0 and len(d["rejected"])==1,d;print("tombstone held ok")'

echo '--- unauth 401 ---'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sync/push" -H 'Content-Type: application/json' -d '{"changes":[]}')
[ "$CODE" = "401" ] && echo "401 ok" || { echo "expected 401 got $CODE"; exit 1; }
echo 'SYNC PUSH TESTS PASSED'
```

```bash
cd server && npm run dev &  # 或已运行则跳过
sleep 2 && bash scripts/sync-test.sh
```
Expected: 全绿，末尾 `SYNC PUSH TESTS PASSED`。

- [ ] **Step 4: 报告 lead**

---

### Task 3: 服务端 pull + status 路由

**Files:**
- Modify: `server/src/routes/sync.ts`（加两个 GET）
- Modify: `server/scripts/sync-test.sh`（追加 pull/status 断言）

**Interfaces:**
- Consumes: Task 1 schema、Task 2 路由骨架；`lib/quota.ts` 的 `getAccount`；`types.ts` 的 `resolveLimits`。
- Produces: `GET /api/sync/pull`、`GET /api/sync/status`（协议契约见头部）。

- [ ] **Step 1: `server/src/routes/sync.ts` 追加（export default 之前）**

```ts
// GET /api/sync/pull?since=<seq>&limit=200 — 游标增量拉取（含 tombstone 与 kind='media' 行）。
sync.get('/pull', (c) => {
  const userId = c.get('userId') as string
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
```

import 区加：`import { getAccount } from '../lib/quota.js'` 和 `import { resolveLimits } from '../types.js'`（resolveLimits 与 SyncChange 同文件，合并成一条 import）。

- [ ] **Step 2: sync-test.sh 追加断言（在 push 用例之后、unauth 之前）**

```bash
echo '--- pull since=0 sees tombstone ---'
curl -s "$BASE/api/sync/pull?since=0" -H "Authorization: Bearer $JWT" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["hasMore"] is False and d["cursor"] > 0, d
e1=[c for c in d["changes"] if c["id"]=="e1"]
assert e1 and e1[-1]["deletedAt"], d
print("pull ok, cursor=%s" % d["cursor"])'

echo '--- pull since=cursor returns empty ---'
CUR=$(curl -s "$BASE/api/sync/pull?since=0" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["cursor"])')
curl -s "$BASE/api/sync/pull?since=$CUR" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["changes"]==[] and d["hasMore"] is False,d;print("incremental empty ok")'

echo '--- status ---'
curl -s "$BASE/api/sync/status" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["usedBytes"]==0 and d["limitBytes"]==-1,d;print("status ok (trial=-1)")'
```

- [ ] **Step 3: 跑 `bash scripts/sync-test.sh`** — Expected: 全绿。

- [ ] **Step 4: 报告 lead**

---

### Task 4: 服务端媒体上传/下载（服务器磁盘）

**Files:**
- Modify: `server/src/routes/sync.ts`（加 PUT/GET media + push 对 media tombstone 的删文件联动）
- Modify: `server/scripts/sync-test.sh`
- Modify: `server/.gitignore`（加 `media/`）

**Interfaces:**
- Produces: `PUT/GET /api/sync/media/:ref`；媒体文件落 `server/media/<userId>/<ref>`（prod 即 `/opt/aiji/media/...`）。
- 联动：push 收到 `kind='media'` 且带 `deletedAt` 的 change → 正常走 LWW 落 tombstone，**同时 best-effort 删磁盘文件**（释放配额；文件缺失不报错）。

- [ ] **Step 1: `server/src/routes/sync.ts` 追加**

import 区加：

```ts
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
```

文件级常量 + helper（KINDS 定义之后）：

```ts
// 媒体根：server/media/<userId>/<ref>（prod cwd=/opt/aiji → /opt/aiji/media）。
// ref 白名单字符集防路径穿越。
const MEDIA_ROOT = resolve(process.cwd(), 'media')
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
```

push handler 里 `INSERT` 成功之后（tx 循环内，`db.prepare(INSERT...).run(...)` 之后）加 media tombstone 删文件联动：

```ts
      // media tombstone：同步删磁盘文件释放配额（best-effort，文件可能已不存在）。
      if (ch.kind === 'media' && ch.deletedAt) {
        try {
          unlinkSync(mediaPath(userId, ch.id))
        } catch {
          // 文件不存在——忽略
        }
      }
```

注意：这在 tx 内做 fs 副作用，若 tx 后续行失败回滚会出现"文件已删但行未落"——可接受（下次 pull tombstone 会再删一次，幂等）。

media 路由（export default 之前）：

```ts
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
```

- [ ] **Step 2: sync-test.sh 追加（status 用例之后）**

```bash
echo '--- media upload/download roundtrip ---'
printf 'fake-image-bytes-0808' > /tmp/sync_media.bin
curl -s -X PUT "$BASE/api/sync/media/refabc123" -H "Authorization: Bearer $JWT" -H 'Content-Type: image/jpeg' --data-binary @/tmp/sync_media.bin | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["ok"] and d["size"]==21,d;print("upload ok")'
curl -s "$BASE/api/sync/media/refabc123" -H "Authorization: Bearer $JWT" | cmp - /tmp/sync_media.bin && echo "download bytes identical"
curl -s "$BASE/api/sync/status" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["usedBytes"]==21,d;print("usage=21 ok")'

echo '--- media appears in pull feed ---'
curl -s "$BASE/api/sync/pull?since=0" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);m=[c for c in d["changes"] if c["kind"]=="media" and c["id"]=="refabc123"];assert m and m[0]["payload"]["size"]==21,d;print("media in feed ok")'

echo '--- media tombstone deletes file + frees quota ---'
curl -s -X POST "$BASE/api/sync/push" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"changes":[{"kind":"media","id":"refabc123","updatedAt":"2026-08-08T03:00:00.000Z","deletedAt":"2026-08-08T03:00:00.000Z"}]}' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["applied"]==1,d;print("media tombstone applied")'
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sync/media/refabc123" -H "Authorization: Bearer $JWT")
[ "$CODE" = "404" ] && echo "gone ok" || { echo "expected 404 got $CODE"; exit 1; }
curl -s "$BASE/api/sync/status" -H "Authorization: Bearer $JWT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["usedBytes"]==0,d;print("usage freed ok")'
```

- [ ] **Step 3: `server/.gitignore` 追加一行 `media/`**

- [ ] **Step 4: `cd server && npx tsc && bash scripts/sync-test.sh`** — Expected: 全绿。

- [ ] **Step 5: 报告 lead**

---

### Task 5: 注销账号级联删同步数据 + 媒体文件

**Files:**
- Modify: `server/src/routes/account.ts`
- Modify: `server/scripts/sync-test.sh`

**Interfaces:**
- Consumes: Task 4 的 `MEDIA_ROOT`（从 sync.ts export 出来复用——把 `const MEDIA_ROOT` 改 `export const MEDIA_ROOT`）。

- [ ] **Step 1: `server/src/routes/sync.ts` 把 `const MEDIA_ROOT` 改为 `export const MEDIA_ROOT`**

- [ ] **Step 2: `server/src/routes/account.ts`**

import 加：

```ts
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { MEDIA_ROOT } from './sync.js'
```

delete handler 的 `db.transaction` 内（删 users 之前）加：

```ts
    db.prepare(`DELETE FROM sync_rows WHERE user_id = ?`).run(userId)
```

tx 之后（`return c.json({ ok: true })` 之前）加：

```ts
  // 媒体文件在 tx 外删（fs 副作用不进 sqlite tx）：rm -rf media/<userId>。best-effort。
  try {
    rmSync(join(MEDIA_ROOT, userId), { recursive: true, force: true })
  } catch (e) {
    console.error('[account] media rm failed', e)
  }
```

- [ ] **Step 3: sync-test.sh 末尾追加**

```bash
echo '--- delete account cascades sync rows + media dir ---'
curl -s -X PUT "$BASE/api/sync/media/refdel1" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/octet-stream' --data-binary 'x' > /dev/null
curl -s -X POST "$BASE/api/account/delete" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"password":"synctest123"}' | python3 -c 'import json,sys;assert json.load(sys.stdin)["ok"];print("deleted")'
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sync/pull?since=0" -H "Authorization: Bearer $JWT")
[ "$CODE" = "401" ] && echo "sync rows unreachable (user gone) ok" || { echo "expected 401 got $CODE"; exit 1; }
echo 'ALL SYNC TESTS PASSED'
```

- [ ] **Step 4: 跑全量 `bash scripts/sync-test.sh`** — Expected: `ALL SYNC TESTS PASSED`。

- [ ] **Step 5: 报告 lead**

---

### Task 6: 前端同步域类型 + Dexie v9

**Files:**
- Create: `src/domain/sync.ts`
- Modify: `src/domain/types.ts`（Settings 加 `syncEnabled?: boolean`）
- Modify: `src/data/db.ts`（v9 三表）
- Create: `src/data/__tests__/dbv9.test.ts`

**Interfaces:**
- Produces（后续任务依赖）：
  - `SyncKind`、`SyncChange`、`EntryPayload`、`MediaPayload`、`OutboxRow`、`SyncMediaTrackRow`（均 export 自 `@/domain/sync`）
  - `db.syncOutbox: Table<OutboxRow, number>`、`db.syncMedia: Table<SyncMediaTrackRow, string>`、`db.syncState: Table<SyncStateRow, string>`
  - `Settings.syncEnabled?: boolean`

- [ ] **Step 1: 写 `src/domain/sync.ts`**

```ts
// 云端同步（Phase 2）域类型——纯 TS 零 I/O。协议契约见
// docs/superpowers/plans/2026-08-08-cloud-sync-phase2.md 头部。
import type { Draft, Entry, EntryAi } from './types'

export type SyncKind = 'entry' | 'category' | 'tag' | 'reminder' | 'draft' | 'media'

export interface SyncChange {
  seq?: number // 仅 pull 响应带（服务端游标）
  kind: SyncKind
  id: string
  payload?: unknown
  updatedAt: string
  deletedAt?: string
}

// entry 行 payload：Entry 全量 + 当前 EntryAi（无则 null）。
export interface EntryPayload {
  entry: Entry
  ai: EntryAi | null
}

// media 行 payload。
export interface MediaPayload {
  ref: string
  mime: string
  size: number
}

// outbox 行：只记「谁变了」，payload 在 flush 时从活库现组（天然合并多次改写）。
// UNIQUE(ownerId,kind,id) 去重；tombstone=true 时 push 带 deletedAt。
export interface OutboxRow {
  seq?: number // Dexie 自增主键
  ownerId: string
  kind: SyncKind
  id: string
  updatedAt: string
  tombstone: boolean
}

// syncMedia：ref 已上传标记（存在即已传；media tombstone 推送成功后删行）。
export interface SyncMediaTrackRow {
  ref: string
  uploadedAt: string
}

// syncState：kv 元数据。key 例：'lastPullSeq:<accountId>'(number) / 'migrated:<accountId>'('1')。
export interface SyncStateRow {
  key: string
  value: unknown
}
```

- [ ] **Step 2: `src/domain/types.ts` Settings 接口加字段**（`language?: 'zh' | 'en'` 行之后）：

```ts
  // 云端同步（Phase 2）：开=保存即推+开 App 即拉+5min 兜底。仅 network 账号可开（UI 门）。
  syncEnabled?: boolean
```

- [ ] **Step 3: `src/data/db.ts` v9**

import 行加类型：`import type { OutboxRow, SyncMediaTrackRow, SyncStateRow } from '@/domain/sync'`。类声明加：

```ts
  // 云端同步（Phase 2）：outbox=待推队列（ownerId 分区）；syncMedia=已上传 ref 标记；
  // syncState=kv 元数据（lastPullSeq / migrated 标记）。
  syncOutbox!: Table<OutboxRow, number>
  syncMedia!: Table<SyncMediaTrackRow, string>
  syncState!: Table<SyncStateRow, string>
```

v8 之后追加 v9（`.stores()` 非增量——全部逐字重声明）：

```ts
    // v9: 云端同步——syncOutbox（++seq 自增主键，&[ownerId+kind+id] 唯一去重，ownerId 过滤）、
    // syncMedia（ref 主键）、syncState（key 主键 kv）。纯加表，无 upgrade 回调。
    this.version(9).stores({
      entries: 'id, createdAt, updatedAt, status, deletedAt, ownerId',
      entryAi: 'id, entryId, version',
      categories: 'slug, usageCount, ownerId',
      tags: 'slug, usageCount, ownerId',
      aggregates: 'id, scope.type, scope.range, stale, ownerId',
      settings: '++id',
      reminders: 'id, dueAt, status, entryId, ownerId',
      drafts: 'id, updatedAt',
      conversations: 'id, updatedAt, ownerId',
      memories: 'id, ownerId, updatedAt',
      syncOutbox: '++seq, &[ownerId+kind+id], ownerId',
      syncMedia: 'ref',
      syncState: 'key',
    })
```

- [ ] **Step 4: 写 `src/data/__tests__/dbv9.test.ts`**

```ts
// v9 schema：三张同步表可写读；syncOutbox 复合唯一约束生效（同 ownerId+kind+id add 两次 → ConstraintError）。
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from '@/data/db'

describe('db v9 sync tables', () => {
  it('syncOutbox/syncMedia/syncState writable', async () => {
    await db.syncOutbox.add({ ownerId: 'u1', kind: 'entry', id: 'e1', updatedAt: '2026-08-08T00:00:00.000Z', tombstone: false })
    await db.syncMedia.put({ ref: 'r1', uploadedAt: '2026-08-08T00:00:00.000Z' })
    await db.syncState.put({ key: 'lastPullSeq:u1', value: 42 })
    expect(await db.syncOutbox.count()).toBe(1)
    expect(await db.syncMedia.get('r1')).toBeTruthy()
    expect((await db.syncState.get('lastPullSeq:u1'))?.value).toBe(42)
  })

  it('syncOutbox compound unique rejects dup', async () => {
    await expect(
      db.syncOutbox.add({ ownerId: 'u1', kind: 'entry', id: 'e1', updatedAt: '2026-08-08T01:00:00.000Z', tombstone: false }),
    ).rejects.toThrow()
  })
})
```

（若项目已有 `fake-indexeddb` 依赖直接用；没有则 `npm i -D fake-indexeddb` 并查既有 db 测试怎么 mock——先看 `src/data/__tests__/` 或 `src/adapters/__tests__/` 里有没有现成 IndexedDB mock 模式，有则对齐。）

- [ ] **Step 5: `npx vitest run src/data/__tests__/dbv9.test.ts` + `npx tsc -p tsconfig.app.json`** — Expected: 全绿。

- [ ] **Step 6: 报告 lead**

---

### Task 7: outbox 模块 + dexieStorage 挂钩

**Files:**
- Create: `src/app/syncOutbox.ts`
- Modify: `src/adapters/dexieStorage.ts`（各写路径挂 enqueue）
- Create: `src/app/__tests__/syncOutbox.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `db.syncOutbox`/`OutboxRow`。
- Produces: `enqueue(ownerId, kind, id, opts?)`、`onOutboxEnqueue(fn)`（Task 9 引擎注册回调）。

**核心设计（必须先懂再写）：**
- outbox 只记「谁变了」，**不存 payload**——flush 时从活库现组（多次改写天然合并为最新态）。
- 回声防护：同步引擎应用远端变更时**直接写 `db.*`**（不经过 dexieStorage 方法），所以挂钩只放在 dexieStorage 上即零回声——不需要 applyingRemote 旗标。
- `deleteEntry`/`purgeExpired` 级联：entry tombstone + 其 reminders tombstone + 其媒体 ref 的 `kind='media'` tombstone（提醒/媒体是独立同步行，各自的 tombstone 随 pull 到其他端）。
- `trashEntry`/`recoverEntry` **不是** tombstone——entry 的 `deletedAt` 字段随 payload 走（软删是可恢复的更新）。

- [ ] **Step 1: 写 `src/app/syncOutbox.ts`**

```ts
// 同步 outbox：本地改动即入队（按 ownerId+kind+id 去重），同步引擎 debounce 后批量 push。
// 通知用槽模式（同 accountSlots）：dexieStorage → 本模块 → 引擎注册回调，零反向 import 成环。
import { db } from '@/data/db'
import type { SyncKind } from '@/domain/sync'

let notifyFn: (() => void) | null = null

/** syncEngine start 时注册：有改动入队即触发（引擎内 debounce）。stop 时传原引用清不掉无所谓——引擎停了自己不跑。 */
export function onOutboxEnqueue(fn: () => void): void {
  notifyFn = fn
}

/** 入队（去重：同 ownerId+kind+id 只留最新行）。tombstone=true → push 时带 deletedAt。 */
export async function enqueue(
  ownerId: string,
  kind: SyncKind,
  id: string,
  opts: { tombstone?: boolean } = {},
): Promise<void> {
  const now = new Date().toISOString()
  const tombstone = opts.tombstone ?? false
  const n = await db.syncOutbox
    .where('[ownerId+kind+id]')
    .equals([ownerId, kind, id])
    .modify({ updatedAt: now, tombstone })
  if (n === 0) await db.syncOutbox.add({ ownerId, kind, id, updatedAt: now, tombstone })
  notifyFn?.()
}
```

- [ ] **Step 2: `src/adapters/dexieStorage.ts` 挂钩**

import 加 `import { enqueue } from '@/app/syncOutbox'`。各方法在**写库成功后**追加 enqueue 调用（owner 一律 `getCurrentOwner()`，方法内已有 `owner` 变量的复用）：

| 方法 | 追加 |
|---|---|
| `saveEntry` | `void enqueue(getCurrentOwner(), 'entry', entry.id)` |
| `saveEntryAi` | `void enqueue(getCurrentOwner(), 'entry', ai.entryId)` |
| `saveCategory` | `void enqueue(getCurrentOwner(), 'category', cat.slug)` |
| `deleteCategory` | `void enqueue(owner, 'category', slug, { tombstone: true })`（delete 之后） |
| `saveTag` | `void enqueue(getCurrentOwner(), 'tag', tag.slug)` |
| `saveReminder` | `void enqueue(getCurrentOwner(), 'reminder', r.id)` |
| `deleteReminder` | `void enqueue(owner, 'reminder', id, { tombstone: true })` |
| `saveDraft` | `void enqueue(getCurrentOwner(), 'draft', d.id)` |
| `deleteDraft` | `void enqueue(getCurrentOwner(), 'draft', id, { tombstone: true })` |
| `trashEntry` | `void enqueue(owner, 'entry', id)`（软删=更新） |
| `recoverEntry` | `void enqueue(owner, 'entry', id)` |

`deleteEntry`（级联最复杂，重写该方法尾部）——删库**前**先查 reminders 和媒体 refs，删库后入队：

```ts
  async deleteEntry(id: string): Promise<void> {
    const owner = getCurrentOwner()
    const e = await db.entries.get(id)
    if (!e || e.ownerId !== owner) return
    // 级联同步：reminders 与媒体是独立同步行，各自的 tombstone 需显式入队。
    const cascadedReminders = await db.reminders.where('entryId').equals(id).toArray()
    const mediaRefs = e.parts.filter((p) => p.type !== 'text').map((p) => p.ref)
    if (e) await removeMediaForEntry(e)
    await db.entries.delete(id)
    await db.entryAi.where('entryId').equals(id).delete()
    await db.reminders.where('entryId').equals(id).delete()
    void enqueue(owner, 'entry', id, { tombstone: true })
    for (const r of cascadedReminders) void enqueue(owner, 'reminder', r.id, { tombstone: true })
    for (const ref of mediaRefs) void enqueue(owner, 'media', ref, { tombstone: true })
  },
```

`purgeExpired`：循环内每个 expired 条目同样三段入队（entry tombstone + reminders tombstones + media tombstones）——把循环体重构为先查 reminders/refs 再删再 enqueue（同 deleteEntry 模式）。

`adoptLocal`：tx 后追加——收养的行要同步（登录后首次 push 覆盖它们）。在事务**外**查各表当前 owner=accountId 的行逐一入队太重；简化：只 enqueue entries/categories/tags/reminders 全量（该 owner 的）。实现：

```ts
    // 收养的行需同步：全量入队该账号的 4 类分区行（幂等——flush 时现组 payload，LWW 服务端去重）。
    const [ents, cats, tgs, rems] = await Promise.all([
      db.entries.where('ownerId').equals(accountId).toArray(),
      db.categories.where('ownerId').equals(accountId).toArray(),
      db.tags.where('ownerId').equals(accountId).toArray(),
      db.reminders.where('ownerId').equals(accountId).toArray(),
    ])
    for (const e of ents) void enqueue(accountId, 'entry', e.id, { tombstone: !!e.deletedAt })
    for (const c of cats) void enqueue(accountId, 'category', c.slug)
    for (const t of tgs) void enqueue(accountId, 'tag', t.slug)
    for (const r of rems) void enqueue(accountId, 'reminder', r.id)
```

注意 trashed 条目（`e.deletedAt` 非空）在 adopt 入队时**不是** tombstone（payload 带 deletedAt 字段即可）——上面 `{ tombstone: !!e.deletedAt }` 是错的，应一律 `enqueue(accountId, 'entry', e.id)`。实施时按此修正。

**不挂钩**：saveAggregate/saveSettings/saveConversation/deleteConversation/saveMemory/deleteMemory/saveMedia/deleteMedia（不同步的实体；deleteMedia 由 deleteEntry 级联出 media tombstone 已覆盖）。

- [ ] **Step 3: 写 `src/app/__tests__/syncOutbox.test.ts`**

```ts
// outbox 挂钩：saveEntry→入队；重复 save 去重；deleteEntry→entry+reminder+media 三 tombstone；
// trashEntry→非 tombstone 更新。fake-indexeddb 跑真 Dexie。
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { dexieStorage } from '@/adapters/dexieStorage'
import { setCurrentOwner } from '@/app/currentOwner'
import type { Entry, Reminder } from '@/domain/types'

function makeEntry(id: string): Entry {
  return {
    id, ownerId: 'u1', createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
    parts: [{ type: 'audio', ref: 'ref1', durationSec: 3 }], status: 'ready',
  }
}

describe('syncOutbox hooks', () => {
  beforeEach(async () => {
    setCurrentOwner('u1')
    await Promise.all([db.entries.clear(), db.entryAi.clear(), db.reminders.clear(), db.syncOutbox.clear(), db.syncMedia.clear()])
  })

  it('saveEntry enqueues, repeated save dedups', async () => {
    await dexieStorage.saveEntry(makeEntry('e1'))
    await dexieStorage.saveEntry(makeEntry('e1'))
    const rows = await db.syncOutbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ownerId: 'u1', kind: 'entry', id: 'e1', tombstone: false })
  })

  it('deleteEntry enqueues entry+reminder+media tombstones', async () => {
    await dexieStorage.saveEntry(makeEntry('e1'))
    const rem: Reminder = { id: 'r1', entryId: 'e1', dueAt: '2026-08-09T00:00:00.000Z', label: 'x', status: 'pending', createdAt: '2026-08-08T00:00:00.000Z' }
    await dexieStorage.saveReminder(rem)
    await dexieStorage.deleteEntry('e1')
    const tombs = (await db.syncOutbox.toArray()).filter((r) => r.tombstone)
    const keys = tombs.map((r) => `${r.kind}:${r.id}`).sort()
    expect(keys).toEqual(['entry:e1', 'media:ref1', 'reminder:r1'])
  })

  it('trashEntry enqueues non-tombstone update', async () => {
    await dexieStorage.saveEntry(makeEntry('e1'))
    await db.syncOutbox.clear()
    await dexieStorage.trashEntry('e1')
    const rows = await db.syncOutbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].tombstone).toBe(false)
  })
})
```

（注意 `setCurrentOwner` 的真实签名看 `src/app/currentOwner.ts`；若 beforeEach 里 clear 顺序/表名有出入按 v9 schema 对齐。若 dev seed 干扰（DEV 下 ensureSeeded 灌数据），测试里先 `await db.delete()` 再重新 open 或绕开——参考既有 dexieStorage 测试的处理方式。）

- [ ] **Step 4: `npx vitest run src/app/__tests__/syncOutbox.test.ts` + `npx tsc -p tsconfig.app.json`** — Expected: 全绿。

- [ ] **Step 5: 报告 lead**

---

### Task 8: syncHttp 适配器

**Files:**
- Create: `src/adapters/syncHttp.ts`
- Modify: `src/ports/index.ts`（加 `StorageFullError`）
- Create: `src/adapters/__tests__/syncHttp.test.ts`

**Interfaces:**
- Consumes: `localSession`、`di.auth.refresh`（401 重试）、协议契约。
- Produces: `pushChanges`/`pullChanges`/`uploadMedia`/`downloadMedia`/`getSyncStatus`（Task 9 引擎消费）；`StorageFullError`（上传 403 时抛）。

- [ ] **Step 1: `src/ports/index.ts` 加错误类**（`QuotaExhaustedError` 附近）：

```ts
export class StorageFullError extends Error {
  constructor(message = '云存储空间不足，请升级套餐') {
    super(message)
    this.name = 'StorageFullError'
  }
}
```

- [ ] **Step 2: 写 `src/adapters/syncHttp.ts`**

```ts
// 云端同步 HTTP 适配器：/api/sync/* 的 fetch 封装。
// 401 → di.auth.refresh 单飞重试一次 → 再 401 抛 SessionExpiredError（与 builtinLlm.chatFetch 同型）。
import { SessionExpiredError, StorageFullError } from '@/ports'
import { di } from '@/app/di'
import { localSession } from '@/app/session'
import type { SyncChange } from '@/domain/sync'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

// 统一 authed fetch：附带 JWT；401 时 refresh 重试一次。返回原始 Response（调用方判状态）。
async function authedFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const session = localSession.get()
  if (!session) throw new SessionExpiredError()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.jwt}`, ...(init.headers ?? {}) },
  })
  if (res.status === 401 && retry) {
    let newSession
    try {
      newSession = await di.auth.refresh()
      localSession.set(newSession)
    } catch {
      localSession.clear()
      throw new SessionExpiredError()
    }
    return authedFetch(path, init, false)
  }
  return res
}

async function checkOk(res: Response, ep: string): Promise<void> {
  if (res.ok) return
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  throw new Error(body?.message ?? `${ep} HTTP ${res.status}`)
}

export async function pushChanges(
  changes: SyncChange[],
): Promise<{ applied: number; rejected: { kind: string; id: string }[] }> {
  const res = await authedFetch('/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  })
  await checkOk(res, 'push')
  return (await res.json()) as { applied: number; rejected: { kind: string; id: string }[] }
}

export async function pullChanges(
  since: number,
  limit = 200,
): Promise<{ changes: SyncChange[]; cursor: number; hasMore: boolean }> {
  const res = await authedFetch(`/api/sync/pull?since=${since}&limit=${limit}`)
  await checkOk(res, 'pull')
  return (await res.json()) as { changes: SyncChange[]; cursor: number; hasMore: boolean }
}

// PUT raw blob。403 → StorageFullError（引擎据此置 storageFull，UI 提示升级）。
export async function uploadMedia(ref: string, blob: Blob): Promise<void> {
  const res = await authedFetch(`/api/sync/media/${encodeURIComponent(ref)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  if (res.status === 403) throw new StorageFullError()
  await checkOk(res, 'media upload')
}

export async function downloadMedia(ref: string): Promise<Blob> {
  const res = await authedFetch(`/api/sync/media/${encodeURIComponent(ref)}`)
  if (res.status === 404) throw new Error(`media 不存在: ${ref}`)
  await checkOk(res, 'media download')
  return res.blob()
}

export async function getSyncStatus(): Promise<{ usedBytes: number; limitBytes: number }> {
  const res = await authedFetch('/api/sync/status')
  await checkOk(res, 'status')
  return (await res.json()) as { usedBytes: number; limitBytes: number }
}
```

- [ ] **Step 3: 写 `src/adapters/__tests__/syncHttp.test.ts`（mock fetch）**

```ts
// mock global fetch + localSession + di.auth.refresh：验证 401→refresh→重试一次；403→StorageFullError。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refreshMock = vi.fn()
vi.mock('@/app/di', () => ({ di: { auth: { refresh: (...a: unknown[]) => refreshMock(...a) } } }))
vi.mock('@/app/session', () => ({
  localSession: {
    store: { jwt: 'jwt1', refreshToken: 'rt', expiresAt: 'x' } as unknown,
    get() { return this.store },
    set(s: unknown) { this.store = s },
    clear() { this.store = null },
  },
}))

import { pullChanges, uploadMedia } from '@/adapters/syncHttp'
import { StorageFullError } from '@/ports'

describe('syncHttp', () => {
  beforeEach(() => {
    refreshMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('401 triggers single refresh retry then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('x', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ changes: [], cursor: 5, hasMore: false }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)
    refreshMock.mockResolvedValue({ jwt: 'jwt2', refreshToken: 'rt2', expiresAt: 'y' })
    const r = await pullChanges(0)
    expect(r.cursor).toBe(5)
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt2' })
  })

  it('upload 403 → StorageFullError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })))
    await expect(uploadMedia('r1', new Blob(['x']))).rejects.toBeInstanceOf(StorageFullError)
  })
})
```

- [ ] **Step 4: `npx vitest run src/adapters/__tests__/syncHttp.test.ts` + `npx tsc -p tsconfig.app.json`** — Expected: 全绿。

- [ ] **Step 5: 报告 lead**

---

### Task 9: 同步引擎 + syncStore

**Files:**
- Create: `src/app/syncStore.ts`
- Create: `src/app/syncEngine.ts`
- Create: `src/app/__tests__/syncEngine.test.ts`

**Interfaces:**
- Consumes: Task 6/7/8 全部产物 + `accountSlots.storeRehydrate`（`@/app/accountSlots`）+ `getCurrentOwner`。
- Produces: `maybeStartSync()`、`stopSync()`、`useSyncStore`（Task 10/11 消费）。

**核心逻辑（必须先懂）：**
- `flush()`：读当前 owner 的 outbox（seq 升序，≤200 条）→ 逐条现组 payload → entry 含媒体 ref 且 `db.syncMedia` 无记录 → 先 `uploadMedia` + 记 track → 齐活后 `pushChanges` → 成功删已推 outbox 行 + 清 media tombstone 的 track 行 → 有剩续批。失败（网络/5xx）保留 outbox 下轮重试；`StorageFullError` 置 syncStore.storageFull 并跳过该媒体（entry 仍推——文本先行，媒体待扩容后重传；track 未记所以下轮还会试）。
- `pull()`：循环 `pullChanges(cursor)` 直到 `hasMore=false` → 逐条 apply（直接写 `db.*`，零回声）→ 更新 `syncState 'lastPullSeq:<owner>'` → 有变更则 `accountSlots.storeRehydrate?.()` 刷 UI。
- apply 规则：
  - `entry` tombstone → 读 entry 取媒体 refs → `db.entries.delete` + `entryAi.where('entryId').equals(id).delete()` + 逐 ref `dexieStorage.deleteMedia` + `db.syncMedia.delete(ref)`。**不动 reminders**（其 tombstone 独立到达）。
  - `entry` payload（`EntryPayload`）→ `db.entries.put({...p.entry, ownerId: 当前 owner})` + `p.ai ? db.entryAi.put(p.ai) : 无操作` + 逐媒体 ref：`await dexieStorage.getMedia(ref)` 为 undefined → `downloadMedia` → `dexieStorage.saveMedia` + `db.syncMedia.put`。
  - `category`/`tag`/`reminder` tombstone → 对应表 `delete(id)`；payload → `put({...row, ownerId})`。
  - `draft` tombstone → `db.drafts.delete(id)`；payload → `db.drafts.put(row)`（草稿不分区）。
  - `media` tombstone → `dexieStorage.deleteMedia(ref)` + `db.syncMedia.delete(ref)`；payload → 本地无则下载（同上）。
- `migrate()`（首启）：syncState 无 `migrated:<owner>` → 全量入队（entries 含 trashed、categories、tags、reminders、drafts）+ 记 `migrated:<owner>='1'` + syncStore.migrating=true。进度 = 1 - 剩余 outbox/初始总数。
- 触发：outbox 回调 debounce 2s、5min interval、window `online` 事件，均汇到 `tick() = flush() → pull()`（内部单飞：跑中时新触发只置 dirty 标，跑完再补一轮）。
- 启停：`maybeStartSync()` = network 账号 && `settings.syncEnabled` && 未 start → 注册回调/interval/online listener + `migrate()` + `tick()`；`stopSync()` 清干净。

- [ ] **Step 1: 写 `src/app/syncStore.ts`**

```ts
// 同步状态（UI 只读）：引擎写入，设置页云端同步区消费。
import { create } from 'zustand'

interface SyncUiState {
  running: boolean // 引擎已启动
  syncing: boolean // 一轮 flush/pull 进行中
  lastSyncAt: string | null
  pendingCount: number // outbox 待推条数
  migrating: boolean
  migrationTotal: number
  migrationRemaining: number
  usedBytes: number
  limitBytes: number
  storageFull: boolean
  lastError: string | null
}

export const useSyncStore = create<SyncUiState>(() => ({
  running: false,
  syncing: false,
  lastSyncAt: null,
  pendingCount: 0,
  migrating: false,
  migrationTotal: 0,
  migrationRemaining: 0,
  usedBytes: 0,
  limitBytes: -1,
  storageFull: false,
  lastError: null,
}))
```

- [ ] **Step 2: 写 `src/app/syncEngine.ts`**（完整实现，按上面「核心逻辑」逐条落实；骨架如下，实现者补全函数体——每个函数的逻辑都在上文有精确描述，不得自由发挥协议）：

```ts
// 云端同步引擎：outbox flush（debounce）+ 游标 pull + 首启迁移 + 5min 兜底 + online 补传。
// 应用远端变更直接写 db.*（绕过 dexieStorage 挂钩）→ 零回声。
import { db } from '@/data/db'
import { dexieStorage } from '@/adapters/dexieStorage'
import { getCurrentOwner } from '@/app/currentOwner'
import { accountSlots } from '@/app/accountSlots'
import { useAccountStore } from '@/app/accountStore'
import { onOutboxEnqueue } from '@/app/syncOutbox'
import { useSyncStore } from '@/app/syncStore'
import {
  downloadMedia, getSyncStatus, pullChanges, pushChanges, uploadMedia,
} from '@/adapters/syncHttp'
import { SessionExpiredError, StorageFullError } from '@/ports'
import type { EntryPayload, MediaPayload, OutboxRow, SyncChange } from '@/domain/sync'
import type { Category, EntryAi, Reminder, Tag } from '@/domain/types'
```

关键实现要点（契约级，实现者逐条照做）：
- `assemblePayload(row: OutboxRow): Promise<SyncChange | null>`——tombstone → `{kind, id, updatedAt, deletedAt: updatedAt}`；否则按 kind 从活库读行（entry 附加最新 EntryAi：version 最大、平手 createdAt 最新——与 dexieStorage.getEntryAi 同则），行已不存在（如 save 后又硬删但 outbox 只剩非 tombstone 行的极端序）→ 返 null（flush 跳过并删该 outbox 行）。
- `uploadPendingMedia(payload: EntryPayload): Promise<void>`——遍历 `payload.entry.parts` 非 text part：`db.syncMedia.get(ref)` 有则跳过；`dexieStorage.getMedia(ref)` 无 blob → console.warn 跳过（媒体本地已丢，不阻塞文本同步）；有 blob → `uploadMedia` → `db.syncMedia.put({ref, uploadedAt})`。
- `flush()` 每批 ≤200；`pushChanges` 成功 → `db.syncOutbox.bulkDelete(seqs)`；media tombstone 行推送成功后 `db.syncMedia.delete(ref)`。`rejected` 仅 console.info（下轮 pull 拿胜方）。
- `pull()` 翻页循环；apply 完成后 `useSyncStore` 更新 lastSyncAt/pendingCount/usedBytes/limitBytes（`getSyncStatus()`）。
- `tick()` 单飞 + dirty 补轮；`SessionExpiredError` → `stopSync()` + lastError 置中文 message（sessionExpired UX 已由 accountStore 负责，引擎只静默停）。
- 全部异常不外抛（引擎永不让同步失败炸 UI）。

- [ ] **Step 3: 写 `src/app/__tests__/syncEngine.test.ts`**

fake-indexeddb + vi.mock('@/adapters/syncHttp')（pushChanges/pullChanges/uploadMedia/downloadMedia/getSyncStatus 全 mock）。用例：
1. **apply entry payload**：pull 返 entry change → db.entries/entryAi 有行、ownerId=当前 owner、**outbox 无回声**（`db.syncOutbox.count()===0`）。
2. **apply entry tombstone**：先有行 → tombstone → entries/entryAi 清空、reminders 行**保留**。
3. **media 下行**：pull 返 media change（payload {ref,mime,size}）且本地无 blob → downloadMedia 被调、blob 落 OPFS（或 getMedia 可读）、syncMedia 有 track。
4. **flush 组装**：saveEntry（含 audio part ref）→ tick → uploadMedia 先于 pushChanges 被调、pushChanges 收到 EntryPayload 形 payload、outbox 清空。
5. **tombstone 优先断言**（LWW 语义在服务端，这里只验证 tombstone change 形）：硬删后 flush 的 change 带 deletedAt 且无 payload。

（引擎依赖 accountStore——mock `useAccountStore.getState()` 返 `{ account: { id: 'u1', type: 'network' } }` 形；`accountSlots.storeRehydrate` 直接赋 vi.fn()。）

- [ ] **Step 4: `npx vitest run src/app/__tests__/syncEngine.test.ts` + `npx tsc -p tsconfig.app.json`** — Expected: 全绿。

- [ ] **Step 5: 报告 lead**

---

### Task 10: 设置页「云端同步」区 + i18n

**Files:**
- Modify: `src/ui/screens/settings/index.tsx`（数据区之前插「云端同步」section）
- Modify: `src/app/i18n/zh/settings.ts`、`src/app/i18n/en/settings.ts`

**Interfaces:**
- Consumes: `useSyncStore`、`maybeStartSync/stopSync`、`useAccountStore`、`useUiStore.settings.syncEnabled`。

- [ ] **Step 1: i18n 键（zh/en 同步加）**

```ts
'settings.cloudSync': '云端同步',
'settings.cloudSyncOff': '关闭中——数据仅保存在本机',
'settings.cloudSyncOn': '自动同步：保存即推 · 打开即拉 · 每 5 分钟兜底',
'settings.syncLastAt': '上次同步 {time}',
'settings.syncNever': '尚未同步',
'settings.syncPending': '待上传 {count} 条',
'settings.syncStorage': '云存储 {used} / {limit}',
'settings.syncStorageUnlimited': '云存储 {used}（不限量）',
'settings.syncMigrating': '首次同步中 {done}/{total}…',
'settings.syncStorageFull': '云存储已满，升级套餐后继续同步媒体',
'settings.syncRequireNetwork': '需先升级为网络账号',
'settings.syncError': '同步异常：{msg}',
```

en 镜像（直译）。

- [ ] **Step 2: settings/index.tsx 加 section**

位置：「数据」section 之前。结构（对齐现有 section 的 class 风格）：
- 区标题 `settings.cloudSync`。
- toggle 行：label + 副标题（开=cloudSyncOn / 关=cloudSyncOff）；guest → disabled + `syncRequireNetwork` 副标题。toggle 切换：`setSettings({...settings, syncEnabled: v})`；v=true → `void maybeStartSync()`，false → `stopSync()`。
- 状态行（仅 syncEnabled && network 显示）：
  - `migrating` → `syncMigrating`（done=total-remaining）+ 细进度条（div 宽度百分比，bg-pri）。
  - 否则：`syncLastAt`（lastSyncAt 格式化 HH:mm，无则 syncNever）+ 右侧 `syncPending`（pendingCount>0 才显）。
  - 存储行：`limitBytes<0` → syncStorageUnlimited 否则 syncStorage（格式 MB 一位小数）。
  - `storageFull` → catFail 色 syncStorageFull。
  - `lastError` → catFail 色 syncError。
- 打开设置页时（useEffect）若 syncEnabled 且 network：`void getSyncStatus().then(...)` 刷新 used/limit（引擎 tick 也会刷，这里兜底首显）。

MB 格式化 helper 放本文件（`formatMb(bytes)` 已有类似——settings/index.tsx 内有 `formatMB`（下载进度用），直接复用，注意大小写）。

- [ ] **Step 3: `npx tsc -p tsconfig.app.json`** + 手动预览确认渲染（`npm run dev` 打开 /settings 截图自查）。

- [ ] **Step 4: 报告 lead**

---

### Task 11: boot/login/logout 接线 + 全链路 e2e

**Files:**
- Modify: `src/main.tsx`（boot 启动引擎）
- Modify: `src/app/accountStore.ts`（postNetworkLogin 启、logout 停）

**Interfaces:**
- Consumes: Task 9 的 `maybeStartSync`/`stopSync`。

- [ ] **Step 1: main.tsx**

import 加 `import { maybeStartSync } from '@/app/syncEngine'`；`useUiStore.getState().hydrate()` 的 `.finally` 链之后（settings 已落才能判 syncEnabled）加：

```ts
// 云端同步：network 账号且开关开 → 启动引擎（首启自动迁移）。guest/关 → no-op。
void maybeStartSync()
```

注意时序：maybeStartSync 需在 uiStore hydrate 完成后执行——放进同一个 `.finally(() => { useUiStore.getState().hydrate().finally(() => void maybeStartSync()) })` 或改为 async 链，实施者按现有链式结构接好（要点：syncEnabled 读自 Dexie settings，必须 hydrate 后读）。

- [ ] **Step 2: accountStore.ts**

import 加 `import { maybeStartSync, stopSync } from '@/app/syncEngine'`。
- `postNetworkLogin()` 末尾加 `void maybeStartSync()`。
- `logout()` 里加 `stopSync()`。

（注意成环风险：syncEngine import accountStore——accountStore 再 import syncEngine 成环。解法：syncEngine 不 import accountStore，改从 `accountSlots` 读账号（accountSlots 加 `getAccountId: () => string | null` 槽，accountStore hydrate/login 时维护）；或 accountStore 侧用槽注册 `onAccountChange`。实施者选槽模式落地——参照既有 registerStoreRehydrate/registerQuotaReset 同文件模式。**syncEngine.ts 里 `import { useAccountStore }` 必须换掉**，Task 9 若已引入环在此一并修。）

- [ ] **Step 3: 全链路 e2e（lead 或 reviewer 执行，chrome-devtools 双上下文 390×844）**

```bash
cd server && npm run dev   # 8787
VITE_AIJI_BACKEND=http VITE_AIJI_BACKEND_BASE=http://localhost:8787 npm run build && npm run preview -- --port 4173
```

用 chrome-devtools 开**两个隔离上下文**（isolatedContext A / B）模拟双设备，同一测试账号：
1. A 注册网络账号 → 设置开云端同步 → 迁移跑完（pendingCount=0）。
2. A 记一条文本条目 → 等 ~3s（debounce+push）。
3. B 登录同账号 → 开同步 → pull → 首页/搜索可见该条目（零手动刷新之外的干预）。
4. A 删除该条目（进回收站）→ B pull 后条目进回收站（条目 payload 带 deletedAt，listEntries 过滤）。
5. A 回收站永久删除 → B pull 后彻底消失（tombstone）。
6. A 离线（context setOffline）记一条 → 上线 → 自动补传 → B 拉到。
7. 媒体：A 用 `page.evaluate` 经 `dexieStorage.saveMedia('refX', new Blob(['fake']))` + 构造含 audio part 的 entry 走 capture 保存 → B pull 后 `getMedia('refX')` 可读且字节一致。
8. 断开后端 → A 改条目 → push 失败 outbox 滞留 → 恢复后端 → 下轮自动补传。

每步截图存 `.e2e_shots/phase2-*.png`。

- [ ] **Step 4: `npm run build` 通过 + 前端 vitest 全绿 + 服务端 sync-test.sh 全绿（本机 + 部署后 prod 各一遍）**

- [ ] **Step 5: 报告 lead**

---

## Self-Review 记录（lead 写计划时已核）

- **Spec 覆盖**：§3.1 开关→T10+T11；§3.2 表→T1（合并为 sync_rows，偏离已批准）；§3.3 push/pull/LWW/tombstone/离线/首启迁移→T2-T4+T7-T9；§3.4 配额→T1+T4（storageLimitBytes）+T10 显示；§3.5 注销级联→T5、BYOK/聚合不同步→T7 不挂钩清单；§3.6 验收→T11 e2e。SQLite 备份 cron（§3.4 末）→ 部署后人工加 crontab，不在代码任务内。
- **类型一致性**：`SyncChange/EntryPayload/MediaPayload/OutboxRow` 在 T6 定义，T2/T3（服务端镜像在 T1 types.ts）/T8/T9 引用同一组名；`storageLimitBytes` 贯穿 T1→T4→T8→T10。
- **回声防护**：引擎 apply 走 `db.*` 直写，dexieStorage 挂钩不入引擎路径——T7/T9 已互核。
- **Hono 顺序**：T2 Step 2 显式要求 use 在 route 前。
