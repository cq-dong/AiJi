# AiJi · AI 记 — 工程自述

> 本文件是给 Claude Code（及任何 AI 协作者）的项目指令。产品 spec 见
> `docs/superpowers/specs/2026-07-15-aiji-design.md`（PRD，8 节）。
> 这里只写**非显而易见、承重**的工程约束与产品铁律。

## 1. 产品身份铁律（不可动摇）

- AiJi（AI 记）= 通用的「记」的工具，**不是日记**。条目异构：生活片段 / 跳脱想法 / 项目进展。
- **类别由内容涌现**，不预定大类。"生活/想法/项目" 只是举例说明异构，**不是固定枚举**；LLM 从内容发现类别，用户可策展（合并/重命名/新增）。**别硬编码具体类别集。**
- **情绪不是轴**。情绪只是众多可被 LLM 检测的**可选侧面**之一，不当独立导航轴、不当强制采集字段。
- 身份稳定（非日记 / 异构捕获 / 分类涌现），具体类别集由用户内容决定。

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

**当前阶段（UI 层）**：端口走 **mock 适配器**（返回 `src/data/seed.ts` 原型样例数据），真实 Capture/STT/LLM 后续接入。并行铺屏不被 I/O 集成阻塞。

## 3. 目录布局

```
src/
  ui/
    layout/        AppShell.tsx (MainLayout + BareLayout)
    components/    design-system 原语（共享，只读给屏实现）
    screens/       home/ capture/ detail/ categories/ summary/ search/ settings/ onboarding/
                   每个目录 index.tsx default-export 主组件（router lazy-import 目录）
  app/             router.tsx, store.ts(Zustand), query.ts(TanStack), di.ts(端口注入根)
  domain/          types.ts (Entry/EntryAi/Category/Tag/Aggregate/Settings, 零 I/O)
  ports/           index.ts (5 个端口接口)
  adapters/        mockStorage.ts (mock 适配；真实适配后续加)
  data/            db.ts (Dexie schema), seed.ts (12 条样例 + 类别/标签/聚合)
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
- 主路由（有 nav+FAB）：`/`（home）、`/categories`、`/summary`、`/search`、`/settings`
- 裸路由（仅 statusbar，无 nav/FAB）：`/capture`、`/detail/:id`、`/onboarding`

## 8. 协作铁律（lead 视角）

- **leader 负责 commit/push**；子智能体写完代码 + 自测只回报「完成」，**不自行 commit/push**。git push to origin 需 `git -c http.version=HTTP/1.1 push`（本机 HTTP/2 framing 坏）。
- **共享 tree 防撞**：每个子智能体只写**自己的** `screens/<x>/` 目录，不碰 `components/`、`router.tsx`、`AppShell.tsx`、`data/`、`domain/`、`ports/` 或他人屏目录。共享读自由。
- **code review 交专门 agent**，lead 不亲审；reviewer 兼前后端联合测试（chrome-devtools-mcp + Playwright，390×844）。
- 写完代码**必验收**，不因动态调度省略质量门。
- 队友无 per-member 记忆；持久知识须回流本文件或 `docs/`，别让队友"记住 X"。
- **验收/截图不入根目录**：浏览器截图（chrome-devtools-mcp / Playwright）一律存 `.e2e_shots/`（已 gitignore，可再生）。**禁止**把 `*.png` 直接丢仓库根目录污染 tree——根目录 `/*.png` 已被 gitignore 拦截，但源头靠自觉。

## 9. Figma

原型 24 屏，fileKey `ryEAeBu5Kd3QdltTOQSVIj`（**22 字符，逐字打对**——打错会报 "don't have edit access"，别误判为配额耗尽）。页 "原型 v2 — AiJi"（nodeId `0:1`）。读用 `get_design_context` / `get_screenshot` / `get_metadata`；写用 `use_figma`（JS via Plugin API）。

## 10. 待验假设（PRD §7.4，可能改 MVP 范围）

- A1：移动端 PWA（iOS Safari / Android Chrome）能否稳定采麦克风/摄像头。
- A2：浏览器本地能否存视频（IndexedDB/OPFS 不被清/不爆配额，iOS 尤甚）。
- A1/A2 不过 → 走 Capacitor 原生壳（架构已留退路）或砍视频。

## 11. 常用命令

```sh
npm run dev          # http://localhost:5173（视口 390×844 调试）
npm run typecheck    # tsc -b（lead 集成用）
npm run build        # tsc -b && vite build
```
