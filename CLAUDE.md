# AiJi · AI 记 — 工程自述

> 本文件是给 Claude Code（及任何 AI 协作者）的项目指令。产品 spec 见
> `docs/superpowers/specs/2026-07-15-aiji-design.md`（PRD，8 节）。
> 这里只写**非显而易见、承重**的工程约束与产品铁律。
>
> **联动**：后端 / i18n / 测试 / git / agent 协作流程见 `AGENTS.md`（跨 agent CLI
> 协作指令）。两文件互补、互引——改承重约定查对方是否需同步。详见 `AGENTS.md` §0。

## 1. 产品身份铁律（不可动摇）

- AiJi（AI 记）= 通用的「记」的工具，**不是日记**。条目异构：生活片段 / 跳脱想法 / 项目进展。
- **类别由内容涌现**，不预定大类。"生活/想法/项目" 只是举例说明异构，**不是固定枚举**；LLM 从内容发现类别，用户可策展（合并/重命名/新增）。**别硬编码具体类别集。**
- **情绪不是轴**。情绪只是众多可被 LLM 检测的**可选侧面**之一，不当独立导航轴、不当强制采集字段。

## 2. 栈与架构（PRD §7.3）

React 19 + Vite 8 + TypeScript（strict）+ Tailwind v3 + react-router-dom 7 + Zustand + TanStack Query + Dexie（IndexedDB）+ OPFS（媒体，后置）。单测 Vitest；E2E Playwright / chrome-devtools-mcp，视口 **390×844**。

分层 + 端口（PWA 无关，Capacitor 退路）：

```
UI 层 (React)          纯展示+视图状态，无 I/O
应用层 (Zustand+TanQuery) 视图状态 / 编排 / 采集→落库→入队
Domain 层 (纯 TS，零 I/O)  条目模型 / 涌现分类规则 / 标签去重
Port 端口 (接口)          CapturePort/SttPort/StoragePort/LlmPort/SecretStorePort
适配层 (PWA 实现)         DexieStorage · WebSpeech+getUserMedia · Whisper云 · Claude云(BYOK)
处理管线 (后台、可恢复)    保存即落库→AI 入队；断网不丢；LLM 失败只伤 AI 层
```

**关键隔离**：Domain + Port 不绑 PWA API。移动端 PWA 采集/存储不过 → 只换 CapturePort/StoragePort 的 Capacitor 适配器，UI/Domain/管线不动。

**适配现状**：PWA 适配器已落地（DexieStorage 存储、WebCapture 采集、Paraformer STT、OpenAI 兼容 LLM、VLM 视觉、httpAuth/httpPlan/httpQuota 云端对接）；`src/data/seed.ts` 样例仍用于 onboarding / 空态兜底。Capacitor 适配器（原生通知/APK 自更新/文件分享）在 `src/adapters/*Plugin.ts`。

## 3. 目录布局

```
src/
  ui/
    layout/        AppShell.tsx (MainLayout + BareLayout)
    components/    design-system 原语（共享，只读给屏实现）
    screens/       home/ capture/ detail/ categories/ summary/ search/ chat/ settings/
                   onboarding/ drafts/ trash/ reminders/ login/ feedback/
                   每个目录 index.tsx default-export 主组件（router lazy-import 目录）
  app/             router/store/query/di + i18n/ + session/accountStore/quotaStore
  domain/          types/account/plan/quota/dateRange（纯 TS，零 I/O）
  ports/           index.ts (5 个端口接口)
  adapters/        PWA + Capacitor 适配（dexieStorage/webCapture/builtinLlm/...）
  data/            db.ts (Dexie schema), seed.ts (样例 + 类别/标签/聚合)
```

## 4. 设计 tokens（源：tailwind.config.js）

颜色 class：`bg-page`(#f7f7fa) · `bg-card`(#fff) · `text-ink`(#14141a) · `text-t2`(#6b6b75) · `text-t3`(#9a9aa5) · `bg-pri`/`text-pri`(#4f46e5) · `bg-priS`(#eeedfd) · `border-brd`(#ececef)。
类别强调色（涌现，仅原型示意，勿硬编码语义）：`catIdea` #4f46e5 · `catProject` #0d9488 · `catPending` #d97706 · `catFail` #dc2626。
圆角：`rounded-card`(16) · `rounded-chip`(11) · `rounded-btn`(12) · `rounded-fab`(28) · `rounded-screen`(32)。
字体 Noto Sans SC。字号层级：屏标题 34/Bold（「记」）/ 页标题 24/Bold / 区段 17/Bold / 卡标题 14/Medium / 正文 13/Regular / 辅助 11-12 / 导航 10/Medium。屏内左右 16px 边距（`px-4`）。

## 5. 共享 API（屏实现 import，勿改源文件）

- 原语：`import { Button, Card, Chip, Skeleton, Spinner, EmptyState, Statusbar, NavBottom, Fab, cn } from '@/ui/components'`
- 样例数据：`import { seedEntries, seedEntryAi, seedCategories, seedTags, seedAggregates, seedSettings } from '@/data/seed'`
- 类型：`import type { Entry, EntryAi, Category, Tag, Aggregate, Settings, EntryPart, Facets } from '@/domain/types'`
- UI 状态：`import { useUiStore } from '@/app/store'`（capture 草稿 parts/recording/saving/micDenied、online）

## 6. TypeScript 严格性（违反则 typecheck 挂）

- `verbatimModuleSyntax: true` → 类型 import **必须** `import type { ... }`（或内联 `import { x, type Y }`）。
- `erasableSyntaxOnly: true` → **禁** `enum`、构造函数参数属性、`namespace`。用字符串字面量联合 + `as const`。
- `noUnusedLocals` / `noUnusedParameters: true` → 无未用变量/参数。
- 路径别名 `@/` → `src/`（tsc `paths` + vite `resolve.alias` 均配）。
- **并行子智能体自检**用 `npx tsc -p tsconfig.app.json`，**不要**用 `npm run typecheck`/`tsc -b`（后者写共享 tsbuildinfo 缓存，并发会竞态）。lead 集成阶段才跑 `npm run typecheck`。

## 7. 布局契约

AppShell 已提供 Statusbar（顶）、NavBottom（主 tab 路由底）、采集 FAB（主 tab 路由）。**屏只渲染内容，不要重复画 statusbar/nav/Fab。**
- 主路由（有 nav+FAB）：`/`（home）、`/categories`、`/summary`、`/search`、`/reminders`、`/settings`
- 裸路由（仅 statusbar，无 nav/FAB）：`/capture`、`/detail/:id`、`/onboarding`、`/login`、`/drafts`、`/trash`、`/chat`、`/feedback`

## 8. 协作铁律（lead 视角）

- **leader 负责 commit/push**；子智能体写完代码 + 自测只回报「完成」，**不自行 commit/push**。
- **共享 tree 防撞**：每个子智能体只写**自己的** `screens/<x>/` 目录，不碰 `components/`、`router.tsx`、`AppShell.tsx`、`data/`、`domain/`、`ports/` 或他人屏目录。共享读自由。
- **code review 交专门 agent**，lead 不亲审；reviewer 兼前后端联合测试（chrome-devtools-mcp + Playwright，390×844）。
- 写完代码**必验收**，不因动态调度省略质量门。
- 队友无 per-member 记忆；持久知识须回流本文件或 `docs/`，别让队友"记住 X"。
- git push 坑（HTTP/1.1）、截图存 `.e2e_shots/` 等命令级细节见 `AGENTS.md` §8/§9。

## 9. Figma

原型 24 屏，fileKey `ryEAeBu5Kd3QdltTOQSVIj`（**22 字符，逐字打对**——打错会报 "don't have edit access"，别误判为配额耗尽）。页 "原型 v2 — AiJi"（nodeId `0:1`）。读用 `get_design_context` / `get_screenshot` / `get_metadata`；写用 `use_figma`（JS via Plugin API）。

## 10. 待验假设（PRD §7.4，可能改 MVP 范围）

- A1：移动端 PWA（iOS Safari / Android Chrome）能否稳定采麦克风/摄像头。
- A2：浏览器本地能否存视频（IndexedDB/OPFS 不被清/不爆配额，iOS 尤甚）。
- A1/A2 不过 → 走 Capacitor 原生壳（架构已留退路）或砍视频。

## 11. 常用命令

前端 + 后端完整命令见 `AGENTS.md` §4。核心：`npm run dev`（前端 5173）、`cd server && npm run dev`（后端）。

## 12. 发版与部署（APK release 实测流程）

**版本真源** = `package.json` version。CI「Sync version into gradle」从它写 versionName；
**tag 触发时断言 tag == package.json**，不一致直接失败（先 bump 再打 tag）。

**两种发版 tag**（`.github/workflows/build-apk.yml`）：
- `v2.0.1-rcN`（含 `-rc`）→ debug 签名 → GitHub **prerelease**（不取代 Latest，测试包）。
- `vX.Y.Z`（正式）→ release 签名（secret `ANDROID_KEYSTORE_BASE64` 解码 keystore）→ **Latest release**。

**发版流程**：`npm pkg set version=X.Y.Z` → commit（chore: bump/release）→ `git tag vX.Y.Z`
→ push 分支 + tag → CI 构建 → softprops/action-gh-release 发 `aiji.apk`。
**应用内更新**取 releases list[0] + compareSemver 判断是否提示更新；固定直链
`releases/latest/download/aiji.apk` 只有正式 tag 才指向。

**push 坑（本机必用）**：github.com smart-HTTP 在本机挂（HTTP/2 framing 坏），
credential-helper 在后台任务也会挂。统一用：
```sh
git -c http.version=HTTP/1.1 -c http.proxy=http://127.0.0.1:7897 \
  push "https://cq-dong:$(gh auth token)@github.com/cq-dong/AiJi.git" <branch> <tag>
```

**分支策略**：功能分支（`feat/*`）开发 → 发版分支（`vX.Y`）承载发布。
`feat/network-register → main` 的 PR 合并由用户控制，不擅自合。

**后端部署**（腾讯云 106.54.26.195，**平铺** `/opt/aiji`，pm2 进程 `aiji-api`）：
**严禁远端 `npm ci`**（会挂 25min 且先删 node_modules）。标准姿势：
```sh
cd server && npm run build   # 本机构建
sshpass rsync -az dist/ root@106.54.26.195:/opt/aiji/dist/
ssh root@106.54.26.195 'pm2 restart aiji-api'
```
改 env（如 CORS_ORIGINS/GAODE_KEY）→ sed 服务器 `.env` + `pm2 restart`。
服务器还跑着别的项目（onetoken/clash/codex），pm2 list 别误操作他人进程。
**ffmpeg-static 坑（2026-07-23 实锤）**：服务器上
`/opt/aiji/node_modules/ffmpeg-static/ffmpeg` 曾被截断（68.7MB vs 完整 78.7MB）+
丢执行位 → STT 全挂。凡动过服务器 node_modules，必验：
`ls -l`（权限 `-rwx`）+ `./ffmpeg -version`（能打印版本号）。
坏了就从 npmmirror 重下：`curl -sL https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.0/ffmpeg-linux-x64 -o ffmpeg && chmod +x ffmpeg`。

**密钥纪律**：`server/.env`（JWT_SECRET/REFRESH_SECRET/DEEPSEEK_KEY/DASHSCOPE_KEY/
GAODE_KEY）永不 commit、不打印值；前端 `.env.local` BYOK keys gitignored；
`release/`（本地 APK 产物）**永不 `git add`**。

**e2e 验收栈**：`npm run build && npm run preview -- --port 4173`（prod build 避免
DEV auto-seed）+ Playwright / chrome-devtools-mcp，视口 390×844。每个用例前清
SW + localStorage + IndexedDB；截图一律存 `.e2e_shots/`（gitignored，禁根目录 `/*.png`）。
