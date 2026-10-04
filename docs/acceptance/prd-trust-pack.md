# PRD trust pack（feat/companion-echo）

> RSI 第 6 波（W0 → P-F → Q6 → A1 → D1 之后）。来源：2026-10-04 五路审计 **audit-prd**
> 缺口清单 Top3 + 候补第 4——全是 PRD 明文承诺未兑现项，直接决定「本地优先/可信任」
> 产品叙事是否成立。一波补齐，不混功能。
> 铁律：子代理只写分配文件、不 commit/push、TDD 先红后绿、`npx tsc -p tsconfig.app.json`
> + `npx vitest run` 双绿才报完成。基线：**725/725（85 文件）+ tsc 0**。

## 现状（2026-10-05 lead 逐行核实）

### ① 导出可恢复缺一半（PRD F5/§5/§7.2）

- 导出在：`zipExport.ts` exportZip/exportEntryZip/exportCategoryZip——手写 STORE zip
  （无 npm 依赖），打 `entries/<id>.md`（人类可读）+ `media/<ref>.<ext>` + `ai.json`
  （entryId→EntryAi）+ `manifest.json`（version:1）。
- **致命缺口：无 `entries.json`**——Entry 原始 JSON（parts 结构/ref/location/status）
  不在包里，markdown 是有损格式（音视频 part 只剩转写文本，ref→条目映射丢失）。
  全 src 无 import/restore（grep 零命中）。备份承诺只兑现一半。
- `Entry`/`EntryAi`/`Category`/`Tag` 类型见 domain/types.ts:69-150；落库全部走
  dexieStorage 单条 save*，**ownerId 由 stampOwner 自动盖当前账号**（dexieStorage.ts:23）
  ——导入方无需关心分区。
- 恢复后刷新：`rehydrate()`（store.ts:568，重置 hydrated 全量重载）现成，
  settings/index.tsx:1297 已有先例（importSampleData）。
- 设置数据组 JSX：settings/index.tsx:1560-1598（导出 md/导出 zip/分享/导入示例四行），
  恢复行插在「导出 Zip」之后；确认 sheet 可复用 ExportConfirmSheet（props:
  scopeLabel/filename/entryCount/mediaCount/onClose/onConfirm）。

### ② PWA Share Target 未实现（PRD F1/§7.1/§8 MVP）

- vite.config.ts:26-39 manifest 无 share_target；router.tsx 无接收路由。
- 接收后入采集草稿：`addPart`（store.ts:645，**追加**非覆盖）现成，零 store 改动。
- **范围钉死：仅 GET（text/title/url 三参数）**。POST+文件需自定义 SW fetch handler
  （generateSW → injectManifest 手术，动 53 条 precache 体系），本波不做，文档在案。
  原生壳 ACTION_SEND 另计（audit 估 M），不做。

### ③ 隐私条目级标识缺失（PRD F5/§6 JTBD）

- `EntryAi.modelUsed`（types.ts:113）+ `Aggregate.modelUsed`（types.ts:162）已在，
  BYOK=真实模型名（openAiCompatLlm.ts:1297/1384），builtin='builtin-llm'
  （builtinLlm.ts:239/311）。**无新数据模型**（audit 定级 S 的前提）。
- 详情页 AI 面板组件在 detail/index.tsx:214-231 一带（AiPanel，title/summary/category/tags）。
- 设置无「数据出门」视图——新增 DataOutSheet，数据源 = 内存态
  `useUiStore` aiByEntry + aggregates（hydrate 后必有），按 modelUsed 聚合。

### ④ AI 失败队列不自动补跑 + processing 尸体（KR4 字面未兑现）

- 失败路径：processEntry catch（store.ts:899-910）→ status:'failed' + processError。
- processEntry 调用点仅两处：finishSave（store.ts:642 一带，isFresh）+ detail 手动
  重试（detail/index.tsx:685）。**无 online 触发、无 boot 清扫**。
- 杀进程在 STT/classify 中段 → 条目永挂 'processing'，无清扫。
- online 事件已接：main.tsx:62-64（setOnline true/false），store.online 字段在。
- hydrate（store.ts:516-566）是 boot 清扫的天然挂载点（尾部 archiveStaleMemories 同款
  fire-and-forget 模式）。
- **配额纪律**（BYOK 烧钱）：每条目每会话最多自动补跑一次（内存 Set 记 retried），
  手动重试不受限；补跑串行（D11 串行铁律），offline 直接 no-op。

## 范围（四件，契约钉死）

### ① 导入还原（t1）

**a. 导出 v2**（zipExport.ts，向后兼容改动）：
- 新增三个文件入包：`entries.json`（raw `Entry[]`，与 md 同源 store 快照）、
  `categories.json`（`Category[]`）、`tags.json`（`Tag[]`）。
- manifest.version 1→2，schema 描述同步加三条。markdown/ai.json/media 布局不变。
- **非目标**：exportEntryZip/exportCategoryZip 不动（单条/类 zip 无 entries.json，
  导入方会拒——合理，恢复入口只认全量备份）。

**b. 新 src/adapters/zipImport.ts**：
- `parseZip(buf: Uint8Array): Map<string, Uint8Array>`——STORE-only 读取器
  （EOCD→central directory→local header；method≠0 抛错；与 buildZip 镜像，零依赖）。
- `readBackup(file: Blob): Promise<ParsedBackup>`：读 entries.json（缺→抛
  `invalid`：「不是有效的 AiJi 备份或版本过旧」）+ ai.json（可缺省 {}）+
  categories/tags.json（可缺省 []）+ 计数（entries/media），media map 留内存。
- `restoreBackup(parsed): Promise<{ entries: number; media: number; skipped: number }>`：
  1. categories/tags 按 slug upsert——slug 已存在**整条保留现有**；新增插入
     usageCount=0（备份计数对本机无意义）。
  2. 每条 entry：**新 id**（crypto.randomUUID，新增式恢复，永不覆盖）；status
     'processing'→'failed'（备份里的 processing 必是尸体）+ processError 补
     「备份还原时原处理未完成，可重试」；其余 status 原样。
  3. 媒体 part：按 `media/<oldRef>.` **前缀匹配** zip 内文件（ext 不重建，
     防 extFromType 漂移）→ 命中则 **新 ref** saveMedia + 改写 part.ref；
     未命中 → 丢该 part（skipped++）；一条 entry 全部 part 丢光 → 整条跳过。
  4. EntryAi：entryId 改新 id、ai.id 新 uuid、version/modelUsed 原样，entry.aiId
     同步改指。saveEntryAi。
  5. deletedAt/ownerId 不传（saveEntry 系自动盖章；备份本不含软删行）。
  6. 日聚合：现有 scope.type==='day' 全部置 stale 落库（摘要页开时自然重算，
     导入条目进入 digest）；周/月不动。
- 两步 API（read→confirm→restore）供设置页确认 sheet 先显示计数。
- **非目标**：v1 zip 兼容（本就无法还原）；markdown 解析还原；提醒/会话/记忆恢复
  （备份不含，entryId 链接会悬空——文档说明）。

**c. 设置 UI**（settings/index.tsx）：
- 「恢复备份」SettingsRow 插在导出 Zip 行后；隐藏 `<input type="file"
  accept=".zip,application/zip">`；readBackup → ExportConfirmSheet 复用（允许加
  可选 `title` prop 覆盖默认导出文案，export 调用方零变化）→ restoreBackup →
  zipToast 复用报「已还原 N 条（跳过 M 条）」→ rehydrate()。
- 过程态：row value=t('settings.importing')。

### ② Share Target GET（t2）

- vite.config.ts manifest 加：
  ```ts
  share_target: {
    action: '/share-target',
    method: 'GET',
    params: { title: 'title', text: 'text', url: 'url' },
  },
  ```
  （TS 不认 share_target 字段则整 manifest 对象 `as` 断言放过，注释说明。）
- router.tsx：BareLayout 组内加 `/share-target` 路由 + lazy import。
- 新 src/ui/screens/shareTarget/index.tsx：
  - `composeSharedText(title, text, url)`（export 供测试）：三者 filter(Boolean)
    join('\n')，trim。
  - 非空 → `useUiStore.getState().addPart({ type: 'text', content })` →
    `navigate('/capture', { replace: true })`（**追加**语义，不覆盖在写草稿）。
  - 空 → EmptyState「没有收到可记入的内容」+ 按钮回首页。
  - 渲染期即跳转，落一帧 Loading。
- i18n：zh/common.ts + en/common.ts 加 `shareTarget.empty` / `shareTarget.backHome`。
- **非目标**：POST/files（SW 手术，文档在案）；原生 ACTION_SEND；onboarding
  未完成时分享参数保留（Gate 先行，参数丢失属可接受边角，文档在案）。

### ③ 隐私标识（t1）

**a. 详情页上送行**（detail/index.tsx AiPanel 区）：
- AI 面板内加一行 11-12px text-t3：`t('detail.uploadLine', { model: ai.modelUsed })`
  zh「文本与转写已上送 {model}」/ en「Text & transcripts sent to {model}」。
- 条目含 audio/video part 时追加 `t('detail.uploadMediaSuffix')`
  zh「；语音/媒体按处理时的 STT/VLM 配置上送」/ en「; media went to the STT/VLM
  provider configured at processing time」。
- 仅渲染已记录事实（modelUsed），不推断、不新增数据模型。

**b. 设置「数据出门」**（settings/index.tsx + 新 settings/DataOutSheet.tsx）：
- 数据组加行「数据出门」→ DataOutSheet（共享 Sheet 组件 + useBackDismiss，
  D1 先例）。内容：按 modelUsed 聚合 aiByEntry + aggregates → 每行
  `{model} · {count} 条 · 最近 {HM/日期}`；顶部说明文案（哪些数据会出门：分类/
  摘要的文本与转写、STT 的音频、VLM 的媒体、问答的提问——静态 i18n 段）；
  空态「尚无数据出门记录」。
- 数据源纯内存（useUiStore），零新存储。

### ④ AI 队列补跑 + 尸体清扫（t3）

- store.ts 新增（内部函数 + 两个 action，均非组件 API）：
  - `sweepProcessingCorpses()`：entries status==='processing' → 'failed' +
    processError「应用中断，处理未完成，可重试」，saveEntry 落库 + set。
    hydrate 尾部 fire-and-forget 调（archiveStaleMemories 同款模式）。
  - `retryFailedEntries()`：`!get().online` → no-op；模块级 `retrying` 旗标防并发；
    内存 `autoRetried: Set<string>`（会话级，每条目至多自动补跑一次）；
    failed 条目逐个串行 `await get().processEntry(id, false)`（isFresh=false，
    不弹提醒确认风暴）。hydrate 尾部在 sweep 之后同样 fire-and-forget 调一次。
- main.tsx:63 online listener 内追加 `useUiStore.getState().retryFailedEntries()`
  （offline listener 不动）。
- **非目标**：永久失败判别（重试一次失败即停，会话内不再自动试）；指数退避；
  quota 预估。

## 任务拆分（契约先行 → 3 路并行）

**Lead 契约 commit**：本文件。跨路接口钉死：`composeSharedText` 签名、
`parseZip/readBackup/restoreBackup` 签名、`shareTarget.*`/`settings.importBackup*`/
`detail.upload*` i18n key 命名、manifest share_target 形状、autoRetried 会话级语义。

| Agent | 独占文件 |
|---|---|
| t1-restore-privacy | src/adapters/zipExport.ts、src/adapters/zipImport.ts（新）、src/adapters/__tests__/zipImport.test.ts（新）、src/ui/screens/settings/index.tsx、src/ui/screens/settings/DataOutSheet.tsx（新）、src/ui/screens/settings/__tests__/（新测试）、src/ui/screens/detail/index.tsx、src/app/i18n/zh/settings.ts、src/app/i18n/en/settings.ts、src/app/i18n/zh/detail.ts、src/app/i18n/en/detail.ts |
| t2-share | vite.config.ts、src/app/router.tsx、src/ui/screens/shareTarget/index.tsx（新）、src/ui/screens/shareTarget/__tests__/（新）、src/app/i18n/zh/common.ts、src/app/i18n/en/common.ts |
| t3-queue | src/app/store.ts、src/main.tsx、src/app/__tests__/aiQueueRetry.test.ts（新） |

防撞：三路文件集零交集（已逐路核对）。t1 用现成 rehydrate()/ExportConfirmSheet（加
title prop 属本路文件内组件）；t2 用现成 addPart 不改 store；t3 独吞 store.ts+main.tsx。
i18n 按文件切：t1=settings/detail 四件，t2=common 两件，t3 无。

## 测试要点（TDD）

- t1：zip  round-trip——测试内 mini STORE builder（镜像 buildZip，~40 行测试本地
  helper）造 entries.json+ai.json+media 假包 → parseZip 还原 → restoreBackup（mock
  di.storage 捕获 saveEntry/saveEntryAi/saveMedia/saveCategory/saveTag）断言：新 id
  不等于旧 id、aiId/entryId 重映射、ref 重写且 media 落新 ref、processing→failed、
  slug 冲突保留现有类别、丢媒体 part 的 skipped 计数、entries.json 缺失抛 invalid。
  导出 v2：exportZip 路径产物含 entries/categories/tags.json + manifest.version===2
  （现有 zipExport 测试若存在则扩展，无则在 zipImport.test.ts 同文件覆盖 buildZip
  侧——允许，文件仍归 t1）。DataOutSheet 聚合逻辑（group by modelUsed → count/lastAt）
  纯函数抽出测试；detail 上送行渲染断言（含/不含媒体两态）。
- t2：composeSharedText 三参数组合/全空；screen 测试 MemoryRouter
  `/share-target?text=hello&url=https://x` → addPart 追加 text part（含两行）+
  导航 /capture；空参数 → EmptyState 文案。manifest share_target 由验收 grep dist 产物。
- t3：sweep——processing 条目 → failed+落库；retry——online 时 failed 条目串行
  processEntry（顺序断言）、同条目二次调用不再重试（autoRetried）、retrying 并发
  守卫、offline no-op；hydrate 集成：hydrate 后 processing 尸体已 failed。
- 既有 725 测试防回归；全量绿才报完成。

## 验收（acceptance agent，静态 review + 浏览器 390×844）

1. 三路报齐 → lead 集成：tsc + vitest 全绿 + diff 逐行过 + `npm run build` 绿。
2. 用例：
   ① **真机级 round-trip**（浏览器）：seed/造条目 → 设置导出 zip（Playwright
      `waitForEvent('download')` 截真实导出包）→ 清库或换游客 → 设置恢复备份
      （`setInputFiles` 喂回该包）→ 确认 sheet 计数正确 → 首页出现还原条目、
      AI 元数据/媒体齐、原条目未被覆盖（双份）。
   ② `/share-target?text=...&url=...` → 落 /capture 且文本 part 已在草稿（追加不
      覆盖）；空参数 → 空态。build 后 grep dist manifest.webmanifest 含 share_target。
   ③ 详情页上送行显示真实 modelUsed（含媒体条目有后缀）；设置→数据出门 sheet
      聚合行正确（BYOK 配置过一次 classify 后有行）。
   ④ 造 failed 条目（store.setState 或 IDB 直写）→ 派发 window online 事件 →
      条目离开 failed（processing→ready/failed 均可，**重试发生**即可观察）；
      造 processing 尸体 → reload → hydrate 后变 failed。
3. 全绿 → lead commit（契约+三路+验收记录，~6 个语义 commit）→ 关单。

## 验收记录

（验收 agent 回填）
