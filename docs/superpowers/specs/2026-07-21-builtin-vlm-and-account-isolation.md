# 内置多模态 + 本地账号分区 — 实施计划（2026-07-21）

> 用户验收发现两个设计缺口，均已获批修复方向：
> 1. 内置路径（免费额度/会员/24h 试用）无多模态 → 图片条目不被正常处理（builtinLlm VLM 剥离，spec §4.7 退化）
> 2. 不同账号登录同一设备数据互串 → 本地库无 owner 概念

## A. 内置 VLM（多模态图片理解）

### A1 后端 `server/`（agent-1）

- 新路由 `POST /api/vlm/chat`（`server/src/routes/vlm.ts`，镜像 `llm.ts` 结构）：
  - JWT auth 中间件拿 userId → 读今日 quota → `llm_used < llm_limit`（-1 无限）→ 超限 429
  - 预扣 `consumeLlm(1)` → 转发 DashScope compatible-mode
    `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
    （Bearer `DASHSCOPE_KEY`，与 STT 同 key）
  - model：env `VLM_MODEL`，缺省 `qwen-vl-max-latest`
  - messages **原样透传**（含 image_url 多模态 content 数组），max_tokens 1024，temperature 0.3
  - 上游失败回滚 `consumeLlm(-1)`，不透传上游错误体（防 key 侧信息泄露），返 `{error:'VLM_<status>', message}`
  - 成功返 `{reply: string}`（取 choices[0].message.content；若返数组形态则拼接 text 段）
- body 上限：nginx 已 `client_max_body_size 20m`；Hono 侧确认不另设小上限（base64 图单条约 1-3MB）
- `.env.example` 加 `VLM_MODEL=`；`server/.env`（远程）部署时加 `VLM_MODEL=qwen-vl-max-latest`
- curl 验证：本机起 server → register → 带 base64 小图 POST /api/vlm/chat → 返中文描述 + quota llmUsed +1

### A2 前端 `builtinLlm`（agent-2）

- `src/adapters/builtinLlm.ts` classify 镜像 `openAiCompatLlm.ts:484-540` 视觉块：
  - `collectEntryImages`（openAiCompatLlm 导出，缺 export 则补）抽图；`settings.videoVisionEnabled` 同样守门
  - hasImages → `buildPrompt(..., true, locationAddress)`（builtin 之前漏传 locationAddress，一并镜像补上）
  - user message content 升级为 `[textPart, ...imageParts]`（imgNote 文案逐字抄 BYOK）
  - `chat()` helper 加 path 参数：hasImages → `/api/vlm/chat`，否则 `/api/llm/chat`；401 refresh 单飞逻辑不变
  - 降级镜像 D14/D17：vlm 端点非 OK 且有文本 → 去图走 `/api/llm/chat` 重发；纯图无文本 → throw（不幻觉分类）
  - `parseJson` 已解 mediaDescription → EntryAi 构造补上 `mediaDescription: parsed.mediaDescription`（镜像 BYOK 同段）
  - classify 附图调用同样只 `consume('llm', 1)`（VLM 计入 LLM 额度，产品已定）
- `aggregate`：镜像 `openAiCompatLlm.ts:611-618`，按 part 真实统计 imageCount/videoCount 并透传
  `ai?.mediaDescription`（现硬编码 0/0 → 聚合媒体备注在内置路径永远缺席）
- `src/domain/plan.ts` features 文案：free 加「图片理解」、monthly 「VLM 多模态（远期）」→「图片/视频理解」、yearly 不变
- 单测：`builtinLlm.test.ts` 加含图条目用例（断言走 /api/vlm/chat、mediaDescription 落 EntryAi、纯图降级 throw）

## B. 本地账号分区（agent-3）

- `src/domain/types.ts`：`Entry` / `Category` / `Tag` / `Aggregate` / `Reminder` / `Conversation`
  加 `ownerId: string`（`'local'` | network account.id）。drafts/settings/media 保持全局（设备级）
- 新 `src/app/currentOwner.ts`：`getCurrentOwner()/setCurrentOwner(id)`，缺省 `'local'`。
  storage 适配器读它过滤；accountStore 在 hydrate/login/logout 时 set
- `src/data/db.ts`：`version(7)`，上述 6 表加 `ownerId` 索引（entries 现有索引逐字保留 + 加 ownerId），
  `upgrade()` 回填全部存量行 `ownerId='local'`
- `dexieStorage.ts`（38 方法，机械改造）：
  - 分区表的 list/get/save/delete/trash/recover/purge 一律按 `getCurrentOwner()` 过滤/盖章
  - save 时 `ownerId = getCurrentOwner()`（防调用方漏传）；get 单条也校验 owner（防跨账号 id 直读）
  - 新 `adoptLocal(accountId)`：把全部 `ownerId='local'` 的行改盖为 accountId（6 表事务）
- `StoragePort`（`src/ports/index.ts`）加 `adoptLocal(accountId: string): Promise<void>`；`mockStorage.ts` 同步实现
- `accountStore.ts`：login/register 成功 → `setCurrentOwner(account.id)` → `di.storage.adoptLocal(account.id)`
  （未登录期间的 local 数据由下次登录者收养——单用户手机语义，多用户共用设备不在本期）
  logout → `setCurrentOwner('local')`
- `seed.ts`：全部种子行补 `ownerId: 'local'`
- 单测：分区隔离（A/B 两 owner 互不可见）+ adoptLocal 迁移 + 存量行回填

## 防撞分工

| agent | 独占文件 |
|---|---|
| agent-1 server | `server/**`（本机验证；部署 lead 做） |
| agent-2 前端 VLM | `src/adapters/builtinLlm.ts`、`src/adapters/openAiCompatLlm.ts`（仅补 export）、`src/adapters/__tests__/builtinLlm.test.ts`、`src/domain/plan.ts` |
| agent-3 账号分区 | `src/domain/types.ts`、`src/app/currentOwner.ts`、`src/data/db.ts`、`src/data/seed.ts`、`src/adapters/dexieStorage.ts`、`src/adapters/mockStorage.ts`、`src/app/accountStore.ts`、`src/ports/index.ts`、相关测试 |

agent-2 与 agent-3 无文件交集（builtinLlm 只经 di.storage 接口调 storage，签名不变）。

## 集成与验收（lead）

1. 三 agent 自报完成 → `npm run typecheck` + `npm run test:run` + `cd server && npx tsc`
2. reviewer agent：静态审 + 浏览器 e2e（390×844）
3. 部署后端：`rsync server/` → 远程 `npm ci --omit=dev && npm run build` → pm2 restart → curl /api/vlm/chat 冒烟
4. bump `2.0.1-rc3` → tag push → CI prerelease → app 内更新
5. 真机终验：注册新号 → 记图片条目 → 出分类+媒体理解；登出换号 → 数据隔离；原号登回 → 数据还在
