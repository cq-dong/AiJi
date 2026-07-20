# 账号体系 Slice B 实现计划（网络注册 + 内置 key 代理 + 权益包）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 v1.5 之上实现网络注册（邮箱+密码）+ 内置 key 代理（builtinLlm/builtinStt 适配器）+ 免费额度 + 付费权益包 UI（支付 stub），mock 适配器先行，client 全流程可跑通验收。

**Architecture:** 新增 AuthPort/QuotaPort/PlanPort 三端口（mock 适配器）；builtinLlm/builtinStt 是实现现有 LlmPort/SttPort 的适配器（非新端口）；di.ts 改二级代理（llmProxy + sttProxy）按 settings.keySource 路由 builtin/byok，byok 路径逐字节不变；accountStore 扩 session/login/register/bindNetwork/upgradePlan；新增 quotaStore。

**Tech Stack:** React 19 + Vite 8 + TS strict + Zustand + Dexie + vitest（新增）+ jsdom。

**Spec:** `docs/superpowers/specs/2026-07-17-account-system-slice-b-design.md`（设计定稿，本计划是其实现）。

## Global Constraints

- TS strict：`verbatimModuleSyntax` → 类型 import 必须 `import type`；`erasableSyntaxOnly` → 禁 enum/namespace/ctor 参数属性（错误类手写 constructor）；`noUnusedLocals/noUnusedParameters` → 无未用变量/参数（import 只留实际用到的）。
- 并行子智能体自检用 `npx tsc -p tsconfig.app.json --noEmit`（**不要** `npm run typecheck`/`tsc -b`，并发竞态 tsbuildinfo）。
- byok 路径必须与现状逐字节一致——二级代理是风险点，T11 单测覆盖 byok 不走 builtinLlm/builtinStt、不读 JWT。
- 截图存 `.e2e_shots/`，禁止丢根目录。
- 错误码契约：mock auth 错误统一 `throw new Error('AUTH_<CODE>:<中文消息>')`，CODE=400/401/409/500；UI/store 用 `msg.startsWith('AUTH_409')` 分流。SessionExpiredError/NotNetworkError/QuotaExhaustedError 是 ports 层 Error 子类（builtin 适配器抛）。
- 游客强制 byok：setKeySource 守卫 + builtinLlm/builtinStt 调用前 assertNetwork 防御纵深。
- mock 通过 env 开关：`VITE_AIJI_MOCK_SESSION_EXPIRED=1`、`VITE_AIJI_MOCK_QUOTA_EXHAUSTED=1`、`VITE_AIJI_BACKEND_BASE`（builtin 端点前缀，默认空串走同源 mock）。

---

## File Structure

### 新建

| 文件 | 职责 |
|---|---|
| `src/domain/quota.ts` | `Quota` 纯 TS |
| `src/domain/plan.ts` | `PlanTier` 纯 TS + `PLAN_TIERS` 常量 |
| `src/app/session.ts` | `AuthSession` localStorage 读写（key `aiji:auth`） |
| `src/adapters/mockAuth.ts` | `AuthPort` mock |
| `src/adapters/mockQuota.ts` | `QuotaPort` mock |
| `src/adapters/mockPlan.ts` | `PlanPort` mock |
| `src/adapters/builtinLlm.ts` | `builtinLlm` 实现 `LlmPort`，发 `/api/llm/chat` 带 JWT |
| `src/adapters/builtinStt.ts` | `builtinStt` 实现 `SttPort`，发 `/api/stt/transcribe` 带 JWT |
| `src/app/quotaStore.ts` | quota Zustand store |
| `src/ui/screens/settings/QuotaSheet.tsx` | 额度详情 sheet |
| `src/ui/screens/settings/PlansSheet.tsx` | 权益对比 sheet |
| `vitest.config.ts` | vitest 配置 |
| 各 `__tests__/*.test.ts` | 见各任务 |

### 修改

| 文件 | 改动 |
|---|---|
| `src/domain/account.ts` | 加 `AuthSession`、Account 加 `paidPlanId?`/`paidExpiresAt?` |
| `src/domain/types.ts` Settings | 加 `keySource?` |
| `src/ports/index.ts` | 加 3 端口接口 + 3 错误类 |
| `src/data/seed.ts` | seedSettings 补 `keySource: 'byok'` |
| `src/app/di.ts` | `sttProxy` 二级 + 新 `llmProxy` + 接 4 端口 |
| `src/app/store.ts` | processEntry STT 判据改 + 加 `setKeySource` |
| `src/app/accountStore.ts` | 加 session/login/register/bindNetwork/upgradePlan/clearSession/sessionStale，logout 改全清 |
| `src/app/devSeed.ts` | seed keySource='byok' |
| `src/main.tsx` | boot 时 quotaStore.hydrate（network 用户） |
| `src/ui/screens/login/index.tsx` | 网络注册 stub→真表单 + toggle（增量改网络 Card 段，游客块不动） |
| `src/ui/screens/settings/AccountSection.tsx` | keySource 行/额度行/升级行/升级网络账号/退出登录 |
| `src/adapters/openAiCompatLlm.ts` | 仅给 10 个 helper 加 `export`（无行为改动） |
| `src/ui/screens/capture/index.tsx` | 采集失败 toast 加"注册网络账号"链接 |
| `package.json` | devDeps 加 vitest/jsdom；scripts 加 test |

---

## 任务依赖序

```
T1(域类型) → T2(端口) → T3(vitest+session) → T4(mockAuth)/T5(mockQuota)/T6(mockPlan) 并行
  → T7(builtinLlm)/T8(builtinStt) 并行 → T9(accountStore) → T10(quotaStore)
  → T11(di二级代理) → T12(processEntry+setKeySource) → T13(devSeed+boot)
  → T14(login页) → T15a/T15b/T15c(AccountSection) → T16(toast引导) → T17(typecheck回归) → T18(e2e)
```

---

### Task 1: 域类型与 Settings 扩展

**Files:**
- Create: `src/domain/quota.ts`、`src/domain/plan.ts`
- Modify: `src/domain/account.ts`、`src/domain/types.ts`(Settings interface)、`src/data/seed.ts`(seedSettings)
- Test: `src/domain/__tests__/plan.test.ts`

**Interfaces:**
- Produces: `Quota`、`PlanTier`、`PLAN_TIERS`、`AuthSession`、`Account.paidPlanId/paidExpiresAt`、`Settings.keySource`

- [ ] **Step 1: 写失败测试**

```ts
// src/domain/__tests__/plan.test.ts
import { describe, it, expect } from 'vitest'
import { PLAN_TIERS } from '@/domain/plan'
describe('PLAN_TIERS', () => {
  it('has free/monthly/yearly', () => {
    expect(PLAN_TIERS.map((p) => p.id)).toEqual(['free', 'monthly', 'yearly'])
    expect(PLAN_TIERS[0].price).toBe(0)
    expect(PLAN_TIERS[2].limits.llmLimit).toBe(-1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run src/domain/__tests__/plan.test.ts` → Cannot find module '@/domain/plan'

- [ ] **Step 3: 实现**

```ts
// src/domain/quota.ts
export interface Quota {
  llmUsed: number
  llmLimit: number
  sttUsedSec: number
  sttLimitSec: number
  aggUsed: number
  aggLimit: number
  resetAt: string // ISO，下次重置时间
}
```

```ts
// src/domain/plan.ts
export interface PlanTier {
  id: string // 'free' | 'monthly' | 'yearly'
  name: string
  price: number // 分；free=0
  period: 'once' | 'monthly' | 'yearly'
  limits: { llmLimit: number; sttLimitSec: number; aggLimit: number } // -1=无限
  features: string[]
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'free', name: '免费', price: 0, period: 'once',
    limits: { llmLimit: 20, sttLimitSec: 120, aggLimit: 5 },
    features: ['每日 20 次 LLM', '每日 120 秒 STT', '内置 Key'],
  },
  {
    id: 'monthly', name: '月度会员', price: 1800, period: 'monthly',
    limits: { llmLimit: 300, sttLimitSec: 1800, aggLimit: 50 },
    features: ['每日 300 次 LLM', '每日 30 分钟 STT', 'VLM 多模态（远期）'],
  },
  {
    id: 'yearly', name: '年度会员', price: 16800, period: 'yearly',
    limits: { llmLimit: -1, sttLimitSec: -1, aggLimit: -1 },
    features: ['LLM 无限', 'STT 无限', '所有付费功能'],
  },
]
```

`src/domain/account.ts` 全文件替换：

```ts
// 账号身份模型（纯 TS，零 I/O）。单一本地池：Account 是身份叠加层，非数据分区键。
export type AccountType = 'guest' | 'network'
export type AccountPlan = 'guest' | 'free' | 'paid'

export interface Account {
  id: string
  type: AccountType
  nickname: string
  email?: string
  plan: AccountPlan
  createdAt: string
  boundAt?: string
  avatar?: string
  // Slice B
  paidPlanId?: string // 'monthly' | 'yearly'，plan='paid' 时有值
  paidExpiresAt?: string // 付费到期 ISO
}

// Slice B：JWT 会话。localStorage 'aiji:auth' 持久化（src/app/session.ts）。
export interface AuthSession {
  jwt: string
  refreshToken: string
  expiresAt: string // jwt 过期时间 ISO
}
```

`src/domain/types.ts` Settings interface 内（紧接 vlmKeyRef 字段后）追加：

```ts
  // Slice B：AI 调用来源。undefined 视同 'byok'；游客强制 'byok'（store 守卫）。
  keySource?: 'byok' | 'builtin'
```

`src/data/seed.ts` seedSettings 末尾追加：`keySource: 'byok' as const,`

- [ ] **Step 4: 跑测试 + tsc 确认通过** — `npx vitest run src/domain/__tests__/plan.test.ts` PASS + `npx tsc -p tsconfig.app.json --noEmit` 无新错

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(domain): add Quota/PlanTier/AuthSession types + Settings.keySource"`

---

### Task 2: 端口接口 + 错误类型

**Files:**
- Modify: `src/ports/index.ts`（顶部 import 追加 + 末尾追加接口与类）
- Test: `src/ports/__tests__/ports.test.ts`

**Interfaces:**
- Consumes: `Account/AuthSession` from T1, `Quota` from T1, `PlanTier` from T1
- Produces: `AuthPort`/`QuotaPort`/`PlanPort` 接口 + `SessionExpiredError`/`NotNetworkError`/`QuotaExhaustedError`

- [ ] **Step 1: 写失败测试**

```ts
// src/ports/__tests__/ports.test.ts
import { describe, it, expect } from 'vitest'
import { SessionExpiredError, NotNetworkError, QuotaExhaustedError, type AuthPort, type QuotaPort, type PlanPort } from '@/ports'
describe('Slice B ports', () => {
  it('errors are throwable with correct name', () => {
    expect(() => { throw new SessionExpiredError() }).toThrow()
    expect(new NotNetworkError().name).toBe('NotNetworkError')
    expect(new QuotaExhaustedError().name).toBe('QuotaExhaustedError')
  })
  it('AuthPort shape compiles', () => {
    const m: AuthPort = {
      register: async () => null as never,
      login: async () => null as never,
      refresh: async () => null as never,
      logout: async () => {},
    }
    expect(typeof m.register).toBe('function')
  })
  it('QuotaPort/PlanPort shape', () => {
    const q: QuotaPort = { getQuota: async () => null as never }
    const p: PlanPort = { getPlans: async () => [], upgrade: async () => null as never }
    expect(typeof q.getQuota).toBe('function')
    expect(typeof p.upgrade).toBe('function')
  })
})
```

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现** — `src/ports/index.ts` 顶部 import 追加：

```ts
import type { Account, AuthSession } from '@/domain/account'
import type { Quota } from '@/domain/quota'
import type { PlanTier } from '@/domain/plan'
```

末尾追加：

```ts
// ── Slice B 端口 ──────────────────────────────────────────────
// 错误类：适配器抛、UI/store catch 按 name 分流。erasableSyntaxOnly 禁 class 参数属性，手写 constructor。
export class SessionExpiredError extends Error {
  constructor(message = 'session expired') {
    super(message)
    this.name = 'SessionExpiredError'
  }
}
export class NotNetworkError extends Error {
  constructor(message = 'builtin key requires network account') {
    super(message)
    this.name = 'NotNetworkError'
  }
}
export class QuotaExhaustedError extends Error {
  constructor(message = 'quota exhausted') {
    super(message)
    this.name = 'QuotaExhaustedError'
  }
}

export interface AuthPort {
  register(email: string, password: string): Promise<{ account: Account; session: AuthSession }>
  login(email: string, password: string): Promise<{ account: Account; session: AuthSession }>
  refresh(): Promise<AuthSession>
  logout(): Promise<void>
}

export interface QuotaPort {
  getQuota(): Promise<Quota>
}

export interface PlanPort {
  getPlans(): Promise<PlanTier[]>
  upgrade(planId: string): Promise<{
    orderId: string
    paidPlanId: string
    paidExpiresAt: string
    payUrl?: string
  }>
}
```

- [ ] **Step 4: 跑测试 + tsc 通过**

- [ ] **Step 5: Commit** — `feat(ports): add AuthPort/QuotaPort/PlanPort + session/quota errors`

---

### Task 3: Vitest 基建 + localSession helper

**Files:**
- Modify: `package.json`（devDeps + scripts）
- Create: `vitest.config.ts`、`src/app/session.ts`
- Test: `src/app/__tests__/session.test.ts`

**Interfaces:**
- Produces: `localSession`（get/set/clear，key `aiji:auth`）

- [ ] **Step 1: 写失败测试**

```ts
// src/app/__tests__/session.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { localSession } from '@/app/session'
beforeEach(() => localStorage.clear())
describe('localSession', () => {
  it('round-trips set/get/clear', () => {
    const s = { jwt: 'j', refreshToken: 'r', expiresAt: '2099-01-01' }
    localSession.set(s)
    expect(localSession.get()).toEqual(s)
    localSession.clear()
    expect(localSession.get()).toBeNull()
  })
  it('returns null when empty', () => {
    expect(localSession.get()).toBeNull()
  })
})
```

- [ ] **Step 2: 装依赖** — `npm i -D vitest @vitest/ui jsdom`

- [ ] **Step 3: 实现**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'], globals: false },
  resolve: { alias: { '@/': fileURLToPath(new URL('./src/', import.meta.url)) } },
})
```

```ts
// src/app/session.ts
import type { AuthSession } from '@/domain/account'

const KEY = 'aiji:auth'

export const localSession = {
  get(): AuthSession | null {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      return JSON.parse(raw) as AuthSession
    } catch {
      return null
    }
  },
  set(s: AuthSession): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      // QuotaExceeded / 隐私模式 → 静默降级
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // 同上
    }
  },
}
```

`package.json` scripts 加：`"test": "vitest", "test:run": "vitest run"`

- [ ] **Step 4: 跑测试通过** — `npx vitest run src/app/__tests__/session.test.ts`

- [ ] **Step 5: Commit** — `chore(test): add vitest + jsdom; add localSession helper`

---

### Task 4: mockAuth 适配器

**Files:**
- Create: `src/adapters/mockAuth.ts`
- Test: `src/adapters/__tests__/mockAuth.test.ts`

**Interfaces:**
- Consumes: `AuthPort` from T2, `Account/AuthSession` from T1
- Produces: `mockAuth: AuthPort`，错误契约 `AUTH_<CODE>:<msg>`

- [ ] **Step 1: 写失败测试**

```ts
// src/adapters/__tests__/mockAuth.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockAuth } from '@/adapters/mockAuth'
beforeEach(() => localStorage.clear())
describe('mockAuth', () => {
  it('register succeeds with valid email+pw>=8', async () => {
    const r = await mockAuth.register('a@b.com', '12345678')
    expect(r.account.type).toBe('network')
    expect(r.account.plan).toBe('free')
    expect(r.session.jwt).toBeTruthy()
  })
  it('register 409 on duplicate email', async () => {
    await mockAuth.register('a@b.com', '12345678')
    await expect(mockAuth.register('a@b.com', '12345678')).rejects.toThrow('AUTH_409')
  })
  it('register 400 on short password', async () => {
    await expect(mockAuth.register('a@b.com', 'short')).rejects.toThrow('AUTH_400')
  })
  it('login succeeds after register', async () => {
    await mockAuth.register('a@b.com', '12345678')
    const r = await mockAuth.login('a@b.com', '12345678')
    expect(r.account.email).toBe('a@b.com')
  })
  it('login 401 on wrong password', async () => {
    await mockAuth.register('a@b.com', '12345678')
    await expect(mockAuth.login('a@b.com', 'wrongpass')).rejects.toThrow('AUTH_401')
  })
  it('refresh 401 when VITE_AIJI_MOCK_SESSION_EXPIRED=1', async () => {
    vi.stubEnv('VITE_AIJI_MOCK_SESSION_EXPIRED', '1')
    await expect(mockAuth.refresh()).rejects.toThrow('AUTH_401')
    vi.unstubAllEnvs()
  })
  it('refresh succeeds otherwise', async () => {
    const s = await mockAuth.refresh()
    expect(s.jwt).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**

```ts
// src/adapters/mockAuth.ts
import type { AuthPort } from '@/ports'
import type { Account, AuthSession } from '@/domain/account'

interface StoredUser {
  email: string
  password: string
  accountId: string
}

const USERS_KEY = 'aiji:mock:users'
const expired = () => import.meta.env.VITE_AIJI_MOCK_SESSION_EXPIRED === '1'

function now1h(): string {
  return new Date(Date.now() + 3600_000).toISOString()
}
function makeJwt(email: string): string {
  return 'mockjwt.' + btoa(email) + '.' + now1h()
}
function readUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as StoredUser[]
  } catch {
    return []
  }
}
function writeUsers(u: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(u))
}

export const mockAuth: AuthPort = {
  async register(email, password) {
    if (password.length < 8) throw new Error('AUTH_400:密码至少 8 位')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('AUTH_400:邮箱格式无效')
    const users = readUsers()
    if (users.some((u) => u.email === email)) throw new Error('AUTH_409:该邮箱已注册')
    const account: Account = {
      id: crypto.randomUUID(),
      type: 'network',
      nickname: email.split('@')[0],
      email,
      plan: 'free',
      createdAt: new Date().toISOString(),
    }
    users.push({ email, password, accountId: account.id })
    writeUsers(users)
    const session: AuthSession = { jwt: makeJwt(email), refreshToken: 'mockrefresh:' + account.id, expiresAt: now1h() }
    return { account, session }
  },
  async login(email, password) {
    const users = readUsers()
    const u = users.find((x) => x.email === email)
    if (!u || u.password !== password) throw new Error('AUTH_401:邮箱或密码错误')
    const account: Account = {
      id: u.accountId, type: 'network', nickname: email.split('@')[0], email, plan: 'free', createdAt: new Date().toISOString(),
    }
    const session: AuthSession = { jwt: makeJwt(email), refreshToken: 'mockrefresh:' + u.accountId, expiresAt: now1h() }
    return { account, session }
  },
  async refresh() {
    if (expired()) throw new Error('AUTH_401:refresh token 已失效')
    return { jwt: 'mockjwt.refreshed.' + now1h(), refreshToken: 'mockrefresh:new', expiresAt: now1h() }
  },
  async logout() {
    // mock 无服务端状态
  },
}
```

- [ ] **Step 4: 跑测试通过**

- [ ] **Step 5: Commit** — `feat(adapters): add mockAuth (AuthPort mock with AUTH_<CODE> error contract)`

---

### Task 5: mockQuota 适配器

**Files:**
- Create: `src/adapters/mockQuota.ts`
- Test: `src/adapters/__tests__/mockQuota.test.ts`

**Interfaces:**
- Consumes: `QuotaPort` from T2, `Quota` from T1
- Produces: `mockQuota: QuotaPort` + `mockQuotaInternal.{bumpLlm,bumpStt,bumpAgg}`（builtin 适配器调用前递增，localStorage 计数器按日重置）

**计数器持久化决策**：用 localStorage（非模块级变量）——dev server 重启不清零、按日重置需日期戳、e2e 跨刷新可见。`VITE_AIJI_MOCK_QUOTA_EXHAUSTED=1` 是强制耗尽快路，二者互补。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockQuota, mockQuotaInternal } from '@/adapters/mockQuota'
beforeEach(() => localStorage.clear())
describe('mockQuota', () => {
  it('initial used=0', async () => {
    const q = await mockQuota.getQuota()
    expect(q.llmUsed).toBe(0)
  })
  it('bumpLlm increments llmUsed', async () => {
    mockQuotaInternal.bumpLlm(); mockQuotaInternal.bumpLlm()
    const q = await mockQuota.getQuota()
    expect(q.llmUsed).toBe(2)
  })
  it('bumpStt increments by 5 default', async () => {
    mockQuotaInternal.bumpStt()
    expect((await mockQuota.getQuota()).sttUsedSec).toBe(5)
  })
  it('bumpAgg increments aggUsed', async () => {
    mockQuotaInternal.bumpAgg()
    expect((await mockQuota.getQuota()).aggUsed).toBe(1)
  })
  it('exhausted env returns used=limit', async () => {
    vi.stubEnv('VITE_AIJI_MOCK_QUOTA_EXHAUSTED', '1')
    const q = await mockQuota.getQuota()
    expect(q.llmUsed).toBe(q.llmLimit)
    vi.unstubAllEnvs()
  })
  it('resetAt is in future', async () => {
    const q = await mockQuota.getQuota()
    expect(new Date(q.resetAt).getTime()).toBeGreaterThan(Date.now() - 1000)
  })
})
```

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**

```ts
// src/adapters/mockQuota.ts
import type { QuotaPort } from '@/ports'
import type { Quota } from '@/domain/quota'

const KEY = 'aiji:mock:quota'
const FREE_LIMITS = { llmLimit: 20, sttLimitSec: 120, aggLimit: 5 }
const exhausted = () => import.meta.env.VITE_AIJI_MOCK_QUOTA_EXHAUSTED === '1'

function nextResetAt(): string {
  const d = new Date()
  d.setHours(8, 0, 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return d.toISOString()
}
function today(): string {
  return new Date().toISOString().slice(0, 10)
}
interface Counts { llmUsed: number; sttUsedSec: number; aggUsed: number; date: string }
function read(): Counts {
  const t = today()
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Counts | null
    if (c && c.date === t) return c
  } catch { /* fallthrough */ }
  return { llmUsed: 0, sttUsedSec: 0, aggUsed: 0, date: t }
}
function write(c: Counts): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* 静默 */ }
}

export const mockQuotaInternal = {
  bumpLlm(n = 1): void { const c = read(); c.llmUsed += n; write(c) },
  bumpStt(sec = 5): void { const c = read(); c.sttUsedSec += sec; write(c) },
  bumpAgg(n = 1): void { const c = read(); c.aggUsed += n; write(c) },
}

export const mockQuota: QuotaPort = {
  async getQuota(): Promise<Quota> {
    if (exhausted()) {
      return { ...FREE_LIMITS, llmUsed: FREE_LIMITS.llmLimit, sttUsedSec: FREE_LIMITS.sttLimitSec, aggUsed: FREE_LIMITS.aggLimit, resetAt: nextResetAt() }
    }
    const c = read()
    return { ...FREE_LIMITS, llmUsed: c.llmUsed, sttUsedSec: c.sttUsedSec, aggUsed: c.aggUsed, resetAt: nextResetAt() }
  },
}
```

- [ ] **Step 4: 跑测试通过**

- [ ] **Step 5: Commit** — `feat(adapters): add mockQuota (QuotaPort mock with localStorage counter)`

---

### Task 6: mockPlan 适配器

**Files:**
- Create: `src/adapters/mockPlan.ts`
- Test: `src/adapters/__tests__/mockPlan.test.ts`

**Interfaces:**
- Consumes: `PlanPort` from T2, `PLAN_TIERS` from T1
- Produces: `mockPlan: PlanPort`（upgrade 返 `{orderId, paidPlanId, paidExpiresAt, payUrl: undefined}`，不 mutate account）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { mockPlan } from '@/adapters/mockPlan'
describe('mockPlan', () => {
  it('getPlans returns 3 tiers', async () => {
    const plans = await mockPlan.getPlans()
    expect(plans.map((p) => p.id)).toEqual(['free', 'monthly', 'yearly'])
  })
  it('upgrade monthly returns paidPlanId + future expiresAt + no payUrl', async () => {
    const r = await mockPlan.upgrade('monthly')
    expect(r.paidPlanId).toBe('monthly')
    expect(new Date(r.paidExpiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(r.payUrl).toBeUndefined()
    expect(r.orderId).toBeTruthy()
  })
  it('upgrade yearly returns 365d expiry', async () => {
    const r = await mockPlan.upgrade('yearly')
    const days = (new Date(r.paidExpiresAt).getTime() - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(364)
  })
})
```

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**

```ts
// src/adapters/mockPlan.ts
import type { PlanPort } from '@/ports'
import { PLAN_TIERS } from '@/domain/plan'

export const mockPlan: PlanPort = {
  async getPlans() { return PLAN_TIERS },
  async upgrade(planId) {
    const days = planId === 'yearly' ? 365 : 30
    const paidExpiresAt = new Date(Date.now() + days * 86400_000).toISOString()
    return { orderId: 'order_' + crypto.randomUUID(), paidPlanId: planId, paidExpiresAt, payUrl: undefined }
  },
}
```

- [ ] **Step 4: 跑测试通过**

- [ ] **Step 5: Commit** — `feat(adapters): add mockPlan (PlanPort mock with stub upgrade)`

---

### Task 7: builtinLlm 适配器

**Files:**
- Modify: `src/adapters/openAiCompatLlm.ts`（给 10 个 helper 加 `export`，无行为改动：`entryText`/`toLocalIso`/`buildPrompt`/`parseJson`/`buildAggregatePrompt`/`parseAggregateJson`/`buildIntentPrompt`/`parseIntentJson`/`buildAnswerPrompt`/`parseAnswerJson`）
- Create: `src/adapters/builtinLlm.ts`
- Test: `src/adapters/__tests__/builtinLlm.test.ts`

**Interfaces:**
- Consumes: `LlmPort` from ports，`di.storage`，`useAccountStore`，`localSession`(T3)，`mockAuth.refresh`(T4)，`mockQuotaInternal`(T5)，`SessionExpiredError`/`NotNetworkError`(T2)，上述 10 个 helper
- Produces: `builtinLlm: LlmPort`

**实现注意（self-review 修正）**：
1. **VLM 剥离**：openAiCompatLlm.classify 的 VLM 逻辑（collectEntryImages + content 升级多模态 + vlmKey 读取 + VLM 端点路由 + 降级重发）全部删掉，只保留 `buildPrompt` 产出的纯文本 messages。不读 vlmKeyRef、不附 image_url、不读 videoVisionEnabled。含图条目走纯文本分类（spec §4.7 已知退化）。
2. **prompt 复用不复制**：10 个 helper 是独立函数（非内联），builtinLlm 直接 import 复用（加 export，零行为改动），不复制。byok 路径仍调原 openAiCompatLlm（其方法体零改动），byte-identical 铁律不受影响。
3. **ping 签名**：LlmPort.ping 实际签名是 `ping(opts?)`。builtinLlm.ping 必须声明 `async ping(_opts?)` 接受可选 opts（即使忽略），否则 T11 llmProxy `builtinLlm.ping(o)` 传参报 "Expected 0 arguments, got 1"。
4. **import 精简**：只 import 实际用到的类型 `Aggregate, ChatAnswer, EntryAi`（来自 `@/domain/types`）。**不要** import `AggregateScopeType/ChatCite/ChatQuery`——它们仅由接口签名推断，显式 import 会触发 noUnusedLocals。
5. **方法体对照**：classify/aggregate/parseChatIntent/answerChat 的返回值构造（EntryAi/Aggregate 字段、summary 拼接、tag/category 涌现落库）逐行对照 openAiCompatLlm 同名方法体，仅替换 fetch 端点（`/api/llm/chat`）、auth（JWT）、quota bump、VLM 剥离四点。实现时打开 openAiCompatLlm.ts 对照。

- [ ] **Step 1: 写失败测试** — `src/adapters/__tests__/builtinLlm.test.ts`（mock fetch + di + accountStore + localSession + mockAuth）：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { builtinLlm } from '@/adapters/builtinLlm'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import { localSession } from '@/app/session'
import { mockQuotaInternal } from '@/adapters/mockQuota'

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getEntry: vi.fn(async () => ({
        id: 'e1', createdAt: '2026-07-17T10:00:00+08:00', updatedAt: '', status: 'idle',
        parts: [{ type: 'text', content: '测试内容' }],
      })),
      getEntryAi: vi.fn(async () => undefined),
      listCategories: vi.fn(async () => []),
      listTags: vi.fn(async () => []),
      saveTag: vi.fn(async () => {}),
      saveCategory: vi.fn(async () => {}),
    },
  },
}))
vi.mock('@/app/accountStore', () => ({
  useAccountStore: { getState: () => ({ account: { id: 'u1', type: 'network', nickname: 'n', plan: 'free', createdAt: '' } }) },
}))
vi.mock('@/adapters/mockAuth', () => ({
  mockAuth: { refresh: vi.fn(async () => ({ jwt: 'newjwt', refreshToken: 'r', expiresAt: '2099' })) },
}))

const okReply = (reply: string) => (globalThis.fetch = vi.fn(async () =>
  new Response(JSON.stringify({ reply }), { status: 200, headers: { 'Content-Type': 'application/json' } })
) as never)

beforeEach(() => {
  localStorage.clear()
  localSession.set({ jwt: 'oldjwt', refreshToken: 'r', expiresAt: '2099' })
  vi.clearAllMocks()
})

describe('builtinLlm', () => {
  it('classify returns EntryAi with modelUsed=builtin-llm', async () => {
    okReply(JSON.stringify({ categorySlug: 'idea', tags: ['t'], facets: {} }))
    const ai = await builtinLlm.classify('e1')
    expect(ai.modelUsed).toBe('builtin-llm')
  })
  it('classify sends JWT Authorization header', async () => {
    okReply(JSON.stringify({ categorySlug: 'idea', tags: [], facets: {} }))
    await builtinLlm.classify('e1')
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oldjwt')
  })
  it('classify does NOT read vlm:key secret (VLM strip)', async () => {
    okReply(JSON.stringify({ categorySlug: 'idea', tags: [], facets: {} }))
    await builtinLlm.classify('e1') // di.secrets 未 mock → 若读 vlm:key 会抛
  })
  it('classify bumps llm quota', async () => {
    okReply(JSON.stringify({ categorySlug: 'idea', tags: [], facets: {} }))
    const spy = vi.spyOn(mockQuotaInternal, 'bumpLlm')
    await builtinLlm.classify('e1')
    expect(spy).toHaveBeenCalledOnce()
  })
  it('guest account throws NotNetworkError', async () => {
    const m = await import('@/app/accountStore')
    ;(m.useAccountStore as unknown as { getState: () => unknown }).getState = () => ({ account: { id: 'g', type: 'guest', nickname: 'g', plan: 'guest', createdAt: '' } })
    okReply('{}')
    await expect(builtinLlm.classify('e1')).rejects.toBeInstanceOf(NotNetworkError)
  })
  it('401 → refresh → retry succeeds', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) return new Response('', { status: 401 })
      return new Response(JSON.stringify({ reply: '{}' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as never
    await builtinLlm.classify('e1')
    expect(calls).toBe(2)
    expect(localSession.get()?.jwt).toBe('newjwt')
  })
  it('401 → refresh fails → SessionExpiredError + session cleared', async () => {
    const { mockAuth } = await import('@/adapters/mockAuth')
    ;(mockAuth.refresh as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('AUTH_401'))
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as never
    await expect(builtinLlm.classify('e1')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(localSession.get()).toBeNull()
  })
  it('no session → SessionExpiredError', async () => {
    localSession.clear()
    okReply('{}')
    await expect(builtinLlm.classify('e1')).rejects.toBeInstanceOf(SessionExpiredError)
  })
})
```

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现** — 先给 openAiCompatLlm.ts 的 10 个 helper 加 `export`（仅追加 `export ` 关键字）。然后创建 `src/adapters/builtinLlm.ts`：

```ts
// src/adapters/builtinLlm.ts
import type { LlmPort } from '@/ports'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import type { Aggregate, ChatAnswer, EntryAi } from '@/domain/types'
import { di } from '@/app/di'
import { useAccountStore } from '@/app/accountStore'
import { localSession } from '@/app/session'
import { mockAuth } from '@/adapters/mockAuth'
import { mockQuotaInternal } from '@/adapters/mockQuota'
import {
  entryText, toLocalIso, buildPrompt, parseJson,
  buildAggregatePrompt, parseAggregateJson,
  buildIntentPrompt, parseIntentJson,
  buildAnswerPrompt, parseAnswerJson,
} from '@/adapters/openAiCompatLlm'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

function assertNetwork(): void {
  const a = useAccountStore.getState().account
  if (!a || a.type !== 'network') throw new NotNetworkError()
}

// 统一 chat 端点：所有 LLM 方法组装成 OpenAI 兼容 messages 发 /api/llm/chat。
// 401 → refresh 重试一次 → 再 401 抛 SessionExpiredError。
async function chat(messages: { role: 'system' | 'user' | 'assistant'; content: unknown }[]): Promise<string> {
  const session = localSession.get()
  if (!session) throw new SessionExpiredError()
  const doFetch = (jwt: string) =>
    fetch(`${BASE}/api/llm/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, opts: {} }),
    })
  let res = await doFetch(session.jwt)
  if (res.status === 401) {
    let newSession
    try {
      newSession = await mockAuth.refresh()
      localSession.set(newSession)
    } catch {
      localSession.clear()
      throw new SessionExpiredError()
    }
    res = await doFetch(newSession.jwt)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`builtinLlm HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const reply = data?.reply
  if (typeof reply !== 'string') throw new Error('builtinLlm 响应缺 reply')
  return reply
}

export const builtinLlm: LlmPort = {
  async classify(entryId) {
    assertNetwork()
    const entry = await di.storage.getEntry(entryId)
    if (!entry) throw new Error('entry not found: ' + entryId)
    const content = entryText(entry)
    const hasVideoParts = entry.parts.some((p) => p.type === 'video')
    if (!content.trim() && !hasVideoParts) throw new Error('条目无文本/媒体可分类')
    // VLM 退化（§4.7）：builtin 路径不读 vlmKeyRef、不附 image_url。buildPrompt 只产文本 content。
    const categories = await di.storage.listCategories()
    const tags = await di.storage.listTags()
    const messages = buildPrompt(content, toLocalIso(entry.createdAt), categories, tags)
    mockQuotaInternal.bumpLlm()
    const raw = await chat(messages)
    const parsed = parseJson(raw)
    const now = new Date().toISOString()
    const dedupTags = [...new Set(parsed.tags ?? [])]
    // ⚠️ 以下 EntryAi 构造 + tag/category 涌现落库逻辑：逐行对照 openAiCompatLlm.classify 同段
    const tagSlugs = new Set(tags.map((t) => t.slug))
    for (const slug of dedupTags) {
      if (!tagSlugs.has(slug)) {
        await di.storage.saveTag({ slug, label: slug, usageCount: 0, createdAt: now })
        tagSlugs.add(slug)
      }
    }
    const catSlugs = new Set(categories.map((c) => c.slug))
    if (parsed.categorySlug && !catSlugs.has(parsed.categorySlug)) {
      await di.storage.saveCategory({
        slug: parsed.categorySlug,
        label: parsed.categoryLabel ?? parsed.categorySlug,
        aliases: [], usageCount: 0, createdAt: now,
      })
    }
    const priorAi = await di.storage.getEntryAi(entryId)
    const ai: EntryAi = {
      id: crypto.randomUUID(),
      entryId,
      version: (priorAi?.version ?? 0) + 1,
      category: parsed.categorySlug,
      tags: dedupTags,
      facets: parsed.facets ?? {},
      titleSuggestion: parsed.titleSuggestion,
      summary: parsed.summary,
      reminderSuggestion: parsed.reminderSuggestion,
      modelUsed: 'builtin-llm',
      createdAt: now,
    }
    return ai
  },

  async aggregate(entryIds, scope, range, detailLevel, id) {
    assertNetwork()
    if (entryIds.length === 0) throw new Error('无条目可聚合')
    const entries = await Promise.all(
      entryIds.map(async (eid) => {
        const entry = await di.storage.getEntry(eid)
        if (!entry) return null
        const ai = await di.storage.getEntryAi(eid)
        return { id: eid, text: entryText(entry), aiSummary: ai?.summary }
      }),
    )
    const valid = entries.flatMap((e) => (e === null ? [] : [e]))
    if (valid.length === 0) throw new Error('条目无文本可聚合')
    const clampedLevel = Math.min(5, Math.max(1, detailLevel ?? 3))
    const messages = buildAggregatePrompt(valid, scope, clampedLevel)
    mockQuotaInternal.bumpLlm()
    mockQuotaInternal.bumpAgg()
    const raw = await chat(messages)
    const parsed = parseAggregateJson(raw)
    // ⚠️ Aggregate 构造：逐行对照 openAiCompatLlm.aggregate 同段（scope/summary/highlights 字段）
    const now = new Date().toISOString()
    const ag: Aggregate = {
      id: id ?? crypto.randomUUID(),
      scope: { type: scope, range },
      summary: parsed.sentences && parsed.sentences.length > 0 ? parsed.sentences.join('') : (parsed.summary ?? ''),
      highlights: parsed.highlights,
      entryIds: valid.map((v) => v.id),
      modelUsed: 'builtin-llm',
      createdAt: now,
      stale: false,
      detailLevel: clampedLevel,
    }
    return ag
  },

  async parseChatIntent(question, nowIso) {
    assertNetwork()
    const messages = buildIntentPrompt(question, toLocalIso(nowIso))
    mockQuotaInternal.bumpLlm()
    const raw = await chat(messages)
    return parseIntentJson(raw)
  },

  async answerChat({ question, cites, conversation }) {
    assertNetwork()
    const messages = buildAnswerPrompt(question, cites, conversation)
    mockQuotaInternal.bumpLlm()
    const raw = await chat(messages)
    const parsed = parseAnswerJson(raw)
    const validIds = new Set(cites.map((c) => c.id))
    const citedEntryIds = parsed.citedEntryIds.filter((cid) => validIds.has(cid))
    return { answer: parsed.answer, citedEntryIds } satisfies ChatAnswer
  },

  // ping 签名必须接受可选 opts（LlmPort.ping(opts?)），即使 builtin 忽略 opts。
  async ping(_opts?: { url?: string; model?: string; key?: string }) {
    try {
      assertNetwork()
      const started = performance.now()
      await chat([{ role: 'user', content: 'ping' }])
      return { ok: true, latencyMs: Math.round(performance.now() - started) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) }
    }
  },
}
```

- [ ] **Step 4: 跑测试 + tsc 通过**（实现时若 Aggregate.scope 字段名/结构或 parseAggregateJson 返回字段与 openAiCompatLlm 不一致，以 openAiCompatLlm.ts 实际代码为准调整）

- [ ] **Step 5: Commit** — `feat(adapters): add builtinLlm (LlmPort via /api/llm/chat, VLM stripped, JWT+refresh)`

---

### Task 8: builtinStt 适配器

**Files:**
- Create: `src/adapters/builtinStt.ts`
- Test: `src/adapters/__tests__/builtinStt.test.ts`

**Interfaces:**
- Consumes: `SttPort`，`di.storage.getMedia`，`localSession`，`mockAuth.refresh`，`mockQuotaInternal`，`useAccountStore`
- Produces: `builtinStt: SttPort`

- [ ] **Step 1: 写失败测试**（同 T7 模式 mock fetch/di/accountStore/localSession）：transcribe 成功返 text / header 含 `Authorization: Bearer` / guest 抛 NotNetworkError / 401→refresh→重试成功 / refresh 失败→SessionExpiredError + session cleared / `bumpStt` 被调 / blob 未找到抛错

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**

```ts
// src/adapters/builtinStt.ts
import type { SttPort } from '@/ports'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import { di } from '@/app/di'
import { localSession } from '@/app/session'
import { mockAuth } from '@/adapters/mockAuth'
import { mockQuotaInternal } from '@/adapters/mockQuota'
import { useAccountStore } from '@/app/accountStore'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

export const builtinStt: SttPort = {
  async transcribe(ref) {
    const a = useAccountStore.getState().account
    if (!a || a.type !== 'network') throw new NotNetworkError()
    const blob = await di.storage.getMedia(ref)
    if (!blob) throw new Error('音频 blob 未找到: ' + ref)
    const session = localSession.get()
    if (!session) throw new SessionExpiredError()

    const doFetch = (jwt: string) => {
      const form = new FormData()
      form.append('file', blob, 'audio.webm')
      return fetch(`${BASE}/api/stt/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
      })
    }

    let res = await doFetch(session.jwt)
    if (res.status === 401) {
      let newSession
      try {
        newSession = await mockAuth.refresh()
        localSession.set(newSession)
      } catch {
        localSession.clear()
        throw new SessionExpiredError()
      }
      res = await doFetch(newSession.jwt)
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`builtinStt HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    mockQuotaInternal.bumpStt()
    return (await res.text()).trim()
  },
}
```

- [ ] **Step 4: 跑测试 + tsc 通过**

- [ ] **Step 5: Commit** — `feat(adapters): add builtinStt (SttPort via /api/stt/transcribe with JWT)`

---

### Task 9: accountStore 扩展

**Files:**
- Modify: `src/app/accountStore.ts`（全文件重写）
- Test: `src/app/__tests__/accountStore.test.ts`

**Interfaces:**
- Consumes: `di.auth`(T4)、`di.plan`(T6)、`di.storage`(logout 重置 keySource)、`localSession`(T3)、`localAccount`
- Produces: `session`/`sessionStale`/`login`/`register`/`bindNetwork`/`upgradePlan`/`clearSession`，`hydrate` 读 session + network 用户 fire-and-forget refresh，`logout` 全清

**bindNetwork 409 决策**：accountStore.bindNetwork 不 catch 409，直接抛 `AUTH_409:...`。T15c UI catch 按 `msg.startsWith('AUTH_409')` 显提示。accountStore 只调 port + 落库。

- [ ] **Step 1: 写失败测试**（mock di.auth/di.plan/di.storage）：
- register(email,pw) 后 account.type='network' + session.jwt 非空 + localSession 有值
- login AUTH_401 抛错 → account 不变
- bindNetwork：先 registerGuest → bindNetwork → account.id 不变 + type=network + plan=free + boundAt set + nickname 保留
- bindNetwork AUTH_409 抛错 → account 仍 guest
- upgradePlan('monthly') → account.plan='paid' + paidPlanId='monthly' + paidExpiresAt 未来
- logout → account/session null + di.storage.saveSettings 被调且 keySource='byok'
- hydrate network 用户 refresh 失败 → sessionStale=true

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**

```ts
// src/app/accountStore.ts
import { create } from 'zustand'
import type { Account, AuthSession } from '@/domain/account'
import { localAccount } from '@/adapters/localAccount'
import { localSession } from '@/app/session'
import { di } from '@/app/di'

interface AccountState {
  account: Account | null
  session: AuthSession | null
  sessionStale: boolean
  hydrated: boolean
  hydrate: () => void
  registerGuest: (nickname: string) => Account
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  bindNetwork: (email: string, password: string) => Promise<void>
  upgradePlan: (planId: string) => Promise<void>
  clearSession: () => void
  logout: () => void
  setAvatar: (dataUrl: string) => void
  setNickname: (name: string) => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  session: null,
  sessionStale: false,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return
    set({ account: localAccount.get(), session: localSession.get(), hydrated: true })
    const a = get().account
    if (a && a.type === 'network') {
      di.auth
        .refresh()
        .then((s) => { localSession.set(s); set({ session: s, sessionStale: false }) })
        .catch(() => set({ sessionStale: true }))
    }
  },
  registerGuest: (nickname) => {
    const account: Account = {
      id: crypto.randomUUID(), type: 'guest', nickname: nickname.trim() || '我',
      plan: 'guest', createdAt: new Date().toISOString(),
    }
    localAccount.set(account)
    set({ account })
    return account
  },
  login: async (email, password) => {
    const { account, session } = await di.auth.login(email, password)
    localAccount.set(account); localSession.set(session)
    set({ account, session, sessionStale: false })
  },
  register: async (email, password) => {
    const { account, session } = await di.auth.register(email, password)
    localAccount.set(account); localSession.set(session)
    set({ account, session, sessionStale: false })
  },
  bindNetwork: async (email, password) => {
    const cur = get().account
    if (!cur) throw new Error('no account to bind')
    const { session } = await di.auth.register(email, password)
    const next: Account = { ...cur, type: 'network', plan: 'free', email, boundAt: new Date().toISOString() }
    localAccount.set(next); localSession.set(session)
    set({ account: next, session, sessionStale: false })
  },
  upgradePlan: async (planId) => {
    const r = await di.plan.upgrade(planId)
    const cur = get().account
    if (!cur) return
    const next: Account = { ...cur, plan: 'paid', paidPlanId: r.paidPlanId, paidExpiresAt: r.paidExpiresAt }
    localAccount.set(next)
    set({ account: next })
    // quota refresh 由 UI 层 PlansSheet 调 useQuotaStore.getState().refresh()（单向依赖）
  },
  clearSession: () => {
    localSession.clear()
    set({ session: null, sessionStale: false })
  },
  logout: () => {
    // spec §4.9 全清：session + account + reset keySource='byok'
    localSession.clear(); localAccount.clear()
    set({ account: null, session: null, sessionStale: false })
    void di.storage
      .getSettings()
      .then((s) => {
        if (s.keySource && s.keySource !== 'byok') return di.storage.saveSettings({ ...s, keySource: 'byok' })
        return undefined
      })
      .catch((e) => console.error('[accountStore] logout reset keySource failed', e))
  },
  setAvatar: (dataUrl) => {
    const cur = get().account
    if (!cur) return
    const next: Account = { ...cur, avatar: dataUrl }
    localAccount.set(next); set({ account: next })
  },
  setNickname: (name) => {
    const cur = get().account
    if (!cur) return
    const trimmed = name.trim()
    if (!trimmed) return
    const next: Account = { ...cur, nickname: trimmed }
    localAccount.set(next); set({ account: next })
  },
}))
```

- [ ] **Step 4: 跑测试 + tsc 通过**

- [ ] **Step 5: Commit** — `feat(app): extend accountStore with session/login/register/bindNetwork/upgradePlan`

---

### Task 10: quotaStore

**Files:**
- Create: `src/app/quotaStore.ts`
- Test: `src/app/__tests__/quotaStore.test.ts`

**Interfaces:**
- Consumes: `di.quota`(T5)
- Produces: `useQuotaStore`（quota/hydrated/exhausted/hydrate/refresh/consume）

- [ ] **Step 1: 写失败测试**（mock di.quota.getQuota）：hydrate 后 quota 非 null + hydrated=true / consume('llm',1) llmUsed+1 / refresh 后 resetAt 过去时 used=0 / used>=limit → exhausted=true

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**

```ts
// src/app/quotaStore.ts
import { create } from 'zustand'
import type { Quota } from '@/domain/quota'
import { di } from './di'

type ConsumeType = 'llm' | 'stt' | 'agg'

interface QuotaState {
  quota: Quota | null
  hydrated: boolean
  exhausted: boolean
  hydrate: () => Promise<void>
  refresh: () => Promise<void>
  consume: (type: ConsumeType, amount: number) => void
}

function isExhausted(q: Quota): boolean {
  return (q.llmLimit >= 0 && q.llmUsed >= q.llmLimit) || (q.sttLimitSec >= 0 && q.sttUsedSec >= q.sttLimitSec)
}

export const useQuotaStore = create<QuotaState>((set, get) => ({
  quota: null,
  hydrated: false,
  exhausted: false,
  hydrate: async () => {
    if (get().hydrated) return
    await get().refresh()
    set({ hydrated: true })
  },
  refresh: async () => {
    try {
      const q = await di.quota.getQuota()
      const resetPassed = new Date(q.resetAt).getTime() < Date.now()
      const fixed: Quota = resetPassed ? { ...q, llmUsed: 0, sttUsedSec: 0, aggUsed: 0 } : q
      set({ quota: fixed, exhausted: isExhausted(fixed) })
    } catch {
      // 静默：UI 显 skeleton（quota=null）
    }
  },
  consume: (type, amount) => {
    const cur = get().quota
    if (!cur) return
    const next: Quota =
      type === 'llm' ? { ...cur, llmUsed: cur.llmUsed + amount }
      : type === 'stt' ? { ...cur, sttUsedSec: cur.sttUsedSec + amount }
      : { ...cur, aggUsed: cur.aggUsed + amount }
    set({ quota: next, exhausted: isExhausted(next) })
  },
}))
```

- [ ] **Step 4: 跑测试 + tsc 通过**

- [ ] **Step 5: Commit** — `feat(app): add quotaStore with optimistic consume + reset logic`

---

### Task 11: di.ts 二级代理 + 端口接线 + byok 回归

**Files:**
- Modify: `src/app/di.ts`（全文件）
- Test: `src/app/__tests__/diProxy.test.ts`

**Interfaces:**
- Consumes: 所有 adapter（T4-T8）
- Produces: `di` 加 `auth/quota/plan`；`llmProxy` + 二级 `sttProxy`

**llmProxy 缓存决策**：不缓存。`dexieStorage.getSettings()` 是 IndexedDB 单行读 <1ms，每次 LLM 调用（秒级网络 IO）可忽略。缓存需 setKeySource 时 invalidate 跨模块同步，YAGNI。

- [ ] **Step 1: 写失败测试** `src/app/__tests__/diProxy.test.ts`（mock dexieStorage.getSettings 返回不同 keySource）：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { di } from '@/app/di'
import { openAiCompatLlm } from '@/adapters/openAiCompatLlm'
import { builtinLlm } from '@/adapters/builtinLlm'
import { paraformerStreamStt } from '@/adapters/paraformerStreamStt'
import { whisperRestStt } from '@/adapters/whisperRestStt'
import { builtinStt } from '@/adapters/builtinStt'

const getSettings = vi.fn()
vi.mock('@/adapters/dexieStorage', () => ({ dexieStorage: { getSettings } }))
beforeEach(() => getSettings.mockReset())

describe('di proxies', () => {
  it('byok → llm routes to openAiCompatLlm, not builtinLlm', async () => {
    getSettings.mockResolvedValue({ keySource: 'byok' })
    const byokSpy = vi.spyOn(openAiCompatLlm, 'classify').mockResolvedValue(null as never)
    const builtinSpy = vi.spyOn(builtinLlm, 'classify').mockResolvedValue(null as never)
    await di.llm.classify('e1')
    expect(byokSpy).toHaveBeenCalledOnce()
    expect(builtinSpy).not.toHaveBeenCalled()
  })
  it('byok → stt routes to paraformer (stream mode)', async () => {
    getSettings.mockResolvedValue({ keySource: 'byok', sttMode: 'stream' })
    const pSpy = vi.spyOn(paraformerStreamStt, 'transcribe').mockResolvedValue('')
    const wSpy = vi.spyOn(whisperRestStt, 'transcribe').mockResolvedValue('')
    const bSpy = vi.spyOn(builtinStt, 'transcribe').mockResolvedValue('')
    await di.stt.transcribe('r')
    expect(pSpy).toHaveBeenCalledOnce()
    expect(wSpy).not.toHaveBeenCalled()
    expect(bSpy).not.toHaveBeenCalled()
  })
  it('byok + whisper mode → whisper', async () => {
    getSettings.mockResolvedValue({ keySource: 'byok', sttMode: 'whisper' })
    const wSpy = vi.spyOn(whisperRestStt, 'transcribe').mockResolvedValue('')
    await di.stt.transcribe('r')
    expect(wSpy).toHaveBeenCalledOnce()
  })
  it('builtin → llm routes to builtinLlm, not openAiCompatLlm', async () => {
    getSettings.mockResolvedValue({ keySource: 'builtin' })
    const byokSpy = vi.spyOn(openAiCompatLlm, 'classify').mockResolvedValue(null as never)
    const builtinSpy = vi.spyOn(builtinLlm, 'classify').mockResolvedValue(null as never)
    await di.llm.classify('e1')
    expect(builtinSpy).toHaveBeenCalledOnce()
    expect(byokSpy).not.toHaveBeenCalled()
  })
  it('builtin → stt routes to builtinStt', async () => {
    getSettings.mockResolvedValue({ keySource: 'builtin' })
    const bSpy = vi.spyOn(builtinStt, 'transcribe').mockResolvedValue('')
    const pSpy = vi.spyOn(paraformerStreamStt, 'transcribe').mockResolvedValue('')
    await di.stt.transcribe('r')
    expect(bSpy).toHaveBeenCalledOnce()
    expect(pSpy).not.toHaveBeenCalled()
  })
  it('keySource undefined → byok', async () => {
    getSettings.mockResolvedValue({})
    const byokSpy = vi.spyOn(openAiCompatLlm, 'classify').mockResolvedValue(null as never)
    const builtinSpy = vi.spyOn(builtinLlm, 'classify').mockResolvedValue(null as never)
    await di.llm.classify('e1')
    expect(byokSpy).toHaveBeenCalledOnce()
    expect(builtinSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**

```ts
// src/app/di.ts
import { dexieStorage } from '@/adapters/dexieStorage'
import { webCapture } from '@/adapters/webCapture'
import { openAiCompatLlm } from '@/adapters/openAiCompatLlm'
import { paraformerStreamStt } from '@/adapters/paraformerStreamStt'
import { whisperRestStt } from '@/adapters/whisperRestStt'
import { localStorageSecrets } from '@/adapters/localStorageSecrets'
import { notifications } from '@/adapters/notifications'
import { mockAuth } from '@/adapters/mockAuth'
import { mockQuota } from '@/adapters/mockQuota'
import { mockPlan } from '@/adapters/mockPlan'
import { builtinLlm } from '@/adapters/builtinLlm'
import { builtinStt } from '@/adapters/builtinStt'
import type {
  AuthPort, CapturePort, LlmPort, PlanPort, QuotaPort, SecretStorePort, StoragePort, SttPort,
} from '@/ports'

export interface Di {
  storage: StoragePort
  capture: CapturePort
  llm: LlmPort
  stt: SttPort
  secrets: SecretStorePort
  auth: AuthPort
  quota: QuotaPort
  plan: PlanPort
  notifications: typeof notifications
}

async function readKeySource(): Promise<'byok' | 'builtin'> {
  const s = await dexieStorage.getSettings()
  return s.keySource === 'builtin' ? 'builtin' : 'byok'
}

const llmProxy: LlmPort = {
  classify: (id) => readKeySource().then((k) => (k === 'builtin' ? builtinLlm.classify(id) : openAiCompatLlm.classify(id))),
  aggregate: (ids, scope, range, d, id) => readKeySource().then((k) =>
    k === 'builtin' ? builtinLlm.aggregate(ids, scope, range, d, id) : openAiCompatLlm.aggregate(ids, scope, range, d, id)),
  parseChatIntent: (q, now) => readKeySource().then((k) =>
    k === 'builtin' ? builtinLlm.parseChatIntent(q, now) : openAiCompatLlm.parseChatIntent(q, now)),
  answerChat: (o) => readKeySource().then((k) => (k === 'builtin' ? builtinLlm.answerChat(o) : openAiCompatLlm.answerChat(o))),
  ping: (o) => readKeySource().then((k) => (k === 'builtin' ? builtinLlm.ping(o) : openAiCompatLlm.ping(o))),
}

const sttProxy: SttPort = {
  async transcribe(ref) {
    const settings = await dexieStorage.getSettings()
    if (settings.keySource === 'builtin') return builtinStt.transcribe(ref)
    const adapter = settings.sttMode === 'whisper' ? whisperRestStt : paraformerStreamStt
    return adapter.transcribe(ref)
  },
}

export const di: Di = {
  storage: dexieStorage,
  capture: webCapture,
  llm: llmProxy,
  stt: sttProxy,
  secrets: localStorageSecrets,
  auth: mockAuth,
  quota: mockQuota,
  plan: mockPlan,
  notifications,
}
```

- [ ] **Step 4: 跑测试 + tsc 通过**（byok 回归铁律：6 项全过）

- [ ] **Step 5: Commit** — `feat(di): add llmProxy + 2-level sttProxy; wire auth/quota/plan ports (byok byte-identical)`

---

### Task 12: processEntry STT 判据 + setKeySource action

**Files:**
- Modify: `src/app/store.ts`（processEntry STT 判据 :457-458 + UiState interface + action）
- Test: `src/app/__tests__/processEntryStt.test.ts`

**Interfaces:**
- Consumes: `di.storage.getSettings`、`useAccountStore.session`、`di.secrets.get('stt:key')`
- Produces: `setKeySource(source)`（guest 守卫拒绝切 builtin）

- [ ] **Step 1: 写失败测试**（mock di）：byok+stt:key 存在→transcribe 被调 / byok+无 stt:key→跳过 / builtin+session 存在→transcribe 被调（走 builtinStt）/ builtin+无 session→跳过 / setKeySource('builtin') guest 时被守卫拒绝（settings.keySource 不变）

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现** — `store.ts` 顶部 import 追加 `import { useAccountStore } from './accountStore'`。UiState interface 紧接 setSttConfig 后追加 `setKeySource: (source: 'byok' | 'builtin') => void`。action 追加：

```ts
  setKeySource: (source) => {
    const account = useAccountStore.getState().account
    if (source === 'builtin' && (!account || account.type === 'guest')) return
    const next = { ...get().settings, keySource: source }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
  },
```

`store.ts:457-458`（原 `const sttKey = await di.secrets.get('stt:key')` + `if (sttKey) {`）替换为：

```ts
      const settings = await di.storage.getSettings()
      const session = useAccountStore.getState().session
      const shouldStt = (settings.keySource ?? 'byok') === 'byok'
        ? !!(await di.secrets.get('stt:key'))
        : !!session
      if (shouldStt) {
```

- [ ] **Step 4: 跑测试 + tsc 通过**

- [ ] **Step 5: Commit** — `feat(store): processEntry STT gating by keySource; add setKeySource action`

---

### Task 13: devSeed + main.tsx boot

**Files:**
- Modify: `src/app/devSeed.ts`、`src/main.tsx`

- [ ] **Step 1: 手动验证准备** — `npm run dev`，确认当前 boot 不报错

- [ ] **Step 2: 实现** — `devSeed.ts`（patch 块末尾，`if (Object.keys(patch).length > 0 ...` 前）追加：

```ts
  if (!s.keySource) patch.keySource = 'byok'
```

`main.tsx` 顶部追加 `import { useQuotaStore } from '@/app/quotaStore'`；`useAccountStore.getState().hydrate()` 后追加：

```ts
// Slice B: network 用户 boot 时拉额度
const _acc = useAccountStore.getState().account
if (_acc && _acc.type === 'network') {
  void useQuotaStore.getState().hydrate()
}
```

- [ ] **Step 3: tsc 通过 + 手动验证** — 游客 boot 不报错；localStorage 清空后 dev seed 写入 keySource='byok'

- [ ] **Step 4: Commit** — `feat(boot): hydrate quotaStore for network users; seed keySource=byok`

---

### Task 14: login 页真表单

**Files:**
- Modify: `src/ui/screens/login/index.tsx`（**增量修改**：替换网络账号 Card 段为真表单 + toggle，游客块 JSX 保持不动）

**Interfaces:**
- Consumes: `useAccountStore.login/register`、`useUiStore.settings.onboarded`
- 错误码分流：catch 后 `if (msg.startsWith('AUTH_409'))` → setError"该邮箱已注册，请直接登录" + 自动切 login toggle；`AUTH_400/401` → setError(msg 去前缀)；其他 → setError 原文

- [ ] **Step 1: 实现** — 保留现有游客注册块（onGuestStart → registerGuest → navigate('/onboarding')）。替换网络账号 Card 为：

```tsx
<Card className="mt-3 opacity-90">
  <div className="flex items-center gap-2">
    <button type="button" onClick={() => { setMode('register'); setError(null) }}
      className={`flex-1 rounded-btn py-2 text-[13px] font-medium transition ${mode === 'register' ? 'bg-priS text-pri' : 'text-t3'}`}>注册</button>
    <button type="button" onClick={() => { setMode('login'); setError(null) }}
      className={`flex-1 rounded-btn py-2 text-[13px] font-medium transition ${mode === 'login' ? 'bg-priS text-pri' : 'text-t3'}`}>登录</button>
  </div>
  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱"
    aria-label="邮箱" aria-invalid={!!error}
    className="mt-3 h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 focus:border-pri/50 focus:outline-none" />
  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码（至少 8 位）"
    aria-label="密码" aria-invalid={!!error}
    className="mt-2 h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 focus:border-pri/50 focus:outline-none" />
  {mode === 'register' && (
    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="确认密码"
      aria-label="确认密码"
      className="mt-2 h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 focus:border-pri/50 focus:outline-none" />
  )}
  {error && <p className="mt-2 text-[12px] text-catFail" role="alert">{error}</p>}
  <Button variant="primary" size="lg" className="mt-3 w-full" onClick={onNetworkSubmit} disabled={loading}>
    {loading ? <Spinner size={16} /> : mode === 'register' ? '注册' : '登录'}
  </Button>
</Card>
```

组件顶部 state + handler：

```tsx
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const [nickname, setNickname] = useState('')
const [mode, setMode] = useState<'register' | 'login'>('register')
const [email, setEmail] = useState('')
const [password, setPassword] = useState('')
const [confirmPassword, setConfirmPassword] = useState('')
const [error, setError] = useState<string | null>(null)
const [loading, setLoading] = useState(false)

async function onNetworkSubmit() {
  setError(null)
  if (!EMAIL_RE.test(email)) { setError('邮箱格式无效'); return }
  if (password.length < 8) { setError('密码至少 8 位'); return }
  if (mode === 'register' && password !== confirmPassword) { setError('两次密码不一致'); return }
  setLoading(true)
  try {
    if (mode === 'register') await useAccountStore.getState().register(email, password)
    else await useAccountStore.getState().login(email, password)
    const onboarded = useUiStore.getState().settings.onboarded
    navigate(onboarded ? '/' : '/onboarding')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('AUTH_409')) { setError('该邮箱已注册，请直接登录'); setMode('login') }
    else if (msg.startsWith('AUTH_')) setError(msg.replace(/^AUTH_\d+:/, ''))
    else setError(msg)
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 2: tsc 通过 + 手动验证** — 游客注册回归；网络注册→onboarding；409 自动切登录；登录→home（onboarded 已 true）

- [ ] **Step 3: Commit** — `feat(ui): login page real network register/login form with toggle`

---

### Task 15a: AccountSection keySource 行 + 退出登录 + QuotaSheet

**Files:**
- Modify: `src/ui/screens/settings/AccountSection.tsx`（替换 NetworkSheet 为 KeySourceSheet + 退出登录行 + 额度行）
- Create: `src/ui/screens/settings/QuotaSheet.tsx`

**Interfaces:**
- Consumes: `useAccountStore`（account/logout）、`useUiStore`（settings.keySource/setKeySource）、`useQuotaStore`（quota/hydrated）

- [ ] **Step 1: 实现 QuotaSheet 骨架**

```tsx
// src/ui/screens/settings/QuotaSheet.tsx
import { Sheet } from '@/ui/components' // 沿用现有 Sheet 原语（见 detail/Sheet.tsx 模式）
import { useQuotaStore } from '@/app/quotaStore'

export function QuotaSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const quota = useQuotaStore((s) => s.quota)
  return (
    <Sheet open={open} onClose={onClose} title="额度详情">
      {!quota ? (
        <div className="p-4 text-[13px] text-t3">加载中…</div>
      ) : (
        <div className="space-y-3 p-4 text-[13px]">
          <Row label="LLM 今日" value={`${quota.llmUsed} / ${quota.llmLimit < 0 ? '∞' : quota.llmLimit} 次`} />
          <Row label="STT 今日" value={`${quota.sttUsedSec} / ${quota.sttLimitSec < 0 ? '∞' : quota.sttLimitSec} 秒`} />
          <Row label="聚合今日" value={`${quota.aggUsed} / ${quota.aggLimit < 0 ? '∞' : quota.aggLimit} 次`} />
          <Row label="重置时间" value={new Date(quota.resetAt).toLocaleString()} />
        </div>
      )}
    </Sheet>
  )
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-t3">{label}</span><span className="text-ink">{value}</span></div>
}
```

- [ ] **Step 2: 实现 AccountSection 改动** — 三行插入（头像/昵称/退出登录之间）：
  - **keySource 行**：显当前（"内置 Key（免费额度）"/"自己的 Key"），点开 KeySourceSheet 二选一；`account.type==='guest'` 时整行 disabled + 副标题"需先升级为网络账号"
  - **额度行**：仅 `keySource==='builtin'` 显示，"今日 LLM N/M 次，STT X/Y 秒"，点开 QuotaSheet；`sessionStale===true` 时灰色 + "登录状态可能已过期，重新登录"
  - **退出登录行**：替代原"切换网络账号"，调 `accountStore.logout()` + `navigate('/login')`
  - KeySourceSheet：两选项（内置 Key 免费额度 / 自己的 Key），调 `setKeySource`

- [ ] **Step 3: tsc 通过 + 手动验证** — 游客 keySource disabled；网络切 builtin→额度行显示；QuotaSheet 显数据；退出登录→/login

- [ ] **Step 4: Commit** — `feat(ui): AccountSection keySource row + QuotaSheet + logout`

---

### Task 15b: PlansSheet + 升级行

**Files:**
- Create: `src/ui/screens/settings/PlansSheet.tsx`
- Modify: `src/ui/screens/settings/AccountSection.tsx`（加升级行）

**Interfaces:**
- Consumes: `useAccountStore`（account/upgradePlan）、`useQuotaStore`（refresh）、`PLAN_TIERS`

- [ ] **Step 1: 实现 PlansSheet 骨架**

```tsx
// src/ui/screens/settings/PlansSheet.tsx
import { useState } from 'react'
import { Sheet, Button } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'
import { useQuotaStore } from '@/app/quotaStore'
import { PLAN_TIERS } from '@/domain/plan'

export function PlansSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const upgradePlan = useAccountStore((s) => s.upgradePlan)
  const refreshQuota = useQuotaStore((s) => s.refresh)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onUpgrade(id: string) {
    setBusy(true)
    try {
      await upgradePlan(id)
      await refreshQuota()
      setToast('升级成功（演示）')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '升级失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="权益方案">
      <div className="space-y-3 p-4">
        {PLAN_TIERS.map((p) => (
          <div key={p.id} className="rounded-card border border-brd p-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium text-ink">{p.name}</span>
              <span className="text-[13px] text-t2">{p.price === 0 ? '免费' : `¥${(p.price / 100).toFixed(0)}/${p.period === 'monthly' ? '月' : '年'}`}</span>
            </div>
            <ul className="mt-2 space-y-1 text-[12px] text-t3">
              {p.features.map((f) => <li key={f}>· {f}</li>)}
            </ul>
            {p.id !== 'free' && (
              <Button variant="primary" size="sm" className="mt-3 w-full" disabled={busy} onClick={() => onUpgrade(p.id)}>
                升级到{p.name}
              </Button>
            )}
          </div>
        ))}
        {toast && <p className="text-center text-[12px] text-pri">{toast}</p>}
      </div>
    </Sheet>
  )
}
```

- [ ] **Step 2: 实现 AccountSection 升级行** — `plan==='free'` 显"升级付费"，`plan==='paid'` 显"当前：月度/年度会员 至 yyyy-mm-dd"（按 paidPlanId/paidExpiresAt），点开 PlansSheet

- [ ] **Step 3: tsc 通过 + 手动验证** — free 显"升级付费"；选 Monthly→toast + account 段显付费 + 额度刷新；paid 显到期日期

- [ ] **Step 4: Commit** — `feat(ui): PlansSheet + account upgrade row`

---

### Task 15c: 升级为网络账号（guest bindNetwork）

**Files:**
- Modify: `src/ui/screens/settings/AccountSection.tsx`（加"升级为网络账号"行 + BindNetworkSheet）

**Interfaces:**
- Consumes: `useAccountStore.bindNetwork`；错误分流 `AUTH_409`→"该邮箱已注册"

- [ ] **Step 1: 实现 BindNetworkSheet 骨架**

```tsx
// 加在 AccountSection.tsx 内或独立 sheet
function BindNetworkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bindNetwork = useAccountStore((s) => s.bindNetwork)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('邮箱格式无效'); return }
    if (password.length < 8) { setError('密码至少 8 位'); return }
    if (password !== confirm) { setError('两次密码不一致'); return }
    setBusy(true)
    try {
      await bindNetwork(email, password)
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.startsWith('AUTH_409') ? '该邮箱已注册' : msg.replace(/^AUTH_\d+:/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="升级为网络账号">
      <div className="space-y-2 p-4">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" className="h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px]" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码（至少 8 位）" className="h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px]" />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="确认密码" className="h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px]" />
        {error && <p className="text-[12px] text-catFail">{error}</p>}
        <Button variant="primary" size="lg" className="w-full" disabled={busy} onClick={onSubmit}>升级</Button>
      </div>
    </Sheet>
  )
}
```

- [ ] **Step 2: 实现 AccountSection "升级为网络账号"行** — 仅 `account.type==='guest'` 显示，点开 BindNetworkSheet。成功后留 settings 页 + toast"已升级为网络账号"

- [ ] **Step 3: tsc 通过 + 手动验证** — 游客→"升级为网络账号"→填表→bindNetwork→account 段显网络/免费 + keySource 可切；409 显提示

- [ ] **Step 4: Commit** — `feat(ui): guest bindNetwork row + sheet`

---

### Task 16: 采集失败引导 + quota 耗尽 toast

**Files:**
- Modify: `src/ui/screens/capture/index.tsx`、home/AppShell（quota exhausted toast）

**spec §4.2 session 丢失处理（mock 阶段简化）**：SessionExpiredError 在采集/chat 层 catch → 条目标 failed + toast"登录已过期，请重新登录"（不自动 logout，让用户看到 failed 条目再手动登出，符合"LLM 失败只伤 AI 层"）。spec §4.2"自动回落 byok"作为已知限制标注（远期实装），mock 阶段不做。

- [ ] **Step 1: 实现** — 采集失败 toast 文案追加"或注册网络账号用免费额度"链接（仅 guest 或 keySource=byok 未配 key 时）→ `navigate('/login')`；`useQuotaStore.exhausted===true` 时采集入口显"今日内置额度已用完，明早 8 点重置 或 切用自己的 Key"

- [ ] **Step 2: tsc 通过 + 手动验证** — 三种 toast（byok 未配 key 引导 / quota 耗尽 / session 过期）

- [ ] **Step 3: Commit** — `feat(ui): quota-exhausted toast + byok-failure guest conversion link`

---

### Task 17: typecheck 全量 + byok 回归验证

**Files:** 无（验证任务）

- [ ] **Step 1: `npm run typecheck` 通过**
- [ ] **Step 2: `npx vitest run` 全量通过**
- [ ] **Step 3: 手动 byok 回归** — byok 配 key→采集→分类成功；byok chat 两轮 LLM；byok VLM 配 vlmKeyRef→含图条目走多模态
- [ ] **Step 4: Commit（若有 fix）；否则无 commit**

---

### Task 18: 浏览器 e2e 验收（spec §6.3 11 项）

**Files:** 无（验收任务，截图存 `.e2e_shots/slice-b-{N}.png`）

390×844，`VITE_AIJI_BACKEND=mock`（dev 默认），逐项过：

- [ ] **1** 游客注册→onboarding→home（回归 Slice A）
- [ ] **2** settings"升级为网络账号"→bindNetwork→account 段显网络/免费 + keySource 可切
- [ ] **3** 退出登录→/login→网络登录→home（onboarded 已 true）
- [ ] **4** 切 keySource=builtin→采集一条→额度行 N+1
- [ ] **5** `VITE_AIJI_MOCK_QUOTA_EXHAUSTED=1` 重启→采集→toast"额度已用完"
- [ ] **6** 切 keySource=byok（未配 key）→采集→条目 failed + "注册网络账号"链接
- [ ] **7** plans sheet→Monthly→升级 toast→account 段显付费
- [ ] **8** `VITE_AIJI_MOCK_SESSION_EXPIRED=1` 重启→登录→采集→toast"登录已过期"→（条目 failed，不自动跳；手动登出→/login）
- [ ] **9** 游客→keySource 行 disabled
- [ ] **10** 游客 byok 未配 key→采集失败→"注册网络账号"链接→/login 网络注册 toggle
- [ ] **11** VLM 回归：byok 配 vlmKeyRef→含图条目 VLM 多模态；切 builtin→含图条目纯文本分类

---

## Self-Review 注记

1. **spec 覆盖**：§0-§7 全节有任务对应。§4.2"session 丢失自动回落 byok"在 mock 阶段简化（T16 注），标已知限制。§4.13 多标签 session 竞态不处理（YAGNI，Slice D）。§4.13 refresh 并发互斥锁标实装 TODO（mock 阶段不处理）。
2. **placeholder 扫描**：T14 改增量修改（去"原游客块不变"占位）；T15a/b/c 补 sheet 骨架代码；T7/T8 aggregate/summary 构造标注"对照 openAiCompatLlm 同名方法体"（执行子智能体读原文件对齐，非空洞 TODO）。
3. **类型一致性**：T7 builtinLlm.ping 声明 `_opts?`（匹配 LlmPort.ping(opts?)），T11 llmProxy.ping(o) 透传不再报错；T7 import 精简到 `Aggregate/ChatAnswer/EntryAi`（避 noUnusedLocals）；T9/T10/T11 方法签名与 T2 端口接口对齐。
