# Phase 7a 读侧修复 — subagent 共享上下文

> 你是被派来修 Phase 7a LLM 分类管线的**读侧**缺陷的子代理。你没有记忆，本文档是你唯一的上下文。读完再动手。

## 背景（为什么有这活）

Phase 7a 已接通 DeepSeek 文本分类：保存条目 → `processEntry` → `deepSeekLlm.classify` → `EntryAi` 落 Dexie。**写入侧已验通**（DB 直查：category/tags/title/summary/facets 全对）。

**但读侧断了**：home / detail / search / categories / summary 五个屏还在从**静态 seed 数组**（`seedEntryAi` / `seedCategories` / `seedTags`）查 AI 与类别/标签。真实分类条目不在 seed 里（seed 只有 e1-e12），所以：
- 首页新条目卡片**无类别 chip**（老条目有）。
- 详情页 AI 面板显示「暂无 AI 处理结果」。
- 首页卡片**点了不进详情**（`TimelineCard` 的 `<article>` 没有 onClick）。

## 已完成的共享基础（store.ts，勿改）

`src/app/store.ts` 已扩展，新增三个状态字段（lead 已改完、已过 tsc）：

```ts
aiByEntry: Record<string, EntryAi>   // key=entryId, value=EntryAi（最高 version）
categories: Category[]                 // 含涌现类别
tags: Tag[]                           // 含涌现标签
```

- **首屏兜底**：`aiByEntry` 从 `seedEntryAi` 建，`categories`/`tags` 从 seed 建（保证 hydrate 前不空）。
- **hydrate()**：从 Dexie 载入 `listEntries` + `getSettings` + `listCategories` + `listTags`，并对每条 entry 调 `getEntryAi` 载入 AI，组装 `aiByEntry`。
- **processEntry() 成功**：除了更新 entry status=ready + aiId，还把 `aiByEntry[entryId]=ai`，并重载 `categories`/`tags`（涌现的新类别/标签适配器已落库）。

屏实现**直接从 `useUiStore` 读**这三个字段即可，不要再 import seed 的 `seedEntryAi`/`seedCategories`/`seedTags`。

## 你的任务（按派给你的屏目录）

### 通用修复模式

把 `import { seedEntryAi, seedCategories, seedTags } from '@/data/seed'` 删掉，改成从 store 读：

```tsx
const aiByEntry = useUiStore((s) => s.aiByEntry)
const categories = useUiStore((s) => s.categories)
const tags = useUiStore((s) => s.tags)
// 局部 Map 照旧建，但数据源换成 store：
const catMap = new Map(categories.map((c) => [c.slug, c]))
const aiMap = new Map(Object.entries(aiByEntry))   // 或按需 find
```

**勿碰**：`src/app/store.ts`、`src/ui/components/`、`src/data/`、`src/domain/`、`src/ports/`、`src/adapters/`、router、AppShell，以及**别的屏目录**。只写自己那一份 `screens/<x>/`。

### home/（critical path）

- `home/index.tsx:6` 删 `seedCategories, seedEntryAi` import；`:70-71` 的 `catMap`/`aiMap` 改从 store 读（见上）。`TimelineCard` 调用处不动。
- `home/TimelineCard.tsx`：`ReadyCard` 的 `<article>` 加 `onClick={() => navigate('/detail/' + entry.id)}`，加 `role="button"` + `cursor-pointer`，`useNavigate` hook。`ProcessingCard` 同样可点（进了看处理中态）。这是**预存漏接线**，补上。

### detail/（critical path）

- `detail/index.tsx:4` 删 `seedEntryAi` import；`:123` `const ai = seedEntryAi.find(...)` 改成从 store 读：
  ```tsx
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  // ...
  const ai = id ? aiByEntry[id] : undefined
  ```
- **深链兜底**：直接访问 `/detail/{id}`（刷新页面）时 store 可能还没 hydrate 完。加一个 `useEffect`：若 store 里没 ai 但 entry 存在，异步 `di.storage.getEntryAi(id)` 载入到本地 state（`useState<EntryAi|undefined>`），优先用 store 的、回落到异步载入的。`di` 从 `@/app/di` import。
- `detail/helpers.ts:2` 删 `seedCategories, seedTags`；`:6-7` 的 `CAT_BY_SLUG`/`TAG_BY_SLUG` 改成**函数**（接受 categories/tags 参数）或改成在组件里用 store 数据建 Map 传入。注意 helpers.ts 是纯模块顶层 `const`，改函数签名会影响 AiPanel 调用——最小改法：把 `categoryLabel(slug)` 改成 `categoryLabel(slug, categories)`，AiPanel 里传 store 的 categories。同理 `tagLabel`、`categoryTone`（categoryTone 可能只靠 slug 映射 accent，看实现）。

### search/ + categories/ + summary/（secondary）

- `search/helpers.ts:1` 删 seed import；`:10-12` 的 map 改成接受参数的函数（`buildMaps(categories, tags, aiByEntry, entries)`）。`search/index.tsx:4` 删 seed，`:11-12`/`:17` 的 seed slice 改用 store。
- `categories/index.tsx:4` 删 seed；`:13`/`:37`/`:40`/`:41`/`:50` 全改用 store 的 `categories` + `aiByEntry`。
- `summary/index.tsx:2` 的 `seedEntryAi`/`seedCategories` 改 store（`seedAggregates` 暂留——聚合重算路径未落地，仍取 seed）。

## 验收（你自测，过完回报）

```sh
npx tsc -p tsconfig.app.json    # 必须 EXIT=0。勿用 tsc -b / npm run typecheck（共享 tsbuildinfo 并发竞态）
```

- TS strict：`import type` 分离类型；禁 enum/构造参数属性/namespace；无未用变量/参数。
- 只动自己屏目录的文件。
- 回报格式：「完成。<改的文件清单>。tsc EXIT=0。」勿自行 commit/push（lead 负责）。
