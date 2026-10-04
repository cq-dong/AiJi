# E2 eng-debt 深化波（feat/companion-echo）

> RSI 第 7 波（W0 → P-F → Q6 → A1 → D1 → trust pack 之后）。来源：eng-debt 审计
> 存量尾巴（LLM 共享层 M / store.ts 拆分 L / 测试补差 M）+ trust pack 验收遗留
> 2 MINOR。一波收尾，不混新功能。
> 铁律：子代理只写分配文件、不 commit/push、TDD 先红后绿、`npx tsc -p tsconfig.app.json`
> + `npx vitest run` 双绿才报完成。基线：**760/760（90 文件）+ tsc 0**。

## 现状（2026-10-05 lead 逐行核实）

### ① LLM 共享层缺失——builtin chunk 拖 BYOK 全量代码（chunk 耦合）

- `openAiCompatLlm.ts`（1633 行）两层混血：**:30-1170 共享 prompt/parse 层**
  （VisionTextPart/VisionImagePart 类型、inferMediaType、entryText、collectEntryImages、
  toLocalIso、buildPrompt、loadEnabledMemoryContents、parseJson、buildAggregatePrompt、
  parseAggregateJson、buildIntentPrompt、buildAnswerPrompt、parseIntentJson、
  parseAnswerJson、buildExtractMemoryPrompt、buildConversationSummaryPrompt、
  parseMemoryReply、buildMemoryAdjudicationPrompt、parseAdjudicationJson、
  buildProactiveGreetingPrompt、parseProactiveGreetingReply、sanitizeInlineCites
  ——见 `grep ^export` 全表）+ **:1172 `openAiCompatLlm` port 对象**（BYOK HTTP/SSE 客户端）。
- `builtinLlm.ts:20-31` **静态** import 上面整个共享层（builtin 走服务端
  /api/llm/chat，根本不用 BYOK HTTP 层）→ builtin 用户白扛 openAiCompat chunk
  （D1 验收实测 63K）。D1 ⑤b 把 di.ts 双动态化后只剩这一处静态耦合。
- 非测试 import 方全仓仅两处：di.ts（动态，不动）+ builtinLlm.ts（静态，本波目标）。
- 13 个既有测试 import openAiCompatLlm（builder/parse 测试改指 llmShared；
  port/HTTP 测试保持原样）。

### ② store.ts 2011 行——模块级函数簇已可干净抽出（L 拆一阶）

- **提醒调度簇 :186-260**（~75 行）：scheduledTimeouts / permissionRequested /
  clearScheduledTimeout / fireReminder / markMissed / scheduleReminders。
  运行时依赖 = `useUiStore.getState()/setState()`（晚绑定自引用）+ di.localNotifications
  / di.storage / playReminderBeep（:13 import）。store 内调用点 :568/:736/:758/
  :1046/:1049/:1055-56/:1068/:1073/:1079/:1116/:1236（12 处）。
- **chat 辅助簇 :261-344**：CHAT_HISTORY_WINDOW / chatAnswerCache / chatCacheKey /
  formatDueShort / ensureConversation / appendMessage / stripLeadingDatePrefix /
  chatSendSeq / memoryQueue / stripStreamingFlags / chatHistory。
- **P-B 簇 :345-510**：withSemanticArm（语义召回，读 di.llm.embed + di.storage）+
  maybeRollSummary（滚动摘要，读 di.llm.summarizeConversation + di.storage）。
- 5 个既有 app 测试按名引用上述 helper：storeChatCapabilities / storeChatStream /
  storeChatActionOps / storeRollingSummary / storeEmbeddingGc（随迁移改 import）。
- t3 新加的 autoRetried/retrying/__resetAiQueueRetryForTests（:316-326）**留 store**
  （AI 队列语义属 store 本体）。

### ③ 测试补差（纯新文件，零实现改动）

- `adapters/summaryCache.ts`（87 行）：get/set/clear/shouldRefresh 纯函数，TTL/stale
  分支无任何测试。
- `adapters/geocoding.ts`（256 行）：fetch 封装 + status='1' 解析 +
  reverseGeocodeCity 直辖市 province 兜底，无测试。
- `adapters/zipExport.ts`（410 行）：buildEntryMarkdown 边缘（纯媒体条目/location/
  facets）、extFromType mime→扩展名映射、crc32 已知向量——t1 已覆盖 v2 产物三 JSON
  （勿重复），markdown/工具函数层空白。

### ④ trust pack 验收遗留 2 MINOR（docs/acceptance/prd-trust-pack.md §findings）

- **MINOR-1**：settings/index.tsx ExportConfirmSheet（:320-400 一带）body 两行
  导出语义——「导出范围」label（settings.exportScope）+「保存位置 系统分享面板」
  行（settings.saveLocation/locShareSheet）在恢复备份场景下误导。
- **MINOR-2**：zipImport.restoreBackup 返回 `skipped` 实按丢掉的媒体 part 计数
  （zipImport.ts:137），整条跳过（:149）不计入；toast「跳过 {skipped} 条」单位误导
  （zh/settings.ts:151 + en 同构）。

## 范围（四件，契约钉死）

### ① llmShared 抽取（e2-llm）

- 新 `src/adapters/llmShared.ts`：把 openAiCompatLlm.ts 的共享 prompt/parse 层
  **逐字剪切**过去（含全部注释；含 I/O helper collectEntryImages/loadEnabledMemoryContents
  ——它们引 di，builtin 本就连 di，无新耦合）。
- openAiCompatLlm.ts：保留 port 对象 + BYOK key/SSE/fetch 私有实现；改
  `import { ... } from '@/adapters/llmShared'`。**不 re-export**（import 方全改指，
  不留双口）。
- builtinLlm.ts:20-31 import 源改 llmShared，其余零改动。
- 13 个既有测试：builder/parse 类断言的 import 改 llmShared；**port/HTTP 行为测试**
  （pbEmbed/answerChatStream/diProxy 等直接测 openAiCompatLlm 对象的）保持
  import openAiCompatLlm 不变。lane 逐文件判断并在报告说明。
- **零行为变化**：prompt 文本逐字节不动、函数签名不动。验收证据：全量测试绿 +
  build 后 `ls dist/assets` 出 llmShared chunk；builtin chunk grep 不到 BYOK HTTP
  特征串（如 `chat/completions`）。

### ② store 拆分一阶（e2-store）

- 新 `src/app/reminderScheduler.ts`：提醒调度簇整体迁入。运行时对 useUiStore 的
  依赖用**晚绑定注入**解环：
  ```ts
  type SchedulerStore = {
    getState: () => Pick<UiStateSnapshot, 'reminders' | 'trashed' | 'showFiringReminder'>
    setState: (fn: (s: { reminders: Reminder[] }) => { reminders: Reminder[] }) => void
  }
  export function initReminderScheduler(store: SchedulerStore): void
  export function scheduleReminders(): void // + clearScheduledTimeout/fireReminder/markMissed
  ```
  类型用 `import type { ... } from '@/app/store'`（type-only，verbatimModuleSyntax
  下编译期抹除，**零运行时环**）；store.ts 在 create 完成后立即
  `initReminderScheduler({ getState: useUiStore.getState, setState: useUiStore.setState })`。
  模块级状态（scheduledTimeouts/permissionRequested）随行。playReminderBeep import
  随迁。store.ts 12 个调用点改指新模块导出的同名函数。
- 新 `src/app/chatHelpers.ts`：chat 辅助簇 + P-B 簇迁入，原样 export。chatSendSeq/
  chatAnswerCache/memoryQueue 等模块态随行。对 di 的直接引用保留（di 不引
  useUiStore，无环）；若有运行时碰 useUiStore 的函数，同走晚绑定注入
  （initChatHelpers，lane 先逐函数核实依赖再定注入面，报告说明）。
- store.ts：保留全部 action 与 UI 状态；删迁出代码，import 替代。
- 5 个既有 app 测试 import 同步改指新模块。
- **零行为变化**是最高纲领：函数体逐字剪切，不改一个字符的逻辑。
- **非目标**：sendMessage/processEntry/recomputeAggregate 迁移（二阶，另波）；
  UiState interface 拆分；任何逻辑"顺手优化"——发现疑似 bug 写进报告，不修。

### ③ 测试补差（e2-tests）

仅新文件，实现零改动：
- `src/adapters/__tests__/summaryCache.test.ts`：get 命中/过期 null、set 覆盖、
  clear 精确删（其他键不动）、shouldRefresh TTL 边界（临届 true/false）。
- `src/adapters/__tests__/geocoding.test.ts`：fetch mock——成功解析（status='1'
  取 addressComponent）、status='0' → null、reject/超时 → null、reverseGeocodeCity
  直辖市（city 空 → province 兜底）。
- `src/adapters/__tests__/zipExport.test.ts`：buildEntryMarkdown 纯媒体条目（无文本
  part 不崩）、location 有/无、extFromType 已知 mime 映射、buildZip/crc32 已知向量
  （固定字节 → 固定 crc）。**不重复** t1 已覆盖的 v2 三 JSON/manifest 断言。
- 全量测试绿才报完成；新测试必须先红（先跑挂再实现——但实现已存在，此 lane
  的"红"= 新测试首次运行前应人工核对断言与实现语义一致，发现实现 bug 只报告不修）。

### ④ trust pack 遗留（e2-minor）

- **MINOR-1**：ExportConfirmSheet 加两个可选 prop：`scopeRowLabel?: string`
  （缺省 t('settings.exportScope')）+ `hideSaveLocation?: boolean`（缺省 false）。
  export 调用方零变化；恢复备份调用方传 `scopeRowLabel={t('settings.importBackupScope')}`
  + `hideSaveLocation`。新 key：zh「还原范围」/ en「Restore scope」。
- **MINOR-2**：restoreBackup 返回 `{ entries, media, skippedParts, skippedEntries }`
  （skipped→skippedParts 改名 + 整条跳过计 skippedEntries）。toast i18n 改：
  zh「已还原 {count} 条（跳过 {skippedEntries} 条、媒体 {skippedParts} 项）」/
  en「Restored {count} entries ({skippedEntries} entries, {skippedParts} media items
  skipped)」。zipImport.test 相关断言同步；settings/index.tsx 调用处同步。
- **OBS-1**（尸体文案瞬态属自愈语义）：不改代码，契约已补注，无行动项。

## 任务拆分（契约先行 → 4 路并行）

**Lead 契约 commit**：本文件。跨路接口钉死：llmShared.ts 路径与导出清单
（= openAiCompatLlm 现共享层全表）、reminderScheduler/chatHelpers 晚绑定 init
签名、ExportConfirmSheet 新 prop 名、restoreBackup 返回字段名、两个 i18n key 命名。

| Agent | 独占文件 |
|---|---|
| e2-llm | src/adapters/llmShared.ts（新）、src/adapters/openAiCompatLlm.ts、src/adapters/builtinLlm.ts、13 个既有测试（src/app/__tests__/diProxy.test.ts、src/adapters/__tests__/{pbSummarize,answerPromptExtra,intentSchema,extractMemory,promptLang,pcAdjudicate,aiMemory,parseAnswerJson,pbEmbed,pfCompanionEcho,answerChatStream,pdProactive}.test.ts） |
| e2-store | src/app/store.ts、src/app/reminderScheduler.ts（新）、src/app/chatHelpers.ts（新）、src/app/__tests__/{storeChatCapabilities,storeChatStream,storeChatActionOps,storeRollingSummary,storeEmbeddingGc}.test.ts、可新增 src/app/__tests__/ 新测试文件 |
| e2-minor | src/ui/screens/settings/index.tsx、src/adapters/zipImport.ts、src/adapters/__tests__/zipImport.test.ts、src/app/i18n/zh/settings.ts、src/app/i18n/en/settings.ts |
| e2-tests | 仅新文件：src/adapters/__tests__/{summaryCache,geocoding,zipExport}.test.ts |

防撞：四路文件集零交集（已逐路核对）。e2-tests 只读实现不写实现；e2-minor 的
zipImport.test.ts 不在 e2-llm 13 文件清单内；store.ts 独吞 e2-store。

## 测试要点（TDD）

- e2-llm：既有 760 测试即防回归网（prompt 快照/parse 白名单断言全在）；build 产物
  证据（llmShared chunk + builtin chunk 无 BYOK HTTP 串）写进报告。
- e2-store：既有测试绿 + 抽出模块可补小测（reminderScheduler 注入 fake store 的
  schedule/fire/missed 状态机；chatHelpers 纯函数直测）——新测试文件归本 lane。
- e2-minor：MINOR-1 渲染断言（restore 变体无「保存位置」、scope 行文案正确）可加进
  既有 settings 测试文件？——不可，settings 测试文件不在 lane 集内 → 新断言写进
  zipImport.test.ts 同文件（允许，文件归本 lane）或新建独立测试文件（归本 lane）。
- e2-tests：上述三文件。
- 既有 760 测试防回归；全量绿才报完成。

## 验收（acceptance agent，静态 review + 浏览器 390×844）

1. 四路报齐 → lead 集成：tsc + vitest 全绿 + diff 逐行过 + `npm run build` 绿。
2. 用例：
   ① llmShared：`ls dist/assets` llmShared chunk 存在；builtin chunk grep 不到
      `chat/completions`；preview 冒烟（首页/chat/设置三屏正常，动态导入链路走通）。
   ② store 拆分：vite dev + store 注入——setState 造 5 秒后 due 的 pending 提醒 →
      ~6 秒后 fired + in-app 弹窗出现（scheduleReminders 经新模块真实走通）；
      chat 收发一条 smoke（chatHelpers 链路）。
   ③ e2-minor：恢复备份确认 sheet 无「保存位置」行 + scope 行「还原范围」；
      造 skipped 场景（备份含无媒体条目）toast 新口径双语义正确。
   ④ e2-tests：三新测试文件全绿 + `git diff` 确认实现零改动。
3. 全绿 → lead commit（契约+四路+验收记录，~6 个语义 commit）→ 关单。

## 验收记录

（验收 agent 回填）
