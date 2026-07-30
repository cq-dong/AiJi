# 账号中心 + 兑换码付费 + STT 掩盖修复（Phase 1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec Phase 1——账号中心（账号信息/修改密码/注销账号）+ 兑换码付费（真落库）+ 修 upgrade stub 不落库 + 修 STT 失败被「无文本」掩盖。

**Architecture:** 后端（Hono+better-sqlite3）加 redeem/change-password/account-delete 三端点 + redeem 双表 + CLI 发码；前端（React+TS）扩 AuthPort/PlanPort 端口与 http 适配、accountStore 动作、AccountSection 改版。升级/兑换均真写 `users` 表 → `resolveLimits` 见付费 → 无限额度生效。

**Tech Stack:** Hono, better-sqlite3, bcryptjs, React 19 + TS strict + Tailwind v3 + Zustand。

## Global Constraints

- 错误契约：后端返 HTTP status + body `{error:'AUTH_<CODE>', message:'<中文>'}`（`errorJson`）。前端 `parseAuthError` 重组 `Error('AUTH_<CODE>:<中文>')`。
- 后端 `bcryptjs` ROUNDS=12；`validatePassword` = `pw.length >= 8`；`validateEmail` 见 `server/src/lib/password.ts`。
- 前端 TS 严格：`verbatimModuleSyntax`（类型 import 必须 `import type`）、`erasableSyntaxOnly`（禁 enum/namespace/构造参数属性）、`noUnusedLocals/Parameters`。
- 自检命令（子代理用）：`npx tsc -p tsconfig.app.json`（**不要** `npm run typecheck`/`tsc -b`，并发写共享 tsbuildinfo 竞态）。后端 `cd server && npx tsc --noEmit`。
- i18n：zh 文件 `as const` 定义 I18nKey；en 文件 `Record<I18nKey,string>` 必须含全部相同 key（缺则 typecheck 挂）。新增 key 必须 zh+en 同步加。
- `Account` 类型前端 `src/domain/account.ts`、后端镜像 `server/src/types.ts`，字段一致。
- 测试栈：后端 curl（`scripts/curl-test.sh` 模式）+ 前端 chrome-devtools-mcp / Playwright（视口 390×844）。
- 密钥纪律：`server/.env` 不 commit、不打印；BYOK key 留设备。

---

## Task 1: 后端 redeem 双表 + `/api/plan/redeem` + 修 `/api/plan/upgrade` 真落库

**Files:**
- Modify: `server/src/db/index.ts`（加 redeem_codes/redeem_logs 表 + Row 类型）
- Modify: `server/src/routes/plan.ts`（全文重写）
- Modify: `server/src/index.ts:40`（redeem 挂 authMiddleware）

**Interfaces:**
- Consumes: `getDb()`, `UserRow`（`server/src/db/index.ts`）; `PLAN_TIERS`, `Account`（`server/src/types.ts`）; `errorJson`（`server/src/lib/http.ts`）; `authMiddleware`（`server/src/middleware/auth.ts`）。
- Produces: `POST /api/plan/redeem {code} → {account: Account}`（鉴权）；`POST /api/plan/upgrade {planId} → {orderId, paidPlanId, paidExpiresAt, payUrl?, account: Account}`（鉴权，**现含 account**）。前端 `httpPlan.redeem`/`upgrade` 依赖。

- [ ] **Step 1: DB schema + Row 类型**

`server/src/db/index.ts`：在 `db.exec(` 的模板串内 `quotas` 表之后追加两表：

```sql
    CREATE TABLE IF NOT EXISTS redeem_codes (
      code TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS redeem_logs (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redeemed_at TEXT NOT NULL
    );
```

并在文件底部 `QuotaRow` 之后追加：

```ts
export interface RedeemCodeRow {
  code: string
  plan_id: string
  duration_days: number
  max_uses: number
  used_count: number
  expires_at: string | null
  note: string | null
  created_at: string
}

export interface RedeemLogRow {
  id: string
  code: string
  user_id: string
  redeemed_at: string
}
```

- [ ] **Step 2: 重写 `server/src/routes/plan.ts` 全文**

```ts
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
```

- [ ] **Step 3: 挂 auth 中间件**

`server/src/index.ts`：在 `app.use('/api/plan/upgrade', authMiddleware)`（现 line 40）后加一行：

```ts
app.use('/api/plan/redeem', authMiddleware)
```

- [ ] **Step 4: 本机 curl 验证**

```bash
cd server && npm run build && node -e "console.log('build ok')"
# 起服务后（或复用已跑服务）：
EMAIL="redeemtest@example.com"; PW="probe12345"
JWT=$(curl -s -X POST http://localhost:8787/api/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["session"]["jwt"])')
# 手插一个码（server 目录下，cwd 决定 data/aiji.db）：
node -e "const D=require('better-sqlite3');const db=new D('data/aiji.db');db.exec(\"CREATE TABLE IF NOT EXISTS redeem_codes(code TEXT PRIMARY KEY,plan_id TEXT NOT NULL,duration_days INTEGER NOT NULL,max_uses INTEGER NOT NULL DEFAULT 1,used_count INTEGER NOT NULL DEFAULT 0,expires_at TEXT,note TEXT,created_at TEXT NOT NULL)\");db.prepare(\"INSERT OR REPLACE INTO redeem_codes(code,plan_id,duration_days,max_uses,used_count,created_at) VALUES('AIJI-TEST-AAAA-BBBB','yearly',365,1,0,'2026-07-29T00:00:00.000Z')\").run();console.log('code inserted')"
# 兑换 → 应返 account.plan='paid' + paidExpiresAt 一年后
curl -s -X POST http://localhost:8787/api/plan/redeem -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"code":"AIJI-TEST-AAAA-BBBB"}'
# 复用同码 → 应 409 已用尽
curl -s -X POST http://localhost:8787/api/plan/redeem -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"code":"AIJI-TEST-AAAA-BBBB"}'
# 无效码 → 404
curl -s -X POST http://localhost:8787/api/plan/redeem -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"code":"NOPE"}'
# upgrade → 应返 account.plan='paid'
curl -s -X POST http://localhost:8787/api/plan/upgrade -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"planId":"monthly"}'
```
Expected: redeem 返 `{account:{...plan:'paid',paidPlanId:'yearly',paidExpiresAt:+1年...}}`；复用 409；无效 404；upgrade 返 `account.plan='paid'`。

- [ ] **Step 5: 后端 typecheck + commit**

```bash
cd server && npx tsc --noEmit && cd ..
git add server/src/db/index.ts server/src/routes/plan.ts server/src/index.ts
git commit -m "feat(server): 兑换码 redeem 真落库 + 修 upgrade stub 不落库"
```

---

## Task 2: 后端 CLI 发码脚本 `gen-redeem-code.mjs`

**Files:**
- Create: `server/scripts/gen-redeem-code.mjs`

**Interfaces:**
- Consumes: `better-sqlite3`（server 已装）; `redeem_codes` 表（Task 1）。
- Produces: 管理员 `cd server && node scripts/gen-redeem-code.mjs --plan=yearly --count=10 --note=内测群A` 生成并打印码。

- [ ] **Step 1: 写脚本**

```js
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { resolve } from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
  }),
)
const planId = String(args.plan || 'yearly')
const count = Number(args.count || 1)
const maxUses = Number(args['max-uses'] || 1)
const expiresDays = args['expires-days'] ? Number(args['expires-days']) : null
const note = String(args.note || '')

const DURATION = { monthly: 30, yearly: 365 }
if (!(planId in DURATION)) {
  console.error(`--plan must be monthly|yearly, got ${planId}`)
  process.exit(1)
}

// cwd=server（DB 同 db/index.ts 的 resolve(process.cwd(),'data/aiji.db')）。
const db = new Database(resolve(process.cwd(), 'data/aiji.db'))
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS redeem_codes (
    code TEXT PRIMARY KEY, plan_id TEXT NOT NULL, duration_days INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1, used_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT, note TEXT, created_at TEXT NOT NULL
  );
`)

function genCode() {
  const seg = () => randomBytes(2).toString('hex').toUpperCase()
  return `AIJI-${seg()}-${seg()}-${seg()}`
}

const now = new Date().toISOString()
const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 86400_000).toISOString() : null
const insert = db.prepare(
  `INSERT INTO redeem_codes (code, plan_id, duration_days, max_uses, used_count, expires_at, note, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
)
const codes = []
for (let i = 0; i < count; i++) {
  const code = genCode()
  insert.run(code, planId, DURATION[planId], maxUses, expiresAt, note, now)
  codes.push(code)
}
console.log(`生成 ${count} 个 ${planId} 兑换码（${DURATION[planId]} 天, 单码 ${maxUses} 次${expiresAt ? ', 码有效期至 ' + expiresAt : ''}）:`)
codes.forEach((c) => console.log('  ' + c))
```

- [ ] **Step 2: 验证**

```bash
cd server && node scripts/gen-redeem-code.mjs --plan=yearly --count=3 --note=测试
node -e "const D=require('better-sqlite3');console.log(new D('data/aiji.db').prepare('SELECT code,plan_id,max_uses FROM redeem_codes ORDER BY created_at DESC LIMIT 3').all())"
```
Expected: 打印 3 个 `AIJI-XXXX-XXXX-XXXX`；DB 查到 3 行。

- [ ] **Step 3: commit**

```bash
git add server/scripts/gen-redeem-code.mjs
git commit -m "feat(server): CLI 发兑换码脚本（interim 管理员发放）"
```

---

## Task 3: 后端 `/api/auth/change-password`

**Files:**
- Modify: `server/src/routes/auth.ts`（logout 之前插入 change-password 路由）
- Modify: `server/src/index.ts:40`（change-password 挂 authMiddleware）

**Interfaces:**
- Consumes: `verifyPassword`, `hashPassword`, `validatePassword`（`server/src/lib/password.ts`）; `revokeAllUserTokens`（`server/src/lib/refresh.ts`）; `getDb`, `UserRow`。
- Produces: `POST /api/auth/change-password {oldPassword, newPassword} → {ok:true}`（鉴权）。前端 `httpAuth.changePassword` 依赖。

- [ ] **Step 1: 加路由**

`server/src/routes/auth.ts`：在 `// 登出` 注释之前插入：

```ts
// 修改密码：校验旧密码 → 换 hash → 作废全部 refresh token（强制各端重登）。
auth.post('/change-password', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as { oldPassword?: string; newPassword?: string } | null
  if (!body?.oldPassword || !body?.newPassword) return errorJson(c, 400, 'AUTH_400', '旧密码和新密码必填')
  if (!validatePassword(body.newPassword)) return errorJson(c, 400, 'AUTH_400', '新密码至少 8 位')
  const db = getDb()
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined
  if (!row) return errorJson(c, 401, 'AUTH_401', '账号不存在')
  const ok = await verifyPassword(body.oldPassword, row.password_hash)
  if (!ok) return errorJson(c, 401, 'AUTH_401', '旧密码错误')
  const hash = await hashPassword(body.newPassword)
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, userId)
  revokeAllUserTokens(userId)
  return c.json({ ok: true })
})
```

- [ ] **Step 2: 挂 auth 中间件**

`server/src/index.ts`：在 `app.use('/api/plan/redeem', authMiddleware)` 后加：

```ts
app.use('/api/auth/change-password', authMiddleware)
```

- [ ] **Step 3: curl 验证**

```bash
# 复用 Task 1 的 $EMAIL/$PW（JWT 已在 redeem/refresh 轮换后需重取——refresh 换 token，直接用 register 拿的初 token 可能已因 Task 1 的 refresh 失效；重新 login 取新 JWT）：
JWT=$(curl -s -X POST http://localhost:8787/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["session"]["jwt"])')
# 改密 → ok；随后用新密码 login 应成功、旧密码应 401
curl -s -X POST http://localhost:8787/api/auth/change-password -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "{\"oldPassword\":\"$PW\",\"newPassword\":\"newpass999\"}"
curl -s -X POST http://localhost:8787/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"newpass999\"}" | head -c 120; echo
curl -s -X POST http://localhost:8787/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | head -c 120; echo
# 错旧密码 → 401
curl -s -X POST http://localhost:8787/api/auth/change-password -H "Authorization: Bearer $(curl -s -X POST http://localhost:8787/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"newpass999\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["session"]["jwt"])')" -H 'Content-Type: application/json' -d '{"oldPassword":"WRONG","newPassword":"whatever99"}'
```
Expected: 改密 `{ok:true}`；新密码 login 成功、旧密码 `AUTH_401`；错旧密码改密 `AUTH_401 旧密码错误`。

- [ ] **Step 4: typecheck + commit**

```bash
cd server && npx tsc --noEmit && cd ..
git add server/src/routes/auth.ts server/src/index.ts
git commit -m "feat(server): /api/auth/change-password（改后作废全部 refresh token）"
```

---

## Task 4: 后端 `/api/account/delete`（注销账号）

**Files:**
- Create: `server/src/routes/account.ts`
- Modify: `server/src/index.ts`（import + `app.use('/api/account/*', authMiddleware)` + `app.route('/api/account', accountRoutes)`）

**Interfaces:**
- Consumes: `verifyPassword`（password.ts）; `getDb`, `UserRow`; `errorJson`; `authMiddleware`。
- Produces: `POST /api/account/delete {password} → {ok:true}`（鉴权）。前端 `httpAuth.deleteAccount` 依赖。

- [ ] **Step 1: 写路由**

`server/src/routes/account.ts`：

```ts
import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { getDb, type UserRow } from '../db/index.js'
import { verifyPassword } from '../lib/password.js'
import { errorJson } from '../lib/http.js'

const account = new Hono<AppEnv>()

// 注销账号：二次确认密码 → 硬删 users + refresh_tokens + quotas + redeem_logs。
// （refresh_tokens 有 ON DELETE CASCADE，但显式删更稳；Phase 2 同步表上线后在此一并删。）
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
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId)
  })()
  return c.json({ ok: true })
})

export default account
```

- [ ] **Step 2: 挂载**

`server/src/index.ts`：import 区加 `import accountRoutes from './routes/account.js'`；auth 区加 `app.use('/api/account/*', authMiddleware)`；route 区加 `app.route('/api/account', accountRoutes)`。

- [ ] **Step 3: curl 验证**

```bash
# 新注册一个号（避免误删测试号）：
EMAIL2="deletetest@example.com"; PW2="probe12345"
R=$(curl -s -X POST http://localhost:8787/api/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL2\",\"password\":\"$PW2\"}")
JWT2=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["session"]["jwt"])')
# 错密码 → 401；对密码 → ok；之后 login 该号应 401（账号已删）
curl -s -X POST http://localhost:8787/api/account/delete -H "Authorization: Bearer $JWT2" -H 'Content-Type: application/json' -d '{"password":"WRONG"}'
curl -s -X POST http://localhost:8787/api/account/delete -H "Authorization: Bearer $JWT2" -H 'Content-Type: application/json' -d "{\"password\":\"$PW2\"}"
curl -s -X POST http://localhost:8787/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL2\",\"password\":\"$PW2\"}"
```
Expected: 错密码 `AUTH_401 密码错误`；对密码 `{ok:true}`；login 返 `AUTH_401 邮箱或密码错误`（号已删）。

- [ ] **Step 4: typecheck + commit**

```bash
cd server && npx tsc --noEmit && cd ..
git add server/src/routes/account.ts server/src/index.ts
git commit -m "feat(server): /api/account/delete（注销账号，硬删账号+token+quota）"
```

---

## Task 5: 前端端口 + 适配（AuthPort/PlanPort + http + mock stub）

**Files:**
- Modify: `src/ports/index.ts`（AuthPort 加 changePassword/deleteAccount；PlanPort 加 redeem、upgrade 返 account）
- Modify: `src/adapters/httpAuth.ts`（加 changePassword/deleteAccount）
- Modify: `src/adapters/httpPlan.ts`（加 redeem + import Account）
- Modify: `src/adapters/mockAuth.ts`（stub changePassword/deleteAccount）
- Modify: `src/adapters/mockPlan.ts`（stub redeem）

**Interfaces:**
- Consumes: `Account`（`src/domain/account.ts`）; `localSession`（`@/app/session`）; `NotNetworkError`（`@/ports`）。
- Produces: `AuthPort.changePassword/deleteAccount`, `PlanPort.redeem`——Task 6 accountStore 依赖。`PlanPort.upgrade` 现可含 `account?: Account`。

- [ ] **Step 1: `src/ports/index.ts` 改两个接口**

`AuthPort` 块（logout 后）加：

```ts
  // 修改密码（网络账号）。成功后后端作废全部 refresh token → 前端清 session 重登。
  changePassword(oldPassword: string, newPassword: string): Promise<void>
  // 注销账号（二次确认密码）。成功后前端清本地全部数据。
  deleteAccount(password: string): Promise<void>
```

`PlanPort` 块改为：

```ts
export interface PlanPort {
  getPlans(): Promise<PlanTier[]>
  upgrade(planId: string): Promise<{
    orderId: string
    paidPlanId: string
    paidExpiresAt: string
    payUrl?: string
    // 后端现真落库并返 account（Phase 1 §2.4）；旧 stub 响应无此字段 → 前端回落手拼。
    account?: Account
  }>
  // 兑换码激活付费档。返更新后 account（含 plan/paidPlanId/paidExpiresAt），前端覆盖本地。
  redeem(code: string): Promise<{ account: Account }>
}
```

- [ ] **Step 2: `httpAuth.ts` 加两方法**（logout 之前插入；`localSession`/`parseBody`/`parseAuthError`/`NotNetworkError` 已在文件内）：

```ts
  async changePassword(oldPassword, newPassword) {
    const session = localSession.get()
    let res: Response
    try {
      res = await fetch(`${BASE}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.jwt ?? ''}` },
        body: JSON.stringify({ oldPassword, newPassword }),
      })
    } catch {
      throw new NotNetworkError('网络不可用')
    }
    const body = await parseBody(res)
    if (!res.ok) throw parseAuthError(body, res.status)
  },

  async deleteAccount(password) {
    const session = localSession.get()
    let res: Response
    try {
      res = await fetch(`${BASE}/api/account/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.jwt ?? ''}` },
        body: JSON.stringify({ password }),
      })
    } catch {
      throw new NotNetworkError('网络不可用')
    }
    const body = await parseBody(res)
    if (!res.ok) throw parseAuthError(body, res.status)
  },
```

- [ ] **Step 3: `httpPlan.ts` 加 redeem + import Account**

顶部 import 行加 `import type { Account } from '@/domain/account'`；`upgrade` 之后加：

```ts
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
      const t = await res.text().catch(() => '')
      throw new Error(`redeem HTTP ${res.status}: ${t.slice(0, 120)}`)
    }
    return (await res.json()) as { account: Account }
  },
```

- [ ] **Step 4: mock stub**

`src/adapters/mockAuth.ts`：`AuthPort` 实现对象内加

```ts
  async changePassword() { throw new NotNetworkError('需网络账号') },
  async deleteAccount() { throw new NotNetworkError('需网络账号') },
```

`src/adapters/mockPlan.ts`：`PlanPort` 实现对象内加

```ts
  async redeem() { throw new NotNetworkError('需网络账号') },
```

- [ ] **Step 5: typecheck + commit**

```bash
npx tsc -p tsconfig.app.json
git add src/ports/index.ts src/adapters/httpAuth.ts src/adapters/httpPlan.ts src/adapters/mockAuth.ts src/adapters/mockPlan.ts
git commit -m "feat(ports): AuthPort+PlanPort 扩 changePassword/deleteAccount/redeem + http/mock 适配"
```

---

## Task 6: accountStore 动作 + 修 upgradePlan 用返回 account

**Files:**
- Modify: `src/app/accountStore.ts`（AccountState 接口 + impl）

**Interfaces:**
- Consumes: `di.auth.changePassword/deleteAccount`（Task 5）; `di.plan.redeem/upgrade`（Task 5）; `localAccount`（`@/adapters/localAccount`）; `db`（`@/data/db`）; `Account`（`@/domain/account`）。
- Produces: `useAccountStore.changePassword/deleteAccount/redeemCode`——Task 8 UI 依赖。

- [ ] **Step 1: AccountState 接口加三行**（`upgradePlan` 行后）：

```ts
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
  deleteAccount: (password: string) => Promise<void>
  redeemCode: (code: string) => Promise<void>
```

- [ ] **Step 2: import db**（文件顶部 import 区加）：

```ts
import { db } from '@/data/db'
```

- [ ] **Step 3: 修 `upgradePlan`**（改为优先用后端返回 account，保证本地=后端）：

```ts
  upgradePlan: async (planId) => {
    const r = await di.plan.upgrade(planId)
    const cur = get().account
    if (!cur) return
    // 后端现真落库并返 account（§2.4）：优先用，保证本地=后端；旧 stub 响应无 account → 手拼。
    const next: Account = r.account ?? { ...cur, plan: 'paid', paidPlanId: r.paidPlanId, paidExpiresAt: r.paidExpiresAt }
    localAccount.set(next)
    set({ account: next })
  },
```

- [ ] **Step 4: 加三动作**（`upgradePlan` 之后、`clearSession` 之前插入）：

```ts
  changePassword: async (oldPassword, newPassword) => {
    await di.auth.changePassword(oldPassword, newPassword)
    // 后端已作废全部 refresh token（含本机）→ 清 session，UI 跳登录页。
    get().clearSession()
  },
  deleteAccount: async (password) => {
    await di.auth.deleteAccount(password)
    // 后端已硬删账号+数据。本地全清：localStorage + 整个 IndexedDB（db.delete 删全库）+ logout。
    localStorage.clear()
    await db.delete().catch((e) => console.error('[accountStore] db.delete failed', e))
    get().logout()
  },
  redeemCode: async (code) => {
    const r = await di.plan.redeem(code)
    localAccount.set(r.account)
    set({ account: r.account })
    // quota refresh 由 UI 层调 useQuotaStore.getState().refresh()
  },
```

> 注：`deleteAccount` 调 `logout()` 在 `db.delete()` 之后——logout 的 `triggerStoreRehydrate` 会重读已被删空的库（空态），owner 回 'local'。OPFS 媒体文件不在 db.delete 范围（独立 OPFS 目录），留作 Phase 1 后 best-effort 清理（删号低频，浏览器会按存储压力回收），本计划不强求。

- [ ] **Step 5: typecheck + commit**

```bash
npx tsc -p tsconfig.app.json
git add src/app/accountStore.ts
git commit -m "feat(account): changePassword/deleteAccount/redeemCode 动作 + upgradePlan 用返回 account"
```

---

## Task 7: §4 修 STT 失败被「无文本」掩盖（processEntry）

**Files:**
- Modify: `src/app/store.ts`（processEntry 的 STT 块，line ~566-600）

**Interfaces:**
- Consumes: 现 processEntry STT 块（per-part try/catch 吞错）。
- Produces: classify 因「无文本」失败且存在 STT 失败且无回退文本的 part 时，`processError` 用 STT 原始错误而非 classify「无文本」。

- [ ] **Step 1: STT 块记录失败原因**

`src/app/store.ts` processEntry：把 per-part STT 的 catch 收集失败原因，并在 classify 抛「无文本」时顶用。改法（在原 STT 块周围）：

将原：
```ts
            fresh.parts.map(async (p) => {
              if (p.type !== 'audio' && p.type !== 'video') return p
              if (!isFresh && p.transcript) return p
              try {
                const text = await di.stt.transcribe(p.ref)
                if (!text) return p
                changed = true
                return { ...p, transcript: text }
              } catch (e) {
                console.error('[store] stt failed for ' + p.ref, e)
                return p
              }
            }),
```
改为：
```ts
            fresh.parts.map(async (p) => {
              if (p.type !== 'audio' && p.type !== 'video') return p
              if (!isFresh && p.transcript) return p
              try {
                const text = await di.stt.transcribe(p.ref)
                if (!text) { sttFailedError = sttFailedError ?? 'STT 转写为空'; return p }
                changed = true
                return { ...p, transcript: text }
              } catch (e) {
                console.error('[store] stt failed for ' + p.ref, e)
                sttFailedError = sttFailedError ?? (e instanceof Error ? e.message : String(e))
                return p
              }
            }),
```
并在 STT 块之前声明 `let sttFailedError: string | undefined`。

- [ ] **Step 2: classify 失败时顶用 STT 错误**

把外层 catch（line ~634）改为：

```ts
    } catch (e) {
      console.error('[store] processEntry failed', e)
      const entry = await di.storage.getEntry(entryId)
      if (entry) {
        let errMsg = e instanceof Error ? e.message : String(e)
        // §4：classify 抛「无文本」（含音频 part 但转写为空），若 STT 此前失败且无回退文本，
        // 真实原因是 STT（额度/转码/超时）而非「无文本」——用 STT 原始错误，不再误导。
        if (sttFailedError && /无文本|empty|无可用/.test(errMsg)) errMsg = sttFailedError
        const updated: Entry = { ...entry, status: 'failed', processError: errMsg, updatedAt: new Date().toISOString() }
        await di.storage.saveEntry(updated)
        set((s) => ({ entries: s.entries.map((x) => (x.id === entryId ? updated : x)) }))
      }
    }
```

- [ ] **Step 3: typecheck + commit**

```bash
npx tsc -p tsconfig.app.json
git add src/app/store.ts
git commit -m "fix(ai): STT 失败被「无文本」掩盖——失败原因透传为 processError"
```

---

## Task 8: AccountSection 改版 + PlansSheet 兑换码 + i18n

**Files:**
- Modify: `src/ui/screens/settings/AccountSection.tsx`（账号信息块 + 修改密码 sheet + 注销账号 sheet + 兑换码入口）
- Modify: `src/ui/screens/settings/PlansSheet.tsx`（兑换码输入）
- Modify: `src/app/i18n/zh/settings.ts`（新 key）
- Modify: `src/app/i18n/en/settings.ts`（同 key 英文）

**Interfaces:**
- Consumes: `useAccountStore.changePassword/deleteAccount/redeemCode`（Task 6）; `useQuotaStore.refresh`; 现有 `Sheet/Button/Card/cn`、`localizeError`、`useT`。
- Produces: 账号中心新版 UI（账号信息/修改密码/注销账号/兑换码）。

- [ ] **Step 1: i18n zh**（`src/app/i18n/zh/settings.ts` 账号区末尾加）：

```ts
  // 账号信息 / 修改密码 / 注销 / 兑换码（2026-07-29 账号中心）
  'settings.accountInfo': '账号信息',
  'settings.registeredAt': '注册 {date}',
  'settings.changePassword': '修改密码',
  'settings.oldPasswordLabel': '旧密码',
  'settings.newPasswordLabel': '新密码',
  'settings.changePasswordSuccess': '密码已修改，请重新登录',
  'settings.deleteAccount': '注销账号',
  'settings.deleteAccountWarn': '注销后账号与全部数据将被永久删除，不可恢复。请输入密码确认。',
  'settings.deleteAccountConfirm': '确认注销',
  'settings.redeemCode': '输入兑换码',
  'settings.redeemCodePlaceholder': 'AIJI-XXXX-XXXX-XXXX',
  'settings.redeemSuccess': '已激活{plan}，至 {date}',
```

- [ ] **Step 2: i18n en**（`src/app/i18n/en/settings.ts` 同位置加同 key 英文）：

```ts
  'settings.accountInfo': 'Account info',
  'settings.registeredAt': 'Joined {date}',
  'settings.changePassword': 'Change password',
  'settings.oldPasswordLabel': 'Current password',
  'settings.newPasswordLabel': 'New password',
  'settings.changePasswordSuccess': 'Password changed. Please sign in again',
  'settings.deleteAccount': 'Delete account',
  'settings.deleteAccountWarn': 'Deleting your account permanently removes the account and all data. Enter your password to confirm.',
  'settings.deleteAccountConfirm': 'Delete permanently',
  'settings.redeemCode': 'Enter redemption code',
  'settings.redeemCodePlaceholder': 'AIJI-XXXX-XXXX-XXXX',
  'settings.redeemSuccess': '{plan} activated until {date}',
```

- [ ] **Step 3: AccountSection 加账号信息行**

在 `planLabel` 下方区域（头像/昵称卡内，昵称按钮的徽章行之下）加一行账号信息（邮箱脱敏 + 注册时间），并加「修改密码」「注销账号」「输入兑换码」三个入口行 + 对应 sheet。邮箱脱敏 helper：

```ts
function maskEmail(email?: string): string {
  if (!email) return ''
  const [u, d] = email.split('@')
  return `${u.slice(0, 1)}••••@${d ?? ''}`
}
```

在 `{/* 退出登录 */}` 按钮之前插入三个入口行（复用现有行样式 `flex w-full items-center justify-between rounded-btn py-1 …` + `ChevronRight`）：

```tsx
      {/* 账号信息：邮箱（脱敏）+ 注册时间。仅 network 账号有邮箱。 */}
      {account.email && (
        <div className="mt-1 flex w-full items-center justify-between rounded-btn py-1">
          <span className="text-[13px] text-ink">{maskEmail(account.email)}</span>
          <span className="text-[11px] text-t3">
            {t('settings.registeredAt', { date: account.createdAt.slice(0, 10) })}
          </span>
        </div>
      )}

      {/* 输入兑换码（仅 network） */}
      {!isGuest && (
        <button type="button" onClick={() => setRedeemOpen(true)} className="mt-1 flex w-full items-center justify-between rounded-btn py-1 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
          <span className="text-[13px] text-ink">{t('settings.redeemCode')}</span>
          <ChevronRight size={18} className="text-t2" />
        </button>
      )}

      {/* 修改密码（仅 network） */}
      {!isGuest && (
        <button type="button" onClick={() => setPwOpen(true)} className="mt-1 flex w-full items-center justify-between rounded-btn py-1 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
          <span className="text-[13px] text-ink">{t('settings.changePassword')}</span>
          <ChevronRight size={18} className="text-t2" />
        </button>
      )}

      {/* 注销账号（仅 network），catFail 警示 */}
      {!isGuest && (
        <button type="button" onClick={() => setDelOpen(true)} className="mt-1 flex w-full items-center justify-between rounded-btn py-1 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
          <span className="text-[13px] text-catFail">{t('settings.deleteAccount')}</span>
          <ChevronRight size={18} className="text-t2" />
        </button>
      )}
```

并在 `const [bindOpen, setBindOpen] = useState(false)` 附近加 state：
```ts
  const [pwOpen, setPwOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [redeemOpen, setRedeemOpen] = useState(false)
```

- [ ] **Step 4: 三个 sheet（在 NicknameSheet 之后、export 之前插入）**

```tsx
function ChangePasswordSheet({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const changePassword = useAccountStore((s) => s.changePassword)
  const t = useT()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputCls = 'h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/15 focus-visible:ring-offset-2 focus-visible:ring-offset-card'
  async function onSubmit() {
    setError(null)
    if (newPw.length < 8) { setError(t('settings.errPasswordShort')); return }
    if (newPw !== confirm) { setError(t('settings.errPasswordMismatch')); return }
    setBusy(true)
    try { await changePassword(oldPw, newPw); onSuccess() } catch (e) { setError(localizeError(e)) } finally { setBusy(false) }
  }
  return (
    <AnimatePresence>{open && (
      <Sheet title={t('settings.changePassword')} onClose={onClose}>
        <div className="space-y-2 py-1">
          <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder={t('settings.oldPasswordLabel')} aria-label={t('settings.oldPasswordLabel')} className={inputCls} />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t('settings.newPasswordLabel')} aria-label={t('settings.newPasswordLabel')} className={inputCls} />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t('settings.confirmPasswordLabel')} aria-label={t('settings.confirmPasswordLabel')} className={inputCls} />
          {error && <p className="text-[12px] text-catFail">{error}</p>}
          <Button variant="primary" size="lg" className="w-full" disabled={busy} onClick={() => void onSubmit()}>{t('common.save')}</Button>
        </div>
      </Sheet>
    )}</AnimatePresence>
  )
}

function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const deleteAccount = useAccountStore((s) => s.deleteAccount)
  const navigate = useNavigate()
  const t = useT()
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputCls = 'h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/15 focus-visible:ring-offset-2 focus-visible:ring-offset-card'
  async function onSubmit() {
    setError(null)
    setBusy(true)
    try { await deleteAccount(pw); navigate('/login') } catch (e) { setError(localizeError(e)); setBusy(false) }
  }
  return (
    <AnimatePresence>{open && (
      <Sheet title={t('settings.deleteAccount')} onClose={onClose}>
        <div className="space-y-2 py-1">
          <p className="text-[12px] leading-relaxed text-catFail">{t('settings.deleteAccountWarn')}</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('settings.passwordLabel')} aria-label={t('settings.passwordLabel')} className={inputCls} />
          {error && <p className="text-[12px] text-catFail">{error}</p>}
          <Button variant="primary" size="lg" className="w-full bg-catFail" disabled={busy} onClick={() => void onSubmit()}>{t('settings.deleteAccountConfirm')}</Button>
        </div>
      </Sheet>
    )}</AnimatePresence>
  )
}

function RedeemSheet({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const redeemCode = useAccountStore((s) => s.redeemCode)
  const t = useT()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputCls = 'h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/15 focus-visible:ring-offset-2 focus-visible:ring-offset-card'
  async function onSubmit() {
    setError(null)
    if (!code.trim()) { setError(t('settings.redeemCode')); return }
    setBusy(true)
    try {
      await redeemCode(code.trim())
      await useQuotaStore.getState().refresh()
      onSuccess()
    } catch (e) { setError(localizeError(e)) } finally { setBusy(false) }
  }
  return (
    <AnimatePresence>{open && (
      <Sheet title={t('settings.redeemCode')} onClose={onClose}>
        <div className="space-y-2 py-1">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('settings.redeemCodePlaceholder')} aria-label={t('settings.redeemCode')} className={inputCls} />
          {error && <p className="text-[12px] text-catFail">{error}</p>}
          <Button variant="primary" size="lg" className="w-full" disabled={busy} onClick={() => void onSubmit()}>{t('common.save')}</Button>
        </div>
      </Sheet>
    )}</AnimatePresence>
  )
}
```

- [ ] **Step 5: 渲染三个 sheet + 接线**

在 `<BindNetworkSheet …/>` 渲染之后、`{nickOpen && …}` 之前插入：

```tsx
      <ChangePasswordSheet
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        onSuccess={() => {
          setPwOpen(false)
          setToast(t('settings.changePasswordSuccess'))
          // 后端已作废全部 session（changePassword 内 clearSession），跳登录重登。
          window.setTimeout(() => navigate('/login'), 800)
        }}
      />
      <DeleteAccountSheet open={delOpen} onClose={() => setDelOpen(false)} />
      <RedeemSheet
        open={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        onSuccess={() => {
          setRedeemOpen(false)
          const a = useAccountStore.getState().account
          const planName = a?.paidPlanId === 'yearly' ? t('settings.planYearly') : t('settings.planMonthly')
          const date = a?.paidExpiresAt?.slice(0, 10) ?? ''
          setToast(t('settings.redeemSuccess', { plan: planName, date }))
        }}
      />
```

- [ ] **Step 6: PlansSheet 兑换码入口**

`src/ui/screens/settings/PlansSheet.tsx`：在 `PLAN_TIERS.map` 之后、`{toast && …}` 之前插入「输入兑换码」块（复用 inputCls 样式）：

```tsx
            {/* 兑换码：输码激活付费档（interim，绕开真实支付）。 */}
            <div className="rounded-card border border-brd p-4">
              <span className="text-[13px] font-medium text-ink">{t('settings.redeemCode')}</span>
              <div className="mt-2 flex gap-2">
                <input
                  value={redeemCodeInput}
                  onChange={(e) => setRedeemCodeInput(e.target.value.toUpperCase())}
                  placeholder={t('settings.redeemCodePlaceholder')}
                  aria-label={t('settings.redeemCode')}
                  className="h-10 flex-1 rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none"
                />
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void onRedeem()}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
```

并在组件内加 state + handler（`busy`/`toast` 复用现有；`redeemCode` 从 accountStore 取）：

```ts
  const redeemCode = useAccountStore((s) => s.redeemCode)
  const [redeemCodeInput, setRedeemCodeInput] = useState('')

  async function onRedeem() {
    if (!redeemCodeInput.trim()) return
    setBusy(true)
    try {
      await redeemCode(redeemCodeInput.trim())
      await refreshQuota()
      const a = useAccountStore.getState().account
      const planName = a?.paidPlanId === 'yearly' ? t('settings.planYearly') : t('settings.planMonthly')
      const date = a?.paidExpiresAt?.slice(0, 10) ?? ''
      setToast(t('settings.redeemSuccess', { plan: planName, date }))
      setRedeemCodeInput('')
    } catch (e) {
      setToast(localizeError(e))
    } finally {
      setBusy(false)
    }
  }
```

- [ ] **Step 7: typecheck + e2e（390×844）**

```bash
npx tsc -p tsconfig.app.json
# 浏览器 390×844 起 settings 屏：账号信息行显邮箱脱敏+注册时间；修改密码 sheet 三字段；注销 sheet 警示+密码；兑换码 sheet + PlansSheet 兑换块。截图存 .e2e_shots/。
```

- [ ] **Step 8: commit**

```bash
git add src/ui/screens/settings/AccountSection.tsx src/ui/screens/settings/PlansSheet.tsx src/app/i18n/zh/settings.ts src/app/i18n/en/settings.ts
git commit -m "feat(settings): 账号中心——账号信息+修改密码+注销账号+兑换码入口"
```

---

## 全链路验收（Phase 1 收口）

1. 后端 typecheck：`cd server && npx tsc --noEmit`；前端：`npx tsc -p tsconfig.app.json`。
2. curl 全链路（Task 1/3/4 的 curl 已覆盖）。
3. chrome-devtools-mcp / Playwright（390×844）：
   - 登录 network 账号 → settings → 账号信息行显邮箱+注册时间。
   - 兑换码输入（PlansSheet 或账号中心入口）→ 激活 → 账号页显付费 + quota 变无限。
   - 修改密码 → 跳登录 → 新密码可登。
   - 注销（用测试号）→ 回登录 → 该号不可再登。
   - 录一条 1:20 语音（rc10 含 timeslice 修复）→ STT 出转写 + classify ready（不再「无文本」）；额度用完的 429 显真实「额度已用完」而非「无文本」。

## 范围外（Phase 2 / 后续）

- 云端同步（spec §3，Phase 2 单开）。
- 真实支付（微信/支付宝 webhook）。
- OPFS 媒体文件的注销清库（best-effort 后续）。
- HTTPS 域名 + 证书（同步上生产前置）。
