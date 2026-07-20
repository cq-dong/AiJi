# 账号体系 · Slice A 实现计划（客户端先行）

> 分支：`worktree-feat-account-system`（隔离 worktree，基线 v1.5 tip `18b7fb6`）
> 范围：登录页 UI + 游客本地注册 + settings "切换网络账号" 入口（stub）
> 不在本切片：后端、网络真注册、权益包额度、云备份、§11 决策
> 依据：`docs/design/account-system.md` §1/§2/§8 + 本次讨论决议

---

## 0. 决议（本次讨论锁定）

1. **分支策略**：隔离 worktree 从 v1.5 tip 切，不与他人 in-flight 改动同树。
2. **切片**：A 客户端先行，网络调用全 stub 成"暂未开通"。
3. **数据模型**：**单一本地池 + 账号身份叠加**。账号是 localStorage 里一条身份记录，**不是数据分区键**；Dexie 数据不做账号级隔离；网络账号绑定=把当前本地池关联到该账号（用于远期备份），数据不搬、不复制、不切换。
4. **账号存储**：localStorage（同 `localStorageSecrets` 套路），**不动 Dexie schema、不动 `db.ts`/`dexieStorage.ts`/`seed.ts`/`domain/types.ts` 的 Settings**。
5. **不碰 §11**：定价/后端栈/额度值/iOS 策略全部留到后续切片。

---

## 1. 数据模型

新增 `src/domain/account.ts`（不动既有 `types.ts`）：

```ts
export type AccountType = 'guest' | 'network'
export type AccountPlan = 'guest' | 'free' | 'paid'   // 权益档

export interface Account {
  id: string            // crypto.randomUUID()
  type: AccountType
  nickname: string
  email?: string        // network only（远期）
  plan: AccountPlan     // guest→'guest'；网络注册→'free'；付费→'paid'（远期）
  createdAt: string     // ISO
  boundAt?: string      // 绑定网络账号时间（远期）
}
```

单条记录，localStorage key `aiji:account`。无多账号、无账号列表（YAGNI）。

---

## 2. 文件清单与冲突审计

### 新增（零冲突）
| 文件 | 职责 |
|---|---|
| `src/domain/account.ts` | Account 类型，纯 TS 零 I/O |
| `src/adapters/localAccount.ts` | localStorage 读写 Account，镜像 `localStorageSecrets` try/catch 静默降级 |
| `src/app/accountStore.ts` | 极小 Zustand store：`account`/`hydrated`/`registerGuest(nickname)`/`logout()`/`hydrate()` |
| `src/ui/screens/login/index.tsx` | 登录/注册页：游客注册（可用）+ 网络注册（stub "暂未开通"） |
| `src/ui/screens/settings/AccountSection.tsx` | 自包含账号段：当前账号信息 + 切换网络账号(stub) + 退出登录 |

### 编辑
| 文件 | 改动 | 冲突风险 |
|---|---|---|
| `src/app/router.tsx` | 加 `/login` 路由（BareLayout）+ `AccountGate`（无 account→重定向 /login），包在 `OnboardingGate` 外层 | 低（他人 M 名单无此文件） |
| `src/main.tsx` | boot 时 `accountStore.getState().hydrate()` | 低（他人 M 名单无此文件） |
| `src/ui/screens/settings/index.tsx` | 插一行 `<AccountSection />` + 一行 import，放在"AI 模型"段前 | **中**（他人 M 名单有此文件）；自包含组件，编辑面仅 2 行，合并时加性冲突易手解 |

### 不动
`domain/types.ts` 的 Settings、`ports/index.ts`、`app/di.ts`、`data/db.ts`/`seed.ts`、`adapters/dexieStorage.ts`、onboarding、capture/chat 屏。账号不走 Port 抽象（YAGNI，后端落地再形式化）。

---

## 3. 流程

### 首次启动（无 account）
1. `main.tsx` → `accountStore.hydrate()`（从 localStorage 读 account，无则 null）
2. `AccountGate` 见 `hydrated && !account` → 重定向 `/login`
3. `/login` 游客注册：输入昵称（可空，默认"我"）→ `registerGuest(nickname)` 生成 Account(type='guest', plan='guest') 写 localStorage → `navigate('/onboarding')`
4. `/onboarding`（既有，不动）→ 权限 + 可选 BYOK → `onboarded=true` → home

### 二次启动（有 account，已 onboarded）
- `AccountGate` 放行 → `OnboardingGate` 放行 → home

### 二次启动（有 account，未 onboarded，理论上不会发生但兜底）
- `AccountGate` 放行 → `OnboardingGate` 重定向 `/onboarding`

### settings → 账号段
- 显示：昵称 · 类型（游客/网络）· 权益档
- "切换网络账号" → 底部 sheet 提示"网络账号功能暂未开通，敬请期待"（仅确认按钮）
- "退出登录" → `logout()` 清 localStorage account → `navigate('/login')`

---

## 4. gate 顺序

```
<AccountGate>        // 无 account → /login
  <OnboardingGate>   // 无 onboarded → /onboarding（既有）
    <Routes>...</Routes>
  </OnboardingGate>
</AccountGate>
```

`AccountGate` 仅在 `accountStore.hydrated` 后判定，避免 hydrate 前误闪。

---

## 5. 验收

1. **typecheck**：`npx tsc -p tsconfig.app.json`（按 CLAUDE.md 用 app 配置，不跑 `tsc -b` 抢缓存）
2. **浏览器 e2e**（视口 390×844，`npm run dev`）：
   - 清 localStorage → 首启落 `/login` → 游客注册（昵称"测试"）→ 落 `/onboarding` → 完成 → home
   - 刷新 → 直达 home（account 在，onboarded 在）
   - settings 见"账号"段：昵称"测试"·游客·guest 档
   - 点"切换网络账号" → stub sheet "暂未开通"
   - 点"退出登录" → 落 `/login`；刷新仍 `/login`（account 已清）
   - 网络注册按钮 → stub 提示
3. **回归**：既有 onboarding/采集/chat/settings 其余段不受影响（未改其文件）

---

## 6. 后续切片（不在本次）

- Slice B：后端搭建（§11 后端栈先定）+ 网络真注册 + JWT + 内置 key 代理 + 免费额度
- Slice C：权益包定价 + 付费 + 云备份上传/下载
- Slice D：多端实时同步（远期）
- 形式化 AuthPort/BuiltinLlmPort/BackupPort 进 ports barrel（届时与各适配器一并接）
