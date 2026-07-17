# 账号体系 · Slice B 设计文档（网络注册 + 内置 key 代理 + 权益包）

> 日期：2026-07-17
> 基线：v1.5 tip（commit `9c0aba8`）
> 分支策略：**新开 worktree**（基线 v1.5 tip），不污染主树。Slice A 已全量并入 v1.5，本切片在其之上。
> 依据：`docs/design/account-and-monetization.md` §1/§2/§8 + `docs/design/account-system-slice-a-plan.md` §6 Slice B 路线
> 状态：设计定稿，待用户审 → writing-plans

---

## 0. 范围与决议

### 0.1 范围

Slice B = 网络真注册（邮箱+密码）+ 后端抽象 Port 接口（mock 适配器先行，厂商后选）+ 内置 key 代理 + 免费额度（可配后端调）+ 付费权益包模型/UI（支付 stub）。

**不含**：云备份（Slice C）、VLM 内置代理（Slice C）、多端实时同步（Slice D）、真实支付渠道接入（支付 stub）、ICP 备案/合规实装（后置）。

### 0.2 锁定决议

| 项 | 决议 |
|---|---|
| 基线 | 直接在 v1.5 做（worktree-feat-account-system 已并入 v1.5，过时） |
| 后端栈 | 国内云函数，**抽象 Port 接口**，厂商后选，合规后置 |
| 注册方式 | 邮箱 + 密码 |
| 免费额度 | 可配，后端调，**不写死**（spec 留占位） |
| keySource | 游客强制 `byok`（禁用内置 key）；网络用户可在 `builtin`（限额）/`byok` 间手切 |
| 付费 | 先做模型 + plan 升级 + UI + 权益对比页，**支付 stub**（无真实支付） |
| 网络注册流向 | 跟随 `settings.onboarded`：`onboarded ? '/' : '/onboarding'`，与账号类型无关 |
| 权益档位 | Free / Monthly / Yearly 三档 |
| logout 语义 | 统一全清（clearSession + clearAccount + navigate('/login')）；"切换账号"=logout 同义词 |
| 实现隔离 | 新开 worktree，基线 v1.5 tip |

---

## 1. 架构与端口

在现有端口架构上新增 4 个端口（接口在 `src/ports/index.ts`，mock 适配器在 `src/adapters/`）：

```
AuthPort        register(email, pw) / login(email, pw) / refresh() / logout()
                 → { account, jwt, refreshToken }
BuiltinLlmPort  chat(messages, opts) → 走代理端点带 JWT，代理扣额度（STT 同理 BuiltinSttPort）
QuotaPort       getQuota() → { llmUsed, llmLimit, sttUsedSec, sttLimitSec, aggUsed, aggLimit, resetAt }
PlanPort        getPlans() / upgrade(planId) → 权益包列表 + 升级（支付 stub）
```

### 1.1 keySource 切换接线

复用现有 `Settings` + `apiKeyRef` 机制。Settings 加 `keySource: 'byok' | 'builtin'`。

DI 改二级代理（镜像现有 `sttProxy` 模式）：
- `di.llm` → 新 `llmProxy`：按 `settings.keySource` 选 `builtinLlm`（带 JWT）/ `openAiCompatLlm`（现状不变）
- `di.stt` → `sttProxy` 改二级：先读 `settings.keySource`，`builtin`→`BuiltinSttPort`（带 JWT），`byok`→按 `settings.sttMode` 选 `paraformerStreamStt`/`whisperRestStt`（现状不变）

**byok 路径必须与现状逐字节一致**——单测覆盖 byok 路径不走 BuiltinPort、不读 JWT。

游客（`account.type==='guest'`）强制 `byok`：`settingsStore.setKeySource` 守卫拒绝切 `builtin`。

### 1.2 后端契约（spec 写死接口契约，实装后填）

```
POST /api/auth/register   {email,pw} → {jwt,refresh,account}
POST /api/auth/login      {email,pw} → 同上
POST /api/auth/refresh    {refresh}  → {jwt}
POST /api/llm/chat        {messages,opts} + JWT → {reply}   (代理注入真实 key 转发 DeepSeek)
POST /api/stt/transcribe  {audio} + JWT → {text}
GET  /api/quota           + JWT → {used,limit,...}
GET  /api/plans           → [{id,name,price,limits,...}]
POST /api/plan/upgrade    {planId} + JWT → {orderId,payUrl?}  (stub: 直接升 plan)
```

mock 适配器用本地状态模拟这套契约（注册写 localStorage、额度递增、JWT 假串），客户端全流程可跑通验收。

---

## 2. 数据模型与状态

### 2.1 Account 扩展（`src/domain/account.ts`）

```ts
export type AccountType = 'guest' | 'network'
export type AccountPlan = 'guest' | 'free' | 'paid'

export interface Account {
  id: string
  type: AccountType
  nickname: string
  email?: string          // network only
  plan: AccountPlan       // guest→'guest'；网络注册→'free'；付费→'paid'
  createdAt: string
  boundAt?: string        // 游客绑定网络账号时间
  avatar?: string
  // Slice B 新增
  paidPlanId?: string     // 'monthly' | 'yearly'，plan='paid' 时有值
  paidExpiresAt?: string  // 付费到期时间
}

export interface AuthSession {
  jwt: string
  refreshToken: string
  expiresAt: string       // jwt 过期时间
}
```

### 2.2 Settings 扩展（`src/domain/types.ts`，加字段不动既有）

```ts
interface Settings {
  // ...既有 BYOK 字段
  keySource: 'byok' | 'builtin'   // 当前 AI 调用来源；游客强制 'byok'
}
```

### 2.3 新增域类型

`src/domain/quota.ts`（纯 TS 零 I/O）：
```ts
export interface Quota {
  llmUsed: number;  llmLimit: number
  sttUsedSec: number;  sttLimitSec: number
  aggUsed: number;  aggLimit: number
  resetAt: string   // 下次重置时间（ISO），额度按日重置
}
```

`src/domain/plan.ts`（纯 TS 零 I/O）：
```ts
export interface PlanTier {
  id: string           // 'free' | 'monthly' | 'yearly'
  name: string
  price: number        // 分（避免浮点）；free=0
  period: 'once' | 'monthly' | 'yearly'
  limits: { llmLimit: number; sttLimitSec: number; aggLimit: number }  // -1=无限
  features: string[]   // 权益亮点文案
}
```

### 2.4 Store 扩展

- `accountStore`：加 `session: AuthSession | null`、`login(email,pw)`、`register(email,pw)`、`bindNetwork(email,pw)`（游客→网络，保留 nickname/avatar，Account.id 不变，本地池不搬）、`upgradePlan(planId)`、`clearSession()`、`hydrate` 也读 session；`logout` 改为全清（clearSession + clearAccount）
- 新增 `quotaStore`：`quota`/`hydrated`/`hydrate`/`refresh()`（调 QuotaPort）/`consume(type, amount)`（乐观递增防闪烁，refresh 后覆盖）；hydrate 时若 `now > resetAt` 清 used=0
- `settingsStore`：加 `setKeySource(source)`，游客时强制 byok

### 2.5 JWT/refresh 存储

`localStorage` key `aiji:auth`（镜像 `localAccount` 套路），refresh 失败清 session + 跳 `/login`。

### 2.6 后端额度表（spec 写契约，不实装）

`quotas(userId, date, llmUsed, sttUsedSec, aggUsed)` 按日重置；额度值后端可配（`plan_limits` 表），客户端从 `/api/quota` 读 `limit`，不写死。

---

## 3. UI 流程与页面

### 3.1 登录页改造

网络账号 Card 由 stub 改真表单，顶部 toggle「注册/登录」单表单切换（移动端 toggle 比 tab 省垂直空间）。

- **注册字段**：email（type=email）/ password（min 8 max 64）/ confirmPassword / 昵称（可选，默认 email 本地名）
- **登录字段**：email / password
- **校验**：email 正则 + 密码长度 + 两次一致（注册）；失焦校验 + 提交再校
- **错误态**：字段下红字 + ARIA invalid；loading：按钮 disabled + Spinner
- **409 邮箱已存在**：email 字段下"该邮箱已注册，去登录" + 自动切登录 toggle
- **成功流向**：`navigate(settings.onboarded ? '/' : '/onboarding')`，与账号类型无关
- 游客注册保留不变

### 3.2 settings 账号段改造

头像/昵称/退出登录之间插三行：

1. **keySource 行**：显当前（"内置 Key（免费额度）"/"自己的 Key"），点开 sheet 二选一；`account.type==='guest'` 时整行 disabled + 副标题"需先升级为网络账号"
2. **额度行**：仅 `keySource==='builtin'` 显示，"今日 LLM N/M 次，STT X/Y 秒"，点开 quotaSheet（含 resetAt 倒计时）
3. **升级行**：`plan==='free'` 显"升级付费"，`plan==='paid'` 显"当前：月度会员 至 yyyy-mm-dd"，点开 plans sheet

原"切换网络账号"行改为"退出登录"（全清 account+session，跳 /login）。

### 3.3 权益对比 sheet

三档 Free/Monthly/Yearly 对比表（LLM 日额度 / STT 日秒 / VLM / 云备份标"远期" / 价格）。升级按钮→`PlanPort.upgrade(planId)`→mock 直接 mutate `account.plan='paid'` + `paidPlanId` + `paidExpiresAt`，sheet 内 toast"升级成功（演示）"。

**已知限制**：暂用 sheet 无深链，推广分享场景需迁 BareLayout 路由（远期）。

### 3.4 游客绑定网络账号

settings 新增"升级为网络账号"行（仅 guest 显示）→复用登录页 RegisterForm 组件→`accountStore.bindNetwork(email,pw)`：
- Account.id 不变、type guest→network、plan guest→free、boundAt=now、email 写入
- nickname/avatar 保留；session 写入
- 本地池不搬不移（单一本地池原则）
- bindNetwork 后 onboarded 已 true→留 settings 页，toast"已升级为网络账号"

### 3.5 路由与 gate

- AccountGate 不变（只看 account）
- 不单独建 SessionGate——`accountStore.hydrate` 对 `account.type==='network'` 用户 fire-and-forget 调 `AuthPort.refresh()`：成功更新 `session.expiresAt`；失败置 `sessionStale=true` 但不跳（让用户看 home）。后续 builtin 调用 401 时按 §4 流程跳 /login。无每屏请求。
- `/login` 路由不变（BareLayout）

---

## 4. 错误处理与边界

### 4.1 JWT 过期

`BuiltinLlmPort`/`BuiltinSttPort` 内部 fetch 包装：401→`AuthPort.refresh()`→重试一次；refresh 再 401→抛 `SessionExpiredError`→`accountStore.logout()`（全清）+ 全局 toast"登录已过期，请重新登录" + `navigate('/login')`。

`accountStore.hydrate` 静默 refresh 失败只置 `sessionStale`，不跳。

### 4.2 session 丢失但 account 在

网络用户 session 丢失→keySource 自动回落 byok（`settingsStore.setKeySource('byok')`）+ toast"内置额度不可用，已切用自己的 Key"；byok 未配 key→按 byok 失败路径（STT 跳过、LLM 失败显配置引导）。

### 4.3 额度耗尽

BuiltinPort 收 429→`quotaStore` 标 `exhausted`→UI 在采集/chat 入口显"今日内置额度已用完，明早 8 点重置 或 切用自己的 Key"。不崩 AI 层：条目仍落库标 failed 可重试，与现有"LLM 失败只伤 AI 层"一致。

### 4.4 额度同步（服务端权威）

builtin 调用发起时 `quotaStore.consume()` 乐观 used+1（防 UI 闪烁）；BuiltinPort 响应成功后 `quotaStore.refresh()` 拉 `QuotaPort.getQuota()` 覆盖本地值；UI 显服务端权威值。hydrate 时若 `now > resetAt` 清 used=0。

### 4.5 游客试图用内置 key

UI 层 keySource 行 disabled；BuiltinPort 调用前断言 `account.type==='network'`，否则抛 `NotNetworkError`（防御纵深）。

### 4.6 内置代理网络错误

catch 后按 byok 失败同路径（条目 failed、chat 追加 error 消息），不崩采集/存储。

### 4.7 VLM 退化（已知限制）

`keySource=builtin` 时含图/视频条目走纯文本分类（DeepSeek 不支持 image_url），VLM 多模态分类需 BYOK 配 `vlmKeyRef`。VLM 内置代理延期 Slice C。这是已知功能退化，非 bug。

### 4.8 游客 byok 未配 key 引导

采集失败提示不仅显"配置自己的 Key"，还加"或注册网络账号用免费额度"链接→跳 `/login` 网络注册 toggle。游客转化关键入口。

### 4.9 logout 语义

统一全清——`clearSession()` + `clearAccount()` + `navigate('/login')`。"切换账号"=logout 同义词，不另设。游客 logout 同样全清。

### 4.10 mock 适配器行为

- **AuthPort mock**：email 已存在 409、密码 <8 返 400、否则返固定 jwt+refresh（`expiresAt=now+1h`）；env `VITE_AIJI_MOCK_SESSION_EXPIRED=1` 时 `refresh()` 直接返 401、BuiltinPort 首次调用即 401（验收过期流程，免手改 localStorage）
- **QuotaPort mock**：llmUsed 每次 chat+1、sttUsedSec 每次转写+5、超 limit 返当前值（UI 据 `used>=limit` 显耗尽）；env `VITE_AIJI_MOCK_QUOTA_EXHAUSTED=1` 直接返 used=limit
- **PlanPort mock**：`upgrade(planId)` 直接返成功并 mutate account；支付 stub 返 `{orderId, payUrl:undefined, success:true}`，无真实支付页
- mock 通过 `VITE_AIJI_BACKEND=mock` 启用，dev 默认 mock

### 4.11 di.ts 二级代理（必改）

- `sttProxy` 改二级：先读 `settings.keySource`，`builtin`→`BuiltinSttPort`（带 JWT），`byok`→按 `settings.sttMode` 选 `paraformerStreamStt`/`whisperRestStt`（现状不变）
- 新增 `llmProxy`：`keySource builtin`→`builtinLlm`（带 JWT），`byok`→`openAiCompatLlm`（现状不变）
- byok 路径与现状逐字节一致，单测覆盖 byok 不走 BuiltinPort

### 4.12 processEntry STT 判据（必改）

`src/app/store.ts:457-458` 由
```ts
const sttKey = await di.secrets.get('stt:key')
if (sttKey) { ... }
```
改为
```ts
const shouldStt = settings.keySource === 'byok'
  ? !!(await di.secrets.get('stt:key'))
  : !!session
if (shouldStt) { ... }
```

**这是唯一 STT 终稿判据触点**。其余 stt:key 读取在 byok adapter 内部（`whisperRestStt.ts:19`、`paraformerStreamStt.ts:149`），二级代理路由后天然隔离不改。`apiKeyRef`/`sttKeyRef`/`vlmKeyRef` 在 settings UI 显"已配置"的判据（`settings/index.tsx:315` 等）与 keySource 无关，不改。`devSeed` 需补 seed `settings.keySource='byok'` 默认。

---

## 5. 文件清单与冲突审计

### 5.1 新增（零冲突）

| 文件 | 职责 |
|---|---|
| `src/domain/quota.ts` | Quota 纯 TS |
| `src/domain/plan.ts` | PlanTier 纯 TS |
| `src/adapters/mockAuth.ts` | AuthPort mock 适配器 |
| `src/adapters/builtinLlm.ts` | BuiltinLlmPort 适配器（带 JWT，调代理） |
| `src/adapters/builtinStt.ts` | BuiltinSttPort 适配器（带 JWT，调代理） |
| `src/adapters/mockQuota.ts` | QuotaPort mock 适配器 |
| `src/adapters/mockPlan.ts` | PlanPort mock 适配器 |
| `src/app/quotaStore.ts` | quota Zustand store |
| `src/ui/screens/settings/PlansSheet.tsx` | 权益对比 sheet |
| `src/ui/screens/settings/QuotaSheet.tsx` | 额度详情 sheet |

### 5.2 编辑

| 文件 | 改动 | 冲突风险 |
|---|---|---|
| `src/domain/account.ts` | 加 AuthSession + Account 付费字段 | 低 |
| `src/domain/types.ts` | Settings 加 keySource | 低 |
| `src/ports/index.ts` | 加 4 端口接口 | 低 |
| `src/app/di.ts` | sttProxy 二级 + 新 llmProxy + 接 4 端口 | **中**（核心改动） |
| `src/app/store.ts` | processEntry STT 判据改（:457-458） | **中** |
| `src/app/accountStore.ts` | 加 session/login/register/bindNetwork/upgradePlan/clearSession，logout 改全清 | 低 |
| `src/app/devSeed.ts` | seed keySource='byok' | 低 |
| `src/ui/screens/login/index.tsx` | 网络注册 stub→真表单 + toggle | 低（本切片文件） |
| `src/ui/screens/settings/AccountSection.tsx` | keySource 行/额度行/升级行/升级网络账号 | 低（本切片文件） |
| `src/main.tsx` | boot 时 quotaStore.hydrate（网络用户） | 低 |

### 5.3 不动

onboarding、capture/chat/summary/categories 屏内部、`data/db.ts`/`seed.ts`、`adapters/dexieStorage.ts`、`adapters/openAiCompatLlm.ts`/`paraformerStreamStt.ts`/`whisperRestStt.ts`（byok adapter 内部不改）、`adapters/localAccount.ts`。

---

## 6. 测试与验收

### 6.1 typecheck

`npx tsc -p tsconfig.app.json --noEmit`。重点：新 Port 接口、Account/AuthSession/Quota/PlanTier 域类型、Settings 加 keySource、accountStore 扩展、di.ts 二级代理签名。

### 6.2 mock 适配器单测（vitest）

- **AuthPort**：注册成功 / 409 / 密码短 400 / login 成功 / refresh 成功 / refresh 401 抛 SessionExpired（`VITE_AIJI_MOCK_SESSION_EXPIRED=1`）
- **QuotaPort**：初次 used=0 / 超 limit 标 exhausted（`VITE_AIJI_MOCK_QUOTA_EXHAUSTED=1`）/ resetAt 透传
- **PlanPort**：getPlans 返三档 / upgrade 后 account.plan='paid' + paidExpiresAt
- **BuiltinLlmPort**：带 JWT header / 401 触发 refresh 重试一次 / refresh 失败抛 SessionExpired
- **di 二级代理**：`keySource='byok'` 时 sttProxy/llmProxy 路由到原 adapter 不走 BuiltinPort（断言不读 JWT、不调 refresh）

### 6.3 浏览器 e2e（390×844，npm run dev，VITE_AIJI_BACKEND=mock）

1. 游客注册→onboarding→home（回归 Slice A 不破）
2. settings"升级为网络账号"→填邮箱密码→bindNetwork→account 段显"网络/免费"+ keySource 行可切
3. settings 退出登录→/login→网络登录→home（onboarded 已 true 不再走 onboarding）
4. settings 切 keySource=builtin→采集一条→额度行 N+1
5. `VITE_AIJI_MOCK_QUOTA_EXHAUSTED=1` 重启→采集→toast"额度已用完"
6. 切 keySource=byok（未配 key）→采集→条目 failed 显配置引导 + "注册网络账号用免费额度"链接
7. plans sheet→选 Monthly→升级成功 toast→account 段显"付费"
8. `VITE_AIJI_MOCK_SESSION_EXPIRED=1` 重启→登录→采集→toast"登录已过期"→跳 /login
9. 游客→keySource 行 disabled
10. 游客 byok 未配 key→采集失败提示含"注册网络账号"链接→点→/login 网络注册 toggle
11. VLM 回归：byok 配 vlmKeyRef→含图条目走 VLM 多模态分类（现状不破）；切 builtin→含图条目走纯文本分类（退化确认）

### 6.4 回归重点

v1.5 采集重设计（多 part/草稿/回收站）、chat 两轮 LLM、VLM 多模态分类——`keySource='byok'` 路径必须与现状逐字节一致（di 二级代理是风险点，单测覆盖 byok 不走 BuiltinPort、不读 JWT）。processEntry STT 判据改动需回归：byok 配 stt:key 跑终稿、byok 未配跳过、builtin 跑终稿走 JWT。

---

## 7. 后续切片（不在本次）

- **Slice C**：云备份上传/下载 + VLM 内置代理 + 真实支付渠道接入 + ICP 备案/合规实装
- **Slice D**：多端实时同步（远期）
- 形式化 AuthPort/BuiltinLlmPort/QuotaPort/PlanPort 进 ports barrel 已在本次做；后端实装时填真实适配器替换 mock
