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

> 验收 agent：accept-e2（独立复核，不信 lead 结论，全部独立复跑/复验）。
> 工作树 = 未 commit 全部改动（19 M + 9 新 src 文件；`src/data/__tests__/dbv9.test.ts`
> 为历史未跟踪文件，全程未碰；`软件著作权申请资料/` 不在任何改动清单）。
> 验收方未 commit/push、未改实现代码（除回填本节）；密钥纪律遵守
> （未打印/报告任何 key 值）。

### 执行方式

- 静态门禁（独立复跑，关单前 2026-10-05 09:08 又整体复跑一次，尾行如下）：
  1. `npx tsc -p tsconfig.app.json` → **exit 0（0 错）**。
  2. `npx vitest run` → `Test Files 96 passed (96)` / `Tests 829 passed (829)`
     （基线 90 文件 760 + 新增 6 文件 69：summaryCache 12 + geocoding 18 +
     zipExport 11 + chatHelpers 13 + reminderScheduler 12 + exportConfirmSheet 3，
     与四路申报逐项吻合）。
  3. `npm run build` → 绿（precache 55 entries）；`ls dist/assets` 出
     **`llmShared-oz1noNVl.js`（51459 B）**；`builtinLlm-CRuN6dwb.js`（6354 B）
     `grep -c 'chat/completions'` = **0**；`openAiCompatLlm-C8HXY7qD.js` 11561 B
     ——BYOK HTTP 层与 builtin chunk 解耦证据成立（对照 D1 静态耦合期 63 KB）。
  4. 逐行 diff 复核（对 HEAD，awk 行区间抽取 + diff；初版符号校验脚本曾误报，
     重写 zsh 版复跑后确认）：
     - `llmShared.ts`（新，1090 行）：21 函数 + 3 类型对 HEAD openAiCompatLlm.ts
       **逐字一致**；ChatMessage 增 `export` + 注释属契约允许（新文件需导出）。
     - `openAiCompatLlm.ts`（1633→566）：port 对象（:105 起 462 行）对 HEAD 逐字；
       `SECRET_KEY`（:30）/`isDeepSeek`（:34）/`answerChatStreaming`（:43）原位
       保留；**零 re-export**；仅新增 llmShared import 块。
     - `builtinLlm.ts`：仅 :28-31 import 源改 llmShared，其余零 diff。
     - `store.ts`（2011→1719）：t3 块（autoRetried/retrying/
       __resetAiQueueRetryForTests，:211-221）原位保留；`UiState` 仅加 `export`
       （两个新模块 import type 需要）；尾部 create 完成后立即
       `initReminderScheduler({getState,setState})` + `initChatHelpers({...})`
       注入。sendMessage/processEntry/recomputeAggregate 未迁出（契约非目标，
       grep 证仍在 store.ts）。
     - `reminderScheduler.ts`（新，108 行）：4 函数 + permission 块对 HEAD
       store.ts 逐字；`import type { UiState }` type-only（verbatimModuleSyntax
       编译期抹除，零运行时环）；`let useUiStore!: SchedulerStore`
       definite-assignment，注入面 Pick<'reminders'|'trashed'|
       'showFiringReminder'>。
     - `chatHelpers.ts`（新，281 行）：11 函数逐字；chatSendSeq/memoryQueue
       模块态随行，经 nextChatSendSeq/currentChatSendSeq/getMemoryQueue/
       setMemoryQueue 4 个 accessor 暴露读写面（见 OBS-2）。
     - 13 个既有 e2-llm 测试：10 个 builder/parse 类改指 llmShared（aiMemory/
       answerPromptExtra/extractMemory/intentSchema/parseAnswerJson/pbSummarize/
       pcAdjudicate/pdProactive/pfCompanionEcho/promptLang）；diProxy/pbEmbed/
       answerChatStream 3 个 port/HTTP 行为测试保持 import openAiCompatLlm 不变
       ——与契约判断条款逐项吻合（git status 实证：恰 10 个 M）。
     - 5 个既有 store 测试（storeChatCapabilities/storeChatStream/
       storeChatActionOps/storeRollingSummary/storeEmbeddingGc）：**零 diff**
       ——仅 import useUiStore，helper 名只在注释出现（见 OBS-1）。
     - `zipExport.ts`：单行 diff（:15 `c >>> 1`，e2-crc 路 #48）。
     - `zipImport.ts`：restoreBackup 返回 `{entries, media, skippedParts,
       skippedEntries}`；skippedParts++（:143 丢媒体 part）与 skippedEntries++
       （:154-157 part 丢光整跳）两口径分开。
     - `settings/index.tsx`：ExportConfirmSheet 新增可选 props `scopeRowLabel?`/
       `hideSaveLocation?`（缺省 false 保持导出语义），恢复调用方传
       `scopeRowLabel={t('settings.importBackupScope')} hideSaveLocation`；
       toast 用 r.skippedEntries/r.skippedParts。
     - i18n zh/en settings.ts：`settings.importBackupScope`（还原范围 /
       Restore scope）+ importBackupDone 新口径（zh「已还原 {count} 条（跳过
       {skippedEntries} 条、媒体 {skippedParts} 项）」/ en 同构）双语一致。
     - 越界扫描：全部改动落契约四路白名单（19 M + 9 新）；无密钥混入 diff；
       `summaryCache.ts`/`geocoding.ts` 零 diff（e2-tests 纯新文件）。
- 浏览器联合测试：chrome-devtools-mcp（Playwright MCP 本机 9222 拒连不可用），
  视口 390×844；5173 被他 agent 占用 → vite dev **5209** + prod preview
  **4199**（`npm run build && npm run preview`）；`aiji:onboarded=1` + 游客
  「开始记」；store/调度器注入：`await import('/src/app/store.ts')` /
  `await import('/src/app/reminderScheduler.ts')`（vite dev 同模块图）；
  下载拦截 = 预 patch `URL.createObjectURL` 截 blob；瞬态 toast 捕获 =
  MutationObserver 武装 `[role="status"]`（3.5s 寿命，DOM 轮询两次漏捕后改用）。
  截图与产物全存 `.e2e_shots/`。

### 用例证据（5/5 PASS）

| 用例 | 结果 | 关键证据 |
|---|---|---|
| ① llmShared preview 冒烟 | PASS | preview 4199（prod build 同产物）：首页/设置/chat 三屏渲染正常，无 chunk 加载错误；chat 未配 key 走预期降级（错误气泡，非 chunk 失败）。截图 `.e2e_shots/e2-01-preview-home.png` / `e2-01-preview-settings.png` / `e2-01-preview-chat-degraded.png`。 |
| ② store 拆分（提醒 + chat） | PASS | vite dev 5209：setState 注入 5 秒后 due 的 pending 提醒 → 调 `/src/app/reminderScheduler.ts` 的 scheduleReminders（**新模块真实链路**）→ ~6 秒后 store state=fired 且 Dexie 持久化 fired，in-app 弹窗出现（截图 `e2-02-reminder-firing.png`）。chat 发一条 smoke：相位 intent→recall→answer→idle 依序推进，answer 消息落会话（截图 `e2-02b-chat-smoke.png`）——chatHelpers 链路（chatSendSeq/chatHistory/chatAnswerCache）真实走通。 |
| ③ e2-minor（sheet + toast） | PASS | 恢复备份确认 sheet：**无「保存位置」行**、scope 行文案=「还原范围」（截图 `e2-03-restore-sheet.png`）；导出变体回归干净（仍「导出范围」+「保存位置 系统分享面板」）。造 skipped 场景（手工 STORE zip `.e2e_shots/e2-restore-test.zip`：3 条目——纯文本 1 + 仅缺音频 1 + 文本+缺视频 1）→ 还原 entries=2 / skippedParts=2 / skippedEntries=1；toast 经 MutationObserver 捕获：**「已还原 2 条（跳过 1 条、媒体 2 项）」** 与 i18n 新口径逐字一致（截图 `e2-03-toast.png`）。 |
| ④ e2-tests 静态 | PASS | 三新测试文件 41 例全绿（summaryCache 12 + geocoding 18 + zipExport 11，含 crc32 已知向量断言）；`git diff src/adapters/summaryCache.ts src/adapters/geocoding.ts` = 空——实现零改动（zipExport.ts 单行 CRC 修复属 e2-crc 路 #48，非本 lane）。 |
| ⑤ CRC 端到端 | PASS | 浏览器真实导出（18 条目 = 种子 12 + 用例③三轮还原副本 6，manifest entryCount=18）截 download → `.e2e_shots/e2-export-crc.zip`（19374 B，23 entries）。`python3 -c "import zipfile; z=zipfile.ZipFile('.e2e_shots/e2-export-crc.zip'); print(z.testzip())"` → **None**（修复前每个 entry 报 bad CRC）；`unzip -t` → "No errors detected in compressed data"。 |

### findings

- **OBS-1**（契约措辞偏差，非缺陷）契约 §现状② 称 5 个既有 store 测试「按名
  引用上述 helper（随迁移改 import）」；实况该 5 文件仅 import useUiStore、
  helper 名只出现在注释——零改动即全绿。e2-store 路判断正确，契约描述偏严。
- **OBS-2**（观察项）chatHelpers.ts 的 chatSendSeq/memoryQueue 经
  nextChatSendSeq/currentChatSendSeq/getMemoryQueue/setMemoryQueue 4 个
  accessor 暴露（let 绑定跨模块不可直接赋值的等价改写），store.ts 调用点同步
  改写；行为等价由 storeChatStream/storeRollingSummary 等既有测试 + 用例②
  浏览器实测双重证实。属契约「同走晚绑定注入，lane 先逐函数核实依赖再定
  注入面」的允许裁量，记录备查。

### 结论

**LGTM**。4 静态门禁 + 5 浏览器用例全 PASS；无 BLOCKER/MAJOR/MINOR；
2 OBS 备查不阻 commit。E2 波（e2-llm/e2-store/e2-minor/e2-tests + e2-crc）
可进入 lead 集成 commit 阶段。
