# F2 store 拆分二阶（feat/companion-echo）

> RSI 第 8 波（W0 → P-F → Q6 → A1 → D1 → trust pack → E2 之后）。来源：E2 契约
> §范围② 明载「sendMessage/processEntry/recomputeAggregate 迁移（二阶，另波）」。
> 存量缺陷审计已清零（Q6 OBS-4 钳制 D1 ① 已修、P-E 全闭、trust pack 全闭、E2 全闭），
> 本波纯工程债收尾，零行为变化是最高纲领。
> 铁律：子代理只写分配文件、不 commit/push、TDD 先红后绿、`npx tsc -p tsconfig.app.json`
> + `npx vitest run` 双绿才报完成。基线：**829/829（96 文件）+ tsc 0**。

## 现状（2026-10-05 lead 逐行核实）

E2 一阶后 store.ts 1719 行（reminderScheduler/chatHelpers 已出）。三簇边界钉死：

| 簇 | 行区间 | 体量 | 运行时依赖（lead grep 核实） |
|---|---|---|---|
| processEntry | :541-651 | ~111 行 | get().recomputeAggregate（跨 action 交叉调用）+ embedEntryNow（chatHelpers 已外部）+ di + set |
| recomputeAggregate | :652-719 | ~68 行 | get().settings/entries/recalculating + entriesInRange（:203 模块函数，全仓仅此一处用）+ summaryCache + di |
| sendMessage | :1034-1509 | ~476 行 | get().conversation/categories/memories/settings 读 + get().refreshChatList/saveMemory/updateChatMessage（跨 action，留 store）+ set(conversation/chatLoading) + chatHelpers 全家（chatAnswerCache/chatCacheKey/chatHistory/withSemanticArm/maybeRollSummary/nextChatSendSeq/currentChatSendSeq 等，已外部）+ chat/helpers（localRecall/currentTimeLine/resolveActionCategory）+ weather/webSearch 适配器 + di |

- **无外部命名 import**：三 action 全经 useUiStore 选择器访问（grep 实证 0 命名 import）
  → store 内改一行 delegate，全部调用点零改动。
- **entriesInRange**（:203-206）仅 recomputeAggregate 用 → 随迁。
- 迁移总量 ~655 行 → store.ts 预计 ~1060 行。
- t3 的 autoRetried/retrying/__resetAiQueueRetryForTests / sweep/ retryFailedEntries
  **留 store**（AI 队列语义属本体，retryFailedEntries 经 get().processEntry 调 delegate 无环）。

## 范围（单 lane，契约钉死）

### 新三模块（f2-store）

**通用模式（E2 一阶已验证）**：
```ts
import type { UiState } from '@/app/store'   // type-only，编译期抹除零运行时环
type StoreHandle = {
  getState: () => UiState
  setState: (partial: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => void
}
let handle!: StoreHandle
export function init<Module>(h: StoreHandle): void { handle = h }
// 保函数体逐字的本地 shim（create() 闭包 get/set 的模块级等价物）：
const get = () => handle.getState()
const set = (p: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => handle.setState(p)
```
- **逐字律**：函数体自 create() 闭包逐字剪切（含全部注释）；`get`/`set` 标识符经
  上述 shim 天然解析，体内零改写。imports 随迁（报告列清单）。
- store.ts 在 create 完成后立即三行 init（紧邻既有 initReminderScheduler/initChatHelpers）。
- **set 无 replace 第二参用法**（lane 先 grep 核实，报告说明；有则 shim 补签名）。

**a. src/app/entryPipeline.ts**：processEntry 迁入，export init + processEntry。
   体内 `get().recomputeAggregate('day')` 保持原样（经 get shim → store delegate →
   aggregates 模块，无直接 import，无环）。
**b. src/app/aggregates.ts**：recomputeAggregate + entriesInRange 迁入，export init +
   recomputeAggregate（entriesInRange 模块私有不导出，除非测试需要）。
**c. src/app/chatSend.ts**：sendMessage 迁入，export init + sendMessage。
   体内 get().refreshChatList/saveMemory/updateChatMessage 保持原样（留 store 的 action，
   经 get shim 调用）。

**store.ts**：三 action 体删至一行 delegate：
```ts
processEntry: (entryId, isFresh) => processEntryImpl(entryId, isFresh),
```
（import 时起别名防与 interface 字段名/调用混淆，别名命名 lane 自定并报告。）
其余 action/UI 状态/interface 一律不动；**UiState interface 不拆**（非目标）。

### 测试

- 既有 829 测试即防回归网（store 全行为测试经 useUiStore 走 delegate，零改动预期——
  E2 一阶实证同模式零 diff；若有意外改动逐条报告）。
- 可新增 src/app/__tests__/ 小测（fake handle 注入：entryPipeline classify 成功/失败
  状态机、aggregates 缓存命中/重算、chatSend seq 守卫）——新测试文件归本 lane。
- **发现疑似 bug 只报告不修**（同 E2 先例，单列修复波）。

### 非目标

resolveChatAction（:873-1029）/saveMemory（:1581-1638）/finishSave 迁移（三阶另波）；
任何逻辑"顺手优化"；UiState 拆分；`npm run typecheck`/`tsc -b`（并行铁律用
`npx tsc -p tsconfig.app.json`）。

## 任务拆分

**Lead 契约 commit**：本文件。接口钉死：三模块路径 + init 签名 + StoreHandle 形状 +
get/set shim 模式 + delegate 一行式。

| Agent | 独占文件 |
|---|---|
| f2-store | src/app/store.ts、src/app/entryPipeline.ts（新）、src/app/aggregates.ts（新）、src/app/chatSend.ts（新）、可新增 src/app/__tests__/ 新测试文件 |

单 lane 独吞 store.ts（E2 一阶同款防撞），无并行冲突。

## 验收（acceptance agent，静态 review + 浏览器 390×844）

1. lane 报齐 → lead 集成：tsc + vitest 全绿 + diff 逐行过 + `npm run build` 绿。
2. 用例：
   ① **逐字核验**：awk 提取三簇函数体 vs `git show HEAD:src/app/store.ts`，diff 全
      IDENTICAL（shim 行除外）；store.ts delegate 一行式 ×3 + init ×3，无其他逻辑改动。
   ② **chat 链路（vite dev + 注入）**：sendMessage 发一条 → 相位流转（intent→
      recall/weather/search→answer→idle）+ 会话落库 + refreshChatList 回调走通
      （chatSend 模块真实承载）；无 LLM key 时优雅降级 error 气泡亦算链路走通。
   ③ **processEntry（vite dev + 注入）**：造 failed 条目 → getState().processEntry(id)
      手动重试 → 状态机流转（processing→ready/failed + 落库）；recomputeAggregate('day')
      直调 → 日聚合刷新（stale→ready 或缓存命中日志）。
   ④ **回归**：既有 store 测试文件零 diff（或 lane 已逐条说明）；829+ 全绿。
3. 全绿 → lead commit（契约+lane+验收记录，~3 个语义 commit）→ 关单。

## 验收记录

（验收 agent 回填）
