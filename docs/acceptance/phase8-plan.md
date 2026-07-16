# Phase 8 计划 — 核心闭环补全 + 清理

> 来源：2026-07-16 Explore 盘点（未开发/stub/半成品）。供无记忆 worktree subagent 协调。

## 范围与防撞
Batch 1 三 subagent **worktree 隔离**（各自在自己 git worktree 上做，lead 合并），文件域**互斥**：
- **F1 summary 真聚合**：`src/ui/screens/summary/` + 共享核心（`app/store.ts`、`app/di.ts`、`adapters/dexieStorage.ts`、`adapters/deepSeekLlm.ts`、`ports/index.ts`、`domain/types.ts`、`data/db.ts`、`data/seed.ts`）。
- **F2 settings 导出 .zip**：`src/ui/screens/settings/index.tsx` + 新 `src/adapters/zipExport.ts`。**不碰共享核心**（zip 当 util，读 store 快照 + `di.storage.getMedia`，不改 StoragePort 接口）。**不加新 npm 依赖**（手写 STORE-method zip，无压缩；或 CompressionStream deflate）。
- **F3 调试态清理**：`src/ui/screens/home/index.tsx`、`detail/index.tsx`、`categories/index.tsx`、`src/main.tsx`。删 `?demo=` query 门控、`DemoToggle`、`演示空态` toggle、`__aiji` DEV 钩子（**注意**：STT 验收用 `__aiji`，lead 在 STT 验收 LGTM 后才 merge F3，merge 前 main 树保留钩子）。

## F1 summary 真聚合（P0，最重）
- 现状：`summary/index.tsx` `seedAggregates.filter` 直读（:27），无真算；月聚合永远空态；「重新生成」只本地 setTopRecalc。
- 做：
  1. `LlmPort.aggregate(entryIds[], scope: 'day'|'week'|'month')` 接口（ports/index.ts）。
  2. `deepSeekLlm.ts` 实现：把条目文本（parts content/transcript）+ AI 摘要拼 prompt，让 LLM 出聚合摘要 JSON（{summary, highlights[]}）。few-shot 一例。
  3. `dexieStorage.ts`：Aggregate 表路由（key=scope+date，value=Aggregate）；`saveAggregate`/`getAggregate`/`listAggregates`（真读 Dexie 非 seed）。
  4. `store.ts`：`recomputeAggregate(scope, dateKey)` action——拉该区间 entries → di.llm.aggregate → di.storage.saveAggregate → set aggregates；`processEntry` 成功后 fire-and-forget 触发当日 recompute（stale 标记）。
  5. `summary/index.tsx`：scope 切换 → 调 `recomputeAggregate`（stale 时显「重新生成中」）→ 渲染真 aggregate；无 aggregate 显空态。
  6. `db.ts`：+aggregates 表（bump version）；`seed.ts`：保留 seedAggregates 作 fallback（Dexie 空时）。
- 自测：`npx tsc -p tsconfig.app.json` EXIT=0（**不要** tsc -b）。浏览器自测留 lead 集成验收。

## F2 settings 导出 .zip（P0，自包含）
- 现状：`settings/index.tsx:349-351` stub button 无 onClick。
- 做：点「导出 .zip」→ `zipExport()` 读 store entries/aiByEntry/categories/tags + 每条 entry 的 media（`di.storage.getMedia(ref)`）→ 打成一个 .zip（每条 entry 一个 `.md` + `media/<ref>.<ext>` + `ai.json` + `manifest.json` 可恢复）→ Blob 下载（`a.download='aiji-export.zip'`）。手写 zip（STORE method，CRC32 算）或用 `CompressionStream('deflate-raw')` 压缩——**不引新依赖**。
- 自测：tsc EXIT=0；下载能解出（可选浏览器验）。

## F3 调试态清理（P2，减负）
- 删 `home/index.tsx` `?demo=` query 门控 + 5 演示变体分支（留正常态）。
- 删 `detail/index.tsx` `DemoToggle` + 预览段（:65-91,:190）。
- 删 `categories/index.tsx` `演示空态` toggle + 相关空态分支按钮。
- 删 `main.tsx` `__aiji` DEV 钩子 + `import { di }`（若 di 仅钩子用）。**STT 验收 LGTM 后** lead 才 merge。
- 自测：tsc EXIT=0；删后 home/detail/categories 正常渲染（无回归）。

## 串行/依赖
- F1 的 store/di/dexie 扩展若将来与「离线队列」「AI 提醒」共用 → 那些后置串行（不在本批）。
- dark mode 视觉（Phase 6b）未入本批（会撞全屏 token，单独阶段做）。

## lead 集成
三 worktree branch 回来 → tsc 全量 → 串行 merge（F2、F3 先，F1 后因其大）→ 浏览器联合验收 → commit/push（HTTP/1.1）。