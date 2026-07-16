# AiJi · AI 记 — 深度工程评估报告 v3

> 2026-07-17 · lead 亲自逐文件通读 src/ 全部源码 + 配置后撰写
> 基于当前工作区状态（含未提交改动：detail MoreSheet、drafts/trash/categories 新屏）
> 前两轮基于子智能体读旧代码，本轮已修正

---

## 0. 评估方法与范围

逐文件通读 src/ 全部 33 个 TS/TSX + 6 个配置 + 2 个验收文档，并跑 `npx tsc -p tsconfig.app.json` 验证构建（EXIT 0，通过）。覆盖：数据完整性、交互逻辑、用户体验、设计逻辑、后端管线、安全、可安装性。每条 finding 标 file:line + 触发链 + 严重度，并区分「已改」与「未修」。

**代码演进**：自上轮后落了 Wave 3（39ac238）+ Wave 4 shared layer（3de01df）+ 未提交的 detail/categories/drafts/trash 屏。Wave 4 做了半截——shared 层（types/db/ports/store action/StoragePort 方法/drafts+trash 屏文件）已落，但路由注册与入口链接缺失。

---

## 1. 总体结论

| 维度 | 评级 | 说明 |
|------|------|------|
| 构建状态 | ✅ 通过 | tsc EXIT 0（上轮头号 blocker 已修） |
| 核心循环 | 🟡 基本可用 | 采集→落库→STT→LLM 分类→聚合 主链路通，多处竞态/数据隐患 |
| 数据完整性 | 🟠 有隐患 | version 硬编码、settings 不合并 defaults、entryIds 存原始值 |
| 交互/体验 | 🟠 有缺口 | 主题 no-op、onboarding 无 gating、录音泄漏、草稿/回收站不可达 |
| 可安装性 | 🔴 不可安装 | SW 未注册、manifest 冲突、无 apple-touch-icon |
| Wave 4 完成度 | 🔴 半截 | 草稿/回收站视图代码全在，路由+入口没接，用户完全不可达 |

**最严重问题**：Wave 4 草稿视图 + 回收站视图是死代码（路由未注册 + categories 无入口）。detail 的「移到回收站」能进不能出——用户删条目后无法打开回收站恢复。

---

## 2. 🔴 BLOCKER

### B1. 草稿视图 / 回收站视图完全不可达（Wave 4 死代码）

**位置**：
- `src/app/router.tsx` — 路由表无 `/drafts`、`/trash`
- `src/ui/screens/categories/index.tsx` — 无指向 drafts/trash 的按钮
- `src/ui/components/NavBottom.tsx` — 底栏 5 tab 无草稿/回收站入口
- 但 `src/ui/screens/drafts/index.tsx`（135 行完整）+ `src/ui/screens/trash/index.tsx`（191 行完整）+ store 的 loadDraft(id)/deleteDraft/trashEntry/recoverEntry 全部就位

**触发链**：
1. 用户点「存草稿」→ 草稿落 Dexie ✓
2. 想管理多条草稿 → categories 页无草稿入口 → 无法进 /drafts
3. 手动改 URL /drafts → router catch-all `*` → Navigate to="/" → 落回首页
4. detail 点「移到回收站」→ trashEntry 软删 ✓
5. 想恢复 → 无回收站入口 → 无法进 /trash → 条目只能 30 天后自动 purge，用户无法主动恢复

**影响**：Wave 4 两个核心功能（多草稿管理、回收站恢复）对用户完全不可见。草稿只能靠 hydrate 自动恢复最新一条，无法选择/删除/管理；回收站进了出不来。这是 roadmap 标注「Wave 4 候选、待规划」却已落了代码的半成品。

**修复**：router 加 `<Route path="drafts">`、`<Route path="trash">`（挂 BareLayout 或 MainLayout）；categories 页顶部加「草稿 N」「回收站」入口行。

### B2. Service Worker 从未注册 → 不可安装

**位置**：`src/main.tsx` 无 `virtual:pwa-register` import；`vite.config.ts:9` VitePWA `registerType:'autoUpdate'` 但 `injectRegister` 默认 false。

**影响**：vite-plugin-pwa 生成 SW 但运行时无注册代码 → 不满足 PWA installability criteria → Chrome/iOS 不弹「添加到主屏」。整个「可安装 app」目标被这一行卡住。

**修复**：main.tsx 加 `import { registerSW } from 'virtual:pwa-register'; registerSW()`，或 vite.config 加 `injectRegister: 'auto'`。

### B3. 采集保存有 ~1.2s 数据丢失窗

**位置**：`src/ui/screens/capture/index.tsx:70-77` setTimeout 1200ms 后才 finishSave→saveEntry；`src/app/store.ts:264` saveEntry 是 fire-and-forget（不 await）。

**触发链**：点「保存」→ beginSave 设 saving:true → 1200ms 后 finishSave → saveEntry 才发出。这 1.2s 内条目只在 Zustand 内存（不在 Dexie entries，不在 Dexie drafts）。刷新/崩溃 → 文本 part 全丢，已 saveMedia 的媒体 blob 成孤儿。

**注**：Wave 4 的 saveDraft 是手动触发（用户点「存草稿」），不会在 beginSave 时自动存草稿，所以这窗口内确实无持久化兜底。

**修复**：beginSave 时先 saveDraft 兜底，或缩短/去掉 1200ms 延迟并立即 saveEntry。

---

## 3. 🟠 MAJOR — 后端数据完整性

### D1. classify 硬编码 version:1 → 重处理返回过期 AI

**位置**：`src/adapters/deepSeekLlm.ts:210` `version: 1`；`src/adapters/dexieStorage.ts:62` getEntryAi reduce 严格 `>` 无 tie-break。

**触发链**：processEntry 两次跑同一 entry（重处理/重试）→ 两条 EntryAi 都是 version:1 → getEntryAi 在等版本上 reduce 返回 `a`（Dexie toArray 按 uuid 主键序，随机）→ detail 显示的可能是旧 AI，而 entry.aiId 指向新 AI。updateEntryAi 正确 bump version+1，但 classify 路径不 bump。

**影响**：detail 的「重处理」功能（detail/index.tsx:505 handleReprocess）实际可能返回过期分类结果。

**修复**：classify 读现有 getEntryAi 取 version+1；或 getEntryAi reduce 用 `>=` + createdAt tie-break。

### D2. getSettings 不合并 defaults → 升级用户字段 undefined

**位置**：`src/adapters/dexieStorage.ts:99-102` `return row ?? seedSettings`（无 merge）。

**触发链**：旧用户 Settings 行缺 Wave 3 加的 `aggregateDetailLevel` → getSettings 返回 undefined（TS 类型谎称 1|2|3|4|5）→ summary sweep（summary/index.tsx:65）判 `(cur.detailLevel ?? 3) !== undefined` 恒真 → 每次 mount 把所有可见周期判为需重算 → recompute storm + 详细度选择器无 active chip。

**修复**：`return { ...seedSettings, ...row }` 合并默认。

### D3. aggregate 存原始 entryIds 而非校验子集

**位置**：`src/adapters/deepSeekLlm.ts:269` `entryIds`（原始入参），而 `valid`（:240 过滤 null 后）只用于 prompt。

**触发链**：store 调 aggregate(entryIds) 后，若某条目在 range-scan 与 adapter getEntry 之间被删 → 该 ID 残留 Aggregate.entryIds → UI「N 条」计数虚高、详情深链指向幽灵条目。

**修复**：`entryIds: valid.map(v => v.id)`。

### D4. detailLevel 存原始值未 clamp

**位置**：`src/adapters/deepSeekLlm.ts:273` 存 `detailLevel ?? 3`（raw）；`:114` 仅 prompt clamp。

**触发链**：传 detailLevel=99 → 生成 level-5 prompt（clamp）但 Aggregate.detailLevel=99 → stale guard（store.ts:458）`99===99` 跳过重算 → 元数据=99 与 level-5 内容不一致。实际由 settings 限制为 1-5，但 port 契约不保证。

**修复**：存前 clamp `Math.min(5, Math.max(1, detailLevel ?? 3))`。

### D5. deleteEntry 不清 OPFS 媒体，StoragePort 无 deleteMedia

**位置**：`src/app/store.ts:579` deleteEntry、`src/adapters/dexieStorage.ts:152` deleteEntry（已级联 entryAi+reminders，但不清 OPFS）、`src/ports/index.ts` 无 deleteMedia 方法。

**触发链**：硬删条目（回收站「永久删除」或 30 天 purge）→ Dexie 行清了，但 OPFS 媒体 blob（audio/video）永久累积。A2 存储配额风险（iOS 尤甚）。Wave 4 软删不删媒体是合理的（恢复需要），但 purge/硬删路径应清媒体。

**修复**：StoragePort 加 deleteMedia(ref)，purgeExpired + deleteEntry 调用。

### D6. category/tag usageCount 永不递增

**位置**：`src/adapters/deepSeekLlm.ts:191,202` 新建写 0、复用不动。

**影响**：usageCount 永远停在 seed 值（18/12/9…），与真实条目数脱节。若 UI 按 usageCount 排序/筛选，顺序是虚构的。目前 UI 未按 usageCount 排序，影响较低。

### D7. saveEntry fire-and-forget vs processEntry.getEntry 竞态

**位置**：`src/app/store.ts:264`（void saveEntry 不 await）+ `:266`（立即 processEntry）+ `:412` processEntry 内 getEntry，`if(entry)` false 静默跳过、无 finally。

**触发链**：慢设备/忙 IndexedDB 时 saveEntry 未提交，processEntry 的 getEntry 返 undefined → ready 更新被跳过且不抛错（catch 不触发）→ 条目卡 processing 永久转圈，无 AI 卡。

**修复**：finishSave 内 await saveEntry 后再 processEntry；或 processEntry 开头 await 一个 microtask/重试 getEntry。

### D8. 清空 key 时不删 secret

**位置**：`src/app/store.ts:367,374` `apiKeyRef: key ? 'llm:key' : cur.apiKeyRef`（保留 ref）+ `if(key)` 跳过 secrets.set。SecretStorePort 也无 delete 方法。

**触发链**：用户在 BYOK 设置清空 key 输入框保存 → apiKeyRef 保留 'llm:key'，localStorage['llm:key'] 旧 key 残留 → UI 显示「已配置」但用户以为清了 → XSS 可读旧 key。

**修复**：清空时 `di.secrets.delete('llm:key')` + apiKeyRef=undefined；SecretStorePort 加 delete。

### D9. recomputeAggregate 的 recalculating flag 只 set 不 check

**位置**：`src/app/store.ts:461` set recalculating，`:458` 唯一 guard 是 `existing.stale`，不 check recalculating。

**触发链**：processEntry（store.ts:435）与 summary onRegen（summary/index.tsx:151）并发调同一 scope+range 的 recomputeAggregate → 都过 stale guard（processEntry 先置 stale）→ 都 set recalculating=true → 两次 `di.llm.aggregate` 付费调用，结果互相踩。summary sweep 有 RECOMPUTE_CONCURRENCY=2 限流（:24）但不防跨 source。

**修复**：recomputeAggregate 开头 `if (get().recalculating[key]) return`。

### D10. TodoConfirm + ReminderConfirm 同时渲染 → 窄竞态双提醒

**位置**：`src/ui/screens/detail/index.tsx:512`（TodoConfirm 条件：category==='errand' || facets.event）+ `:521`（ReminderConfirm 条件：reminderSuggestion）。两条件可同真，todoHidden/reminderHidden 独立本地旗标。

**触发链**：errand+suggestion 条目，两卡同显。点 TodoConfirm「提醒我」→ confirmReminder 建 R1 + 异步（.then）清 suggestion。在 store state 更新前点 ReminderConfirm「确认提醒」→ confirmReminder 建 R2。需两卡都点才双建，且 state 更新后第二卡消失——比上轮描述窄，但竞态真实。

**修复**：两卡互斥渲染（有 reminderSuggestion 时只显 ReminderConfirm），或 confirmReminder 同步清 suggestion（await saveEntryAi）。

### D11. confirmReminder 清 suggestion 与在途 processEntry 竞态

**位置**：`src/app/store.ts:518-522` 清 suggestion fire-and-forget；processEntry:408-409 saveEntryAi(ai) 含原 suggestion。

**触发链**：用户快速确认 suggestion 时 processEntry 在途 → processEntry 的 saveEntryAi 覆盖 cleared 版本 → suggestion 复活 → reload 后 ReminderConfirm 卡重现 → 可重确认建重复 Reminder。

---

## 4. 🟠 MAJOR — 验收/功能

### A1. 主题切换完全 no-op
`src/ui/screens/settings/index.tsx:318` setSettings({theme}) 只更新 store+Dexie；全 src 无 classList/data-theme/documentElement；tailwind.config.js 无 darkMode。点「暗色」屏幕不变。

### A2. 无首次运行 onboarding gating
`src/app/router.tsx` 无 `/`→`/onboarding` 重定向，无 firstRun flag；onboarding onStart 不设「已看过」。新用户直落 Home（seed 数据），永远看不到 onboarding/BYOK/权限流。onboarding 形同孤儿。

### A3. summary 周 range key（ISO week）与 label（滚动 7 日窗）不一致
`src/ui/screens/summary/aggregate.ts:107-120` scopeRange 用 ISO week（Mon-Sun）；`:183-190` periodLabels 用滚动 [ref-6,ref]。store.ts:81-94 与 aggregate.ts:107-120 是同一 ISO 算法的**两份重复拷贝**。now=周五 7/17：W29 key=7/13-7/19，label=7/11-7/17。7/11、7/12 条目归 W28 却显示在标「7/11-7/17」的 W29 卡内。设计逻辑缺陷。

### A4. offline-pending 死状态 + 无自动重试队列
`src/domain/types.ts:32` 定义但 store 从不写（catch 全写 failed，store.ts:440）；setOnline 零调用方（online 恒 true）。离线保存 → 标 failed 而非「联网后重试」；恢复网络不自动重跑 failed 条目。seed e9 带 offline-pending 但用户条目永不进入此状态。仅手动 detail 重处理可 retry。

### A5. onboarding API Key 明文输入
`src/ui/screens/onboarding/index.tsx:66` `type="text"`（settings 的 ByokSheet 用了 password，onboarding 没用）。

### A6. manifest 冲突
`index.html:11` 链静态 `/manifest.webmanifest`（只列 favicon.svg）vs `vite.config.ts:19-22` VitePWA 列 192/512 PNG。public/ 后拷贝覆盖同路径 → 浏览器可能拿到 SVG-only manifest，Android 512 maskable 检测失败。

---

## 5. 🟠 MAJOR — 资源泄漏

### L1. 录音在卸载/关闭时不停止
`src/ui/screens/capture/index.tsx` 的 useEffect cleanup 只 revoke objectURLs + clear interval/timeout（:60,66,76,91），**无 stopRecording/stopAudio**。录音中按 X（onClose:183 navigate('/')）→ MediaRecorder/WebSpeech 流常驻，麦克风指示灯不灭。

### L2. MediaRecorder 构造失败泄漏 mic 流
`src/adapters/webCapture.ts:81` `new MediaRecorder(stream)` 无 try/catch；stream 已 getUserMedia 成功。构造抛错（Safari MIME 边界）→ throw 传播，store.ts:220 catch 设 recording:false 但不调 stopAudio；stopRecording:225 早返 `!recording` → stopAudio 的 track.stop()（webCapture.ts:122）永不执行 → mic 灯长亮。

### L3. pickMedia 移动端取消时永久挂起
`src/adapters/webCapture.ts:221-228` 无 timeout fallback；onFocus 监听器在 onchange 成功路径不 remove（依赖 onFocus 后续触发清理）。移动端（iOS Safari/Android Chrome）文件选择器取消不触发 window.focus → picked promise 永挂 → handleGallery 卡死、input 泄漏 DOM。桌面端 listener 延迟清理（非永久泄漏，上轮措辞已修正）。

---

## 6. 🟠 MAJOR — 安全/构建

### S1. STT key 走 WS query string → 服务端日志泄露
`src/adapters/paraformerStt.ts:59` `?api_key=${encodeURIComponent(apiKey)}`。落入 DashScope 访问日志/DevTools Network/中间代理。注释承认浏览器 WS 无法设自定义头，是唯一选项。建议定期轮换 + 注意日志分享。

### S2. .env.local 真实 key 经 dev server 暴露
`vite.config.ts:35` host:true + allowedHosts:true；Vite 内联 VITE_ 前缀进 dev bundle。LAN/tunnel（cloudflared/ngrok）可 curl bundle 提取 LLM+STT key。.env.local 已 gitignore（未入库），但磁盘+网络暴露。**建议立即轮换两 key**。

### S3. tsconfig 未开 strict
`tsconfig.app.json` 无 strict/strictNullChecks/noImplicitAny。CLAUDE.md §6 声称 strict 与实际不符。后果：`JSON.parse`→`any`→`as ClassifyResult`（deepSeekLlm.ts:88,155）零校验，畸形 LLM 响应静默流入 EntryAi.facets。

### S4. 缺 apple-touch-icon + PNG 占位
`index.html` 无 `<link rel="apple-touch-icon">`；`public/icon-192.png`=593B、`icon-512.png`=2.2KB（真 512 RGBA PNG 应 >10KB，疑近空白）。iOS 主屏图标退化截图。

---

## 7. 🟡 MINOR

- **ai.tags 不去重**：LLM 返 `["foo","foo"]` 直接存（deepSeekLlm.ts:212），detail 标签行重复渲染。
- **thinking:{type:'disabled'} 是 DeepSeek 私有参**：严格 OpenAI 兼容服务（Azure/vLLM/llama.cpp）返 400（deepSeekLlm.ts:175,251）。port 契约称「OpenAI 兼容」有误导。
- **通知前台 setTimeout**：tab 后台被节流，到期提醒可能迟到/不响（notifications.ts + store.ts:153）。无 push server，app 关闭不响。
- **zipExport 照片导出 .bin**：extFromType 无 jpeg/png/webp 分支（zipExport.ts:151），image/jpeg 落到 .bin。
- **zipExport 全内存 + 无 hydrate guard**：每 media blob arrayBuffer 进内存拼一个 Uint8Array（zipExport.ts:134），大量媒体 OOM 风险；读 useUiStore.getState().entries 同步（:202），导出早于 hydrate 出种子数据。
- **hydrate 与 finishSave 竞态**：慢启动时 saveEntry 未提交，hydrate 的 listEntries 覆盖 entries → 刚存条目从 UI 消失（store.ts:198 vs 255，窄窗）。
- **草稿 saveDraft/clearDraft 均 fire-and-forget**：put 与 delete 无序 → 草稿复活竞态（store.ts:298,276）。Wave 4 resumedDraftId 机制缓解了大部分，但极端时序仍可能。
- **逾期提醒快速连续 scheduleReminders 双触发**：overdue 路径直接 fireReminder/markMissed 不设 timeout，`scheduledTimeouts.has` guard 不生效（store.ts:147-150）。
- **ensureSeeded 无并发 guard**：hydrate Promise.all 5 个方法并发调 ensureSeeded，模块级 `seeded` flag 在 await 间都为 false → 5× bulkPut（幂等无损坏但 5× I/O，dexieStorage.ts:18-40）。
- **reprocess 双击无 in-flight guard**：handleReprocess 不 check reprocessing（detail/index.tsx:505），但 setReprocessing(true) 触发 state='processing' 卸载按钮，UI 实际缓解。
- **fired/missed 提醒列表无法删除**：只 navigate，无 dismiss 按钮（reminders/index.tsx:112,142），累积。
- **localStorageSecrets.set 无 try-catch**：与 get 不对称（:15），QuotaExceeded 时抛出。
- **paraformerStt resolve 路径不调 ws.close()**：依赖服务端关（:133），socket 可能 linger。
- **getAggregate 注释谎称复合索引**：实为 scope.type + scope.range 两个单字段索引，range 在 JS filter（dexieStorage.ts:89）。
- **scopeRange 函数重复实现**：store.ts:81-94 与 aggregate.ts:107-120 两份相同拷贝，改一处忘另一处风险。
- **src/types/chinese-s2t.d.ts 未提交**：typecheck 需要（chinese-s2t 无类型），应 commit。
- **maximum-scale=1.0**：禁缩放，WCAG 1.4.4 违反（index.html:6）。
- **theme-color 不一致**：index.html #f7f7fa vs manifest #4f46e5。

---

## 8. 设计逻辑评估

### 8.1 优点
- **端口/适配器分层干净**：Domain + Port 零 PWA 耦合，Capacitor 退路真实可行（只换 CapturePort/StoragePort 适配器）。
- **AI-only 降级贯彻**：LLM/STT 失败只伤 AI 层（条目标 failed），采集存储不受影响——符合 PRD「断网不丢」。
- **涌现分类设计正确**：LLM 复用/新建类别 slug，用户可策展，未硬编码类别集（守住 §1 铁律）。
- **回收站软删设计合理**：deletedAt 与 EntryStatus 分离（recover = 清字段，无需记 pre-delete status），30 天 purge 级联 AI/提醒。
- **summary 详细度 5 级 + sentences 数组强约束**：LLM 对「恰好 N 个数组元素」服从度高于「N 句话」，prompt 工程到位（defects.md D1 验证通过）。
- **提醒 Q1-Q4 设计周全**：foreground-only 明确、overdue <1h 补推/>1h 标 missed、snooze 锚 max(now,dueAt)、首次确认才请求权限。

### 8.2 设计逻辑缺陷
- **Wave 4 半截交付**：shared 层完整但路由+入口缺失，是典型的「后端先行、UI 接入滞后」。roadmap 标「候选待规划」但代码已落，状态不一致。
- **ISO week 与滚动周窗混用**（A3）：range key 用 ISO（Mon-Sun），label 用滚动 [ref-6,ref]，两者语义不同。应统一为 ISO week label 或滚动窗 key。
- **fire-and-forget 泛滥**：saveEntry/saveDraft/clearDraft/saveReminder/saveEntryAi 全 fire-and-forget + .catch 吞错。设计意图是「存储失败不伤 UI」，但累积成多处竞态（D7/D11/草稿复活/hydrate 覆盖）。需在关键路径（finishSave、confirmReminder）await。
- **offline-pending 定义不用**（A4）：类型定义了状态、UI 有分支、seed 有样例，但 store 从不写。要么实现自动重试，要么删类型避免误导。
- **recalculating 与 stale 职责重叠**：recalculating 只驱动 spinner 不防并发，stale 才是唯一 guard——导致 D9 双算。应让 recalculating 也参与 guard。

---

## 9. 相对前两轮的修正

1. **✅ 头号 blocker 已修**：上轮的 C1-C4（clearDraft/loadDraft/id:1 构建失败）已全部修复。Wave 4 多行草稿 API 完整对齐，typecheck EXIT 0。
2. **🆕 新发现 B1**：drafts/trash 路由+入口缺失。上轮代码还没这两屏，本轮新发现。
3. **D5 修正**：dexieStorage.deleteEntry 现在级联清 reminders（上轮说「不级联」已过时）；OPFS 媒体不清仍真。
4. **D10 降级**：双卡同显真，但需两卡都点确认才双建，且 state 更新后第二卡消失——比上轮「必双建」窄。
5. **Wave 4 回收站接上 detail**：detail 的 handleConfirmDelete 现调 trashEntry（软删）而非 deleteEntry，ConfirmDeleteDialog 文案改「移到回收站」。但回收站视图本身不可达（B1）。
6. **summary sweep 加并发限制**：RECOMPUTE_CONCURRENCY=2 缓解 D9 的 UI 侧，但 store 层 recomputeAggregate 仍不 check flag。
7. **scheduleReminders 跳过 trashed 条目**：store.ts:144 新增 guard，回收站条目的提醒不调度——好的设计。
8. 其余 B2/B3/D1-D9/A1-A6/L1-L3/S1-S4 经本轮亲自通读**全部确认仍存在**。

---

## 10. 修复优先级建议

**P0 — 让 Wave 4 可达 + 可安装（半天）**：
- B1 注册 /drafts、/trash 路由 + categories 加入口
- B2 注册 SW（一行）
- B3 beginSave 兜底 saveDraft 或去 1200ms 延迟
- A6 删静态 manifest 让 VitePWA 接管
- S4 加 apple-touch-icon + 真出图

**P1 — 后端数据完整性（1-2 天）**：
- D7 finishSave await saveEntry
- D1 classify version 递增
- D2 getSettings 合并 defaults
- D3 entryIds 存 valid
- D4 detailLevel clamp
- D8 清 key 删 secret
- D9 recompute check recalculating
- D5 加 deleteMedia + purge 调用

**P2 — 验收 + 竞态**：
- A1 theme 应用 DOM（加 darkMode + classList effect）
- A2 onboarding gating（settings 加 onboarded flag + router 重定向）
- A3 统一 week key/label（用 ISO week label）
- A4 offline-pending 自动重试 或 删类型
- D10/D11 提醒卡互斥 + 清 suggestion await
- L1/L2/L3 采集资源清理（unmount stopRecording + MediaRecorder try/catch + pickMedia timeout）

**P3 — 死代码决策**：
- offline-pending 要么实现要么删
- drafts/trash 接入后即激活
- fired/missed 提醒加清理
- thinking param 条件化（非 DeepSeek 时不发）

---

## 11. 验收状态对照（docs/acceptance/defects.md）

defects.md 的 D1/D2/D3（验收层：摘要句数/a11y name/snoozed 标签）**已修并通过 pass 2 复验**。这些是 E2E 验收缺陷，与本报告的工程 bug 是两套体系——那 3 个真修了，不影响本报告结论。N4「tsc clean」与本次复验一致（EXIT 0）。

**本报告新增的工程问题均不在 defects.md 中**，建议补录。
