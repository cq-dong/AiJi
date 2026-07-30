# AiJi · 账号中心 + 付费（兑换码）+ 云端同步 设计

> 2026-07-29 · 讨论输出（brainstorm → spec）。用户提出个人中心四大缺口，逐项对齐后成文。
> 范围：账号信息/修改密码（小）、付费（兑换码 interim）、云端同步（架构级）。
> 实施分 **Phase 1（§1 账号中心 + §2 兑换码，快出）** 与 **Phase 2（§3 云端同步）**。

---

## 0. 背景与四大缺口

用户审个人中心（AccountSection）发现的缺口：
1. 只有头像+昵称，**看不到账号信息**（邮箱/注册时间/套餐明细）。
2. **没有修改密码**入口。
3. **付费未真实设置**——`/api/plan/upgrade` 是 stub（只返回订单号、不写 users 表），
   `accountStore.upgradePlan` 只把 `plan='paid'` 写进本地 localStorage，后端 DB 永不知 →
   账号页显示「年度会员」（本地）但 `/api/quota` 仍按 free 算 120s → **两数据源不同步的 bug**。
4. **缺少云端同步**——条目+媒体本地优先（IndexedDB/OPFS），无云端备份，丢机即丢数据。

附加发现（本 session 已修/另案）：
- STT >1min 录音崩（EBML 容器损坏）→ 已修 `webCapture` timeslice=1000（rc10）。
- STT 失败（429/502）被 processEntry 吞掉 → classify 抛「条目无文本」顶包 → 用户看到误导的「无可用文本」。**本 spec §1/§2/§3 之外单列 §4 修这个 UX 掩盖。**

## 0.1 已定的关键决策（讨论结论，不再动摇）

| 决策点 | 结论 |
|---|---|
| 同步信任模型 | **服务器可读 + 媒体同步**（非 E2EE） |
| 同步时机 | **用户开关控制**；开=自动（保存即推+打开即拉+定时兜底，REST，无长连接/无手动按钮）；关=纯本地 |
| 同步范围 | **全量用户数据**（条目+媒体+类别/标签+草稿+回收站+提醒）；**不含** BYOK 密钥（留设备）、聚合缓存（可重算） |
| 冲突模型 | 按行 **last-write-wins（updatedAt）+ 软删 tombstone**（单人多端，不做 CRDT） |
| 付费路线 | **兑换码模式（interim）**——绕开商户号+HTTPS 回调；真支付接入时替换 redeem 实现，前端不动 |
| 媒体存储 | **腾讯云 COS**（服务器同在腾讯云，同区免内网流量费） |
| SQLite 单点 | 加 **cron 每晚 dump `aiji.db` 到 COS** 备份 |
| 密钥 | BYOK llm/stt/vlm:key **永不同步**，留设备本地 |

---

## §1 账号中心 UI + 修改密码 + 注销账号（Phase 1）

### 1.1 个人中心改版（不新增屏，复用 settings 页 AccountSection 分组重排）

```
[头像]  昵称（可点改）            网络账号 / 游客
─────────────────────────────────
账号
  邮箱    d••••@qq.com（脱敏，点可显全）
  注册    2026-07-26
  套餐    年度会员 · 至 2027-07-29   [额度详情]
订阅
  当前    年度会员 / 免费版 / 试用中（至 X）
  额度    LLM 3/-1 · STT 54/-1 · 聚合 0/-1   [点开 QuotaSheet]
  升级    [升级套餐]  [输入兑换码]
安全
  修改密码
  退出登录
  注销账号（删本地+云端全部数据）
AI 来源
  Key 来源  内置 / BYOK   （现有，保留）
```

- 邮箱脱敏：本地首字符 + `••••` + @domain，点开显全。
- 套餐行：resolveLimits 同源，避免「本地年度 + 后端 free」再出现（见 §2.4 落库修复）。

### 1.2 修改密码

- 后端 `POST /api/auth/change-password {oldPassword, newPassword}`（JWT）：
  - `bcrypt.compare(old, users.password_hash)` 失败 → `AUTH_401 旧密码错误`。
  - `newPassword.length < 8` → `AUTH_400 新密码至少 8 位`。
  - 通过 → `UPDATE users SET password_hash=bcrypt(new, 12)` → **作废该用户全部 refresh_tokens**（强制其他设备重新登录）。
- 前端：AccountSection「修改密码」→ sheet（旧/新/确认）→ 成功 → 清本地 session → 跳登录页（自己的 refresh 也被作废）。

### 1.3 注销账号（云端同步上线后必需，隐私+合规）

- `POST /api/account/delete {password}`（JWT）：二次确认密码 → 后端**硬删**该用户的
  `users` + `entries` + `entry_media` + `refresh_tokens` + `quotas` + `categories` + `tags` +
  `reminders` + `drafts` + COS 媒体文件。
- 前端：确认弹窗（输密码 + 风险提示「不可恢复」）→ 成功后清本地 Dexie/OPFS → 回登录页。
- Phase 1（同步未上）时云端无条目，删除范围 = users/refresh_tokens/quotas + 本地数据。

---

## §2 付费：兑换码模式（Phase 1）

### 2.1 目标

绕开商户号 + HTTPS 回调，跑通「发码→充值→生效」闭环。真支付（微信/支付宝）接入时
**只替换 redeem 实现**（加下单/webhook），前端 + 用户侧不动。

### 2.2 后端

新表：
```sql
CREATE TABLE IF NOT EXISTS redeem_codes (
  code TEXT PRIMARY KEY,           -- 'AIJI-XXXX-XXXX-XXXX'
  plan_id TEXT NOT NULL,           -- 'monthly' | 'yearly'
  duration_days INTEGER NOT NULL,  -- 30 | 365
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,                 -- 码本身过期（防长期有效），NULL=不过期
  note TEXT,                       -- 管理员备注（'内测群A'）
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS redeem_logs (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redeemed_at TEXT NOT NULL
);
```

`POST /api/plan/redeem {code}`（JWT）→ **事务**内：
1. 查码：不存在/已过期 → `AUTH_404 兑换码无效或已过期`；`used_count >= max_uses` → `AUTH_409 兑换码已用尽`；格式不符 → `AUTH_400`。
2. `UPDATE users SET plan='paid', paid_plan_id=plan_id, paid_expires_at=now+duration_days`。
3. `used_count++`；写 `redeem_logs`。
4. 返更新后的 **account**（前端覆盖本地，保证本地=后端）。

### 2.3 管理员发码（interim 不做后台 UI）

- 服务器 CLI：`node scripts/gen-redeem-code.js --plan=yearly --count=10 --note=内测群A`
  → 批量生成 + 打印码列表。手动分发（微信/群贴码）。
- 兑换码**默认单次用**（`max_uses=1`）。多次用（一码多人）改 `max_uses`，CLI 支持 `--max-uses=N`。

### 2.4 顺手修 stub 不落库 bug

`/api/plan/upgrade`（旧 stub）**保留路径**（兼容已有前端 `upgradePlan` 调用），但内部
**改为真落库**（同 redeem 的 `UPDATE users` 写法），不再只返回订单号不写库——根治
「账号页显示年度、后端仍 free」的数据源不同步。`upgradePlan` 前端改用返回的 account 覆盖本地。

### 2.5 配额生效

redeem/upgrade 落库后 `resolveLimits` 看到 `plan='paid'` + 未过期 `paidExpiresAt` →
返回对应 tier 限额（monthly: STT 1800s / LLM 300 / agg 50；yearly: 全 -1 无限）。

### 2.6 前端

- PlansSheet 加「输入兑换码」入口 → sheet（单输入框+确认）→ `di.plan.redeem(code)` →
  成功 toast「已激活{套餐}，至 YYYY-MM-DD」+ accountStore 覆盖本地 account + quota refresh。
- AccountSection「订阅」区区分显示「试用 / 兑换码激活 / 升级」来源 + 到期日。

---

## §3 云端同步（Phase 2，架构级）

### 3.1 开关语义

Settings 加「云端同步」toggle（存 `settings.syncEnabled`，per user）：
- **关** = 纯本地（现状，云端零写入）。
- **开** = 自动同步：**保存即推 + 打开 App 即拉 + 每 5min 定时兜底**（REST，无 websocket 长连接、无手动按钮）。离线可写、联网补传。

### 3.2 后端新增表

```sql
CREATE TABLE IF NOT EXISTS entries (
  id TEXT, user_id TEXT, parts TEXT,        -- parts JSON（含 part.ref→cos_key 映射后）
  title TEXT, location TEXT, status TEXT, ai TEXT,
  created_at TEXT, updated_at TEXT, deleted_at TEXT,  -- deleted_at 非空=tombstone
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS entry_media (
  ref TEXT, user_id TEXT, entry_id TEXT,
  cos_key TEXT, mime TEXT, size INTEGER,
  PRIMARY KEY (user_id, ref)
);
-- categories / tags / reminders / drafts：镜像本地模型 + user_id + updated_at + deleted_at
CREATE TABLE IF NOT EXISTS sync_state (user_id TEXT PRIMARY KEY, last_sync_at TEXT);
```

### 3.3 同步协议（REST）

- **推 push**：本地改动（保存/编辑/删除条目、存草稿、类别/标签/提醒变更、回收站增删）进
  pending 队列 → 联网 debounce 批量 `POST /api/sync/push {changes: [...]}`。
  - 媒体：条目含媒体时先 `POST /api/sync/media/presign`（拿 COS 预签名 PUT URL）→
    PUT blob 到 COS → 再 push 条目（part.ref 映射到 cos_key）。
- **拉 pull**：打开 App + 定时 → `GET /api/sync/pull?since=lastSyncAt` →
  服务端返游标后变更（含 tombstone）→ 应用本地 + 更新 sync_state。
- **冲突**：按行 LWW——push 带 updatedAt，服务端比 `entries.updated_at`，新者胜；
  tombstone（deleted_at）优先于 updated_at。败方随下次 pull 拉回胜方版本。不做 CRDT。
- **离线**：离线写照常落 Dexie，push 队列滞留；重连自动 flush；pull 失败静默下个周期重试。
- **首启迁移**：开同步时把现有本地条目+媒体批量上传（分批 + 进度条），之后转增量。

### 3.4 配额 / 成本

- 同步**不吃** LLM/STT 配额（纯存储/CRUD）。
- 媒体存储按套餐限：`PLAN_TIERS.limits` 加 `storageLimitBytes`（free 200MB / monthly 5GB /
  yearly 20GB）。超限提示升级、**不删数据**。
- COS + 服务器同在腾讯云，同区免内网流量费；公网下载流量按 COS 计（小站可忽略）。
- **SQLite 单点**：cron 每晚 `sqlite3 aiji.db ".backup ..."` → 上传 COS（媒体另在 COS 持久）。

### 3.5 隐私 / 安全

- 服务器可读（决策已定）。**生产前必须上 HTTPS 域名**（当前 IP+HTTP 仅开发，同步上生产
  不可明文跑）。
- BYOK 密钥 / 聚合缓存**不同步**。
- 注销账号（§1.3）删云端全部表 + COS 文件。

### 3.6 验收

双设备 A/B：
- A 开同步建条目 → B 拉到可见；A 删 → B 消失（tombstone）；A 编辑 → B 拿到新版（LWW）。
- 离线写 → 重连 push 成功；媒体上传/下载回显；首启迁移进度条跑完转增量。

---

## §4 修 STT 失败被「无文本」掩盖（Phase 1，UX bug）

processEntry 里 STT 失败（429 额度 / 502 转码）被 per-part catch 吞掉（`store.ts`），
若 WebSpeech 预览也为空（Android >60s 崩）→ classify 抛「条目无文本/媒体可分类」→
用户看到误导的「条目无可用文本」。

**修**：processEntry 记录每个 part 的 STT 失败原因；当 classify 因「无文本」失败且存在
STT 失败且无回退文本的 part 时，把 **STT 原始错误**（「STT 额度已用完」/「转码失败」/
「STT 超时」）作为 `processError`，不再让 classify 的「无文本」顶包。detail 页
FailedBody 的 `fail.reason` 分支自然显示真实原因。

---

## 范围外（不在本 spec）

- 真实支付（微信/支付宝下单+webhook）——等域名+HTTPS+商户号后替换 redeem 实现。
- E2EE（端到端加密同步）、CRDT 冲突合并、同步后台管理 UI、双设备实时协同。
- HTTPS 域名申请 + 证书（同步上生产的前置，另行处理）。
- Postgres 迁移（用户规模上来后再议）。

## 实施分 Phase

- **Phase 1（快出）**：§1 账号中心 + §2 兑换码 + §4 STT 掩盖修复。
- **Phase 2（架构级）**：§3 云端同步。
