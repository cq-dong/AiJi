# Phase 7b 修理 fan-out — subagent 共享上下文

> 你是被派来修 AiJi 现有占位按钮/过滤的子代理。你没有记忆，本文档是你唯一的上下文。读完再动手。

## 背景

Phase 7a 已 commit（`99c12d5`）：DeepSeek LLM 分类管线端到端验通——文本/语音条目保存 → `processEntry` → DeepSeek classify → `EntryAi` 落 Dexie → home/detail/search/categories/summary 五屏从 store 响应式读 AI/类别/标签。

**但若干 UI 还是占位**（按钮点了没反应 / 过滤 chip 不真过滤）。本轮 fan-out 把它们接线成真行为。**STT 终稿（paraformer）已 deferred**（stash 里），本轮不碰 STT。

## store API（你可读，勿改 store.ts）

`import { useUiStore } from '@/app/store'`：

```ts
entries: Entry[]                    // 全部条目（seed 兜底，hydrate 后 Dexie 真实）
aiByEntry: Record<string, EntryAi> // key=entryId → 最高 version 的 AI
categories: Category[]              // 含涌现类别
tags: Tag[]                         // 含涌现标签
settings: Settings
processEntry: (entryId: string) => Promise<void>  // 重跑分类（含落库 + 刷新 store）
// processEntry 成功：entry status→ready、aiByEntry[id] 更新、categories/tags 重载
// processEntry 失败：entry status→failed
```

`Entry.status`: `'processing' | 'ready' | 'failed' | 'offline-pending'`。
`Entry.parts`: `EntryPart[]`，`EntryPart` 是 `{type:'text',content}` | `{type:'audio'|'video', ref, durationSec, transcript}`。
`EntryAi`: `{category, tags[], facets, titleSuggestion, summary, modelUsed, ...}`。
`Category`: `{slug, label, aliases[], usageCount, accent?, createdAt}`。`accent` 可空（UI 兜底默认色）。
`Facets`: `{mood?, person?[], place?, project?, event?}`——全可选，情绪只是可选侧面。

`import { di } from '@/app/di'`：`di.storage` 是 StoragePort（`getEntry(id)`/`getEntryAi(id)`/`listEntries()`/`listCategories()`/`listTags()` 等，仅读用得到）。

## 防撞铁律（违反则冲突）

**只写你自己那一份 `screens/<x>/` 目录。** 勿碰：`src/app/store.ts`、`src/app/di.ts`、`src/ui/components/`、`src/data/`、`src/domain/`、`src/ports/`、`src/adapters/`、`router.tsx`、`AppShell.tsx`，以及**别的屏目录**。共享读自由。

如发现你的修复**必须**改 store.ts（需要新 action），**停下别改 store.ts**——在回报里写明"需要 lead 加 store action X"，lead 会先加再重派。本轮三个任务都已确认**不需要新 store action**（都读现成字段 / 调现成 `processEntry`）。

## TS 严格性（违反则 typecheck 挂）

- `verbatimModuleSyntax:true` → 类型 import **必须** `import type { ... }`（或内联 `import { x, type Y }`）。
- `erasableSyntaxOnly:true` → **禁** `enum`、构造函数参数属性、`namespace`。用字符串字面量联合 + `as const`。
- `noUnusedLocals`/`noUnusedParameters:true` → 无未用变量/参数。
- 路径别名 `@/` → `src/`。
- **自检用 `npx tsc -p tsconfig.app.json`**，**不要**用 `npm run typecheck`/`tsc -b`（后者写共享 tsbuildinfo 缓存，并发竞态）。

## 你的任务（按派给你的屏目录）

### detail/ — 重处理/重试接线 + D8 返回兜底

现状：`detail/AiPanel.tsx` 的「重处理」按钮、失败态的「重试」按钮是占位（onClick 空/无）。stuck 在 `processing`/`failed` 的条目（Phase 2-6 留下的测试保存）无法重分类。

- 「重处理」「重试」按钮 onClick → `void useUiStore.getState().processEntry(entry.id)`（fire-and-forget）。点后给个乐观反馈：本地把该条目 UI 态切回「处理中」（可用本地 `useState` 翻一面，或直接读 `entry.status`——processEntry 成功后 store 会把 entries 里该条 status 更新为 ready，UI 自然响应）。**勿**在 detail 里直接改 store.entries（那是 store 的活）；调 `processEntry` 即可，store 会自刷。
- **D8 返回兜底**（reviewer minor）：detail 顶部返回按钮 `navigate(-1)` 在深链刷新时是 no-op（history.length===1）。改成：`history.length <= 1 ? navigate('/') : navigate(-1)`。
- 验收：tsc EXIT=0；勿碰 store.ts。

### search/ — 过滤接线

现状：`search/index.tsx` 有 filter chips（类别/标签/侧面/日期/模态）UI-only，点不真过滤；`searchEntries(query, entries, categories, tags, aiByEntry)` 已做全文搜文本+转写，但不过滤。

- 加过滤状态（本地 `useState`：选中的类别 slug / 标签 slug / 侧面 mood / 模态 / 日期范围——按现有 chip 集合来，别自己造新 chip）。
- `searchEntries` 结果再 `filter()` 一遍：命中选中类别（`aiByEntry[id]?.category === picked`）/ 命中选中标签（`ai.category`... 实际 `ai.tags.includes(pickedTag)`）/ 命中侧面（`ai.facets.mood === pickedMood`）/ 命中模态（`entry.parts.some(p=>p.type===picked)`）/ 日期。
- chip 数据源从 store 读（`categories`/`tags` 已有；侧面 mood 从 `aiByEntry` 聚合 `facets.mood` 去重；模态固定 text/audio/video；日期按 entries 的 createdAt 聚合日期）。
- 无选中 = 不过滤（保持全文搜）。
- 验收：tsc EXIT=0；勿碰 store.ts。

### settings/ — 导出 Markdown

现状：`settings/index.tsx` 的「导出 Markdown」按钮是占位（无下载）。

- onClick → 读 `useUiStore.getState().entries` + `aiByEntry`，按时间倒序拼一份 Markdown：
  - 每条目：`## {titleSuggestion ?? 正文前 16 字}` → `_{createdAt}_` → 正文（text part content + audio/video part transcript）→ AI 行（类别 label / 标签 / 摘要，若有）。
  - 顶部加生成时间 + 条数。
- `new Blob([md], {type:'text/markdown'})` → `URL.createObjectURL` → 临时 `<a download="aiji-export.md">` 点击下载 → `URL.revokeObjectURL`。
- 无条目时给个 EmptyState 或禁用按钮。
- **勿**调 `di.storage` 直接读（store 里已有 entries+aiByEntry，直接用）；**勿**碰 store.ts。
- 验收：tsc EXIT=0；勿碰 store.ts。

## 验收（你自测，过完回报）

```sh
npx tsc -p tsconfig.app.json    # 必须 EXIT=0。勿用 tsc -b / npm run typecheck
```

- 只动自己屏目录的文件。
- 回报格式：「完成。<改的文件清单>。tsc EXIT=0。<一句话说明你验了什么>。」勿自行 commit/push（lead 负责）。
