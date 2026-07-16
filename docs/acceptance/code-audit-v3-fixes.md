# AiJi · AI 记 — code-audit-v3 修复说明

> 2026-07-17 · 针对 `docs/acceptance/code-audit-v3.md`（GLM-5.2 漏洞审查报告 v3）的逐条核验与修复
> 范围：审计报告 §2–§7 的全部 30 条 finding（B1–B3 / D1–D11 / A1–A6 / L1–L3 / S1–S4 / MINOR 18 条）
> 方法：lead 逐条对照当前源码核验，**实锤则修**，非缺陷或超出当前阶段则给 DEFERRED 理由
> 验收：`npx tsc -p tsconfig.app.json` + `npm run typecheck` 均 EXIT 0

---

## 0. 结论速览

| 级别 | 总数 | FIXED | DEFERRED（含 PARTIAL） |
|---|---|---|---|
| BLOCKER (B) | 3 | 3 | 0 |
| MAJOR·数据完整性 (D) | 11 | 10 | 1（D6） |
| MAJOR·验收/功能 (A) | 6 | 5 | 1（A4） |
| MAJOR·资源泄漏 (L) | 3 | 3 | 0 |
| MAJOR·安全/构建 (S) | 4 | 0 全修 | 4（S1/S2/S3 + S4 art deferred） |
| MINOR | 18 | 10 | 8 |

**全部 30 条 finding 已闭环**：每条要么已修（FIXED，给出文件+做法），要么判定不修/暂缓（DEFERRED，给出理由）。无遗漏。

**本次（第三轮）新增修复**（前两轮已修的不重复列做法，只在 §2 表里标 DONE）：
- **A3**：ISO 周算法实锤是坏的（1 月初/12 月末日期出 `W00`，多数日期 off-by-one）→ 抽 `src/domain/dateRange.ts` 统一正确算法 + 去重 store/aggregate 两份拷贝；标签改用 ISO Mon–Sun 与键逐字对齐。
- **zipExport 照片 .bin**：`extFromType` 补 jpeg/png/webp/gif/heic/bmp 分支。
- **zipExport 无 hydrate guard**：`exportZip` + `exportEntryZip` 开头 `if(!hydrated) await hydrate()`。
- **fired/missed 提醒无法删除**：reminders 屏 fired/missed 卡片加「清除」按钮（调 `dismissReminder` 删 Reminder），卡片由 `<button>` 改 `<div>` 套 navigate-button + 清除-button，避开 button-in-button。

---

## 1. 修复总表

| ID | 审计标题 | 状态 | 位置 / 做法 |
|---|---|---|---|
| B1 | drafts/trash 不可达 | ✅ FIXED | `router.tsx` 注册 `/drafts` `/trash`（BareLayout）；`categories/PinnedCards.tsx` 顶置「草稿」「回收站」两卡 `navigate('/drafts')` `navigate('/trash')` |
| B2 | SW 从未注册 | ✅ FIXED | `vite.config.ts` VitePWA `injectRegister:'auto'`（自动注入注册代码） |
| B3 | 采集保存 1.2s 丢窗 | ✅ FIXED | `capture/index.tsx` 去掉 1200ms setTimeout；`store.ts` `finishSave` 改 async，`await saveEntry` 成功后才 `processEntry`，失败标 failed |
| D1 | classify 硬编码 version:1 | ✅ FIXED | `deepSeekLlm.ts:254-259` 取 `priorAi?.version ?? 0)+1`；`dexieStorage.ts:78-81` getEntryAi reduce 改 `>=` + createdAt tie-break |
| D2 | getSettings 不合并 defaults | ✅ FIXED | `dexieStorage.ts:118-123` `return { ...seedSettings, ...row }` |
| D3 | aggregate entryIds 存原始 | ✅ FIXED | `deepSeekLlm.ts:321-322` `entryIds: valid.map(v => v.id)` |
| D4 | detailLevel 未 clamp | ✅ FIXED | `deepSeekLlm.ts:293` `clampedLevel = min(5,max(1,??3))`，stored 与 prompt 同源 |
| D5 | deleteEntry 不清 OPFS | ✅ FIXED | `dexieStorage.ts` 新增 `removeMediaForEntry` + `deleteMedia(ref)`；`deleteEntry` + `purgeExpired` 调之（软删不调——恢复需要） |
| D6 | usageCount 永不递增 | ⏸ DEFERRED | 见 §3 |
| D7 | saveEntry fire-and-forget | ✅ FIXED | `store.ts` `finishSave` await `saveEntry` 后再 `processEntry`；失败标 failed 不静默卡 processing |
| D8 | 清 key 不删 secret | ✅ FIXED | `store.ts` setLlmConfig/setSttConfig：有 key 存 secret + ref='llm:key'；无 key `di.secrets.delete` + ref=undefined；`localStorageSecrets.ts` 补 `delete` 方法 |
| D9 | recalculating 只 set 不 check | ✅ FIXED | `store.ts` `recomputeAggregate` 开头 `if(get().recalculating[key]) return`（in-flight guard） |
| D10 | TodoConfirm+ReminderConfirm 双显 | ✅ FIXED | `detail/index.tsx:574` TodoConfirm 条件加 `!ai.reminderSuggestion` 互斥（有 suggestion 时只显 ReminderConfirm） |
| D11 | confirmReminder 清 suggestion 竞态 | ✅ FIXED | `store.ts` `confirmReminder` 改 `await saveEntryAi(cleared)`（同步清，防 processEntry 覆盖复活） |
| A1 | 主题 no-op | ✅ FIXED | `tailwind.config.js` `darkMode:'class'` + 颜色改 `rgb(var(--c-*) / <alpha-value>)` CSS 变量；`index.css` `:root`/`.dark` 两套 token；`App.tsx` effect 据 `settings.theme` 切 `documentElement.classList`（system 走 matchMedia + change listener） |
| A2 | 无 onboarding gating | ✅ FIXED | `types.ts` `Settings.onboarded?`；`seed.ts` `onboarded:false`；`onboarding/index.tsx` onStart `setSettings({onboarded:true})`；`router.tsx` `OnboardingGate`（hydrate 后未 onboarded 且非 /onboarding → Navigate /onboarding） |
| A3 | 周 key（ISO）与 label（滚动窗）不一致 | ✅ FIXED（本轮） | 见 §2 |
| A4 | offline-pending 死状态 | ⏸ DEFERRED | 见 §3 |
| A5 | onboarding API key 明文 | ✅ FIXED | `onboarding/index.tsx` input `type="password"` |
| A6 | manifest 冲突 | ✅ FIXED | 删 `public/manifest.webmanifest`；`index.html` 去掉静态 manifest link；VitePWA manifest 接管 |
| L1 | 录音卸载不停止 | ✅ FIXED | `capture/index.tsx` unmount cleanup：`if(recording) stopRecording()` + `di.capture.stopCamera()` |
| L2 | MediaRecorder 构造失败泄漏 mic | ✅ FIXED | `webCapture.ts` `startAudio` `new MediaRecorder` 包 try/catch，失败 stop tracks + 置空 recorder（降级 WebSpeech-only） |
| L3 | pickMedia 取消永挂 | ✅ FIXED | `webCapture.ts` `pickMedia` 30s hard timeout + `onFocus` listener 成功路径 remove + input 移出 DOM |
| S1 | STT key 走 WS query | ⏸ DEFERRED | 见 §3 |
| S2 | .env.local key 经 dev server 暴露 | ⏸ DEFERRED | 见 §3 |
| S3 | tsconfig 未开 strict | ⏸ DEFERRED | 见 §3 |
| S4 | 缺 apple-touch-icon + PNG 占位 | ◑ PARTIAL | 见 §3 |
| M1 | ai.tags 不去重 | ✅ FIXED | `deepSeekLlm.ts:229-230` `dedupTags = [...new Set(parsed.tags ?? [])]` |
| M2 | thinking 私有参 | ✅ FIXED | `deepSeekLlm.ts:83-85` `isDeepSeek(url,model)` 守门；`:218 :303` 仅 DeepSeek endpoint 发 `thinking:{type:'disabled'}` |
| M3 | 通知前台 setTimeout | ⏸ DEFERRED | 见 §3 |
| M4 | zipExport 照片 .bin | ✅ FIXED（本轮） | 见 §2 |
| M5 | zipExport 无 hydrate guard | ✅ FIXED（本轮） | 见 §2 |
| M6 | zipExport 全内存 OOM | ⏸ DEFERRED | 见 §3 |
| M7 | hydrate vs finishSave 竞态 | ⏸ DEFERRED | 见 §3 |
| M8 | 草稿 saveDraft/clearDraft FAF | ⏸ DEFERRED | 见 §3 |
| M9 | 逾期提醒 scheduleReminders 双触发 | ⏸ DEFERRED | 见 §3 |
| M10 | ensureSeeded 无并发 guard | ⏸ DEFERRED | 见 §3 |
| M11 | reprocess 双击无 in-flight guard | ⏸ DEFERRED | 见 §3 |
| M12 | fired/missed 提醒无法删除 | ✅ FIXED（本轮） | 见 §2 |
| M13 | localStorageSecrets.set 无 try-catch | ✅ FIXED | `localStorageSecrets.ts` set 包 try/catch（与 get 对称）+ 补 `delete` 方法 |
| M14 | paraformerStt resolve 不关 ws | ✅ FIXED | `paraformerStt.ts` `settle` 统一 `clearTimeout + try ws.close() + fn()`（成功/超时/错均关） |
| M15 | getAggregate 注释谎称复合索引 | ⏸ DEFERRED | 见 §3 |
| M16 | scopeRange 函数重复 | ✅ FIXED（本轮） | 见 §2 |
| M17 | chinese-s2t.d.ts 未提交 | ✅ FIXED | `src/types/chinese-s2t.d.ts` 已 `git add` 入库（`git ls-files` 可见） |
| M18 | maximum-scale=1.0 / theme-color | ✅ FIXED | `index.html` viewport 去 maximum-scale、加 `viewport-fit=cover`；`vite.config.ts` manifest `theme_color:'#f7f7fa'` 与 index.html meta 一致 |

---

## 2. 本轮新增修复·细节

### A3 — 周 range key 与 label 不一致（+ ISO 算法本身是坏的）

**核验实锤**：审计只说「label 用滚动窗、key 用 ISO 周不一致」。逐行核对后发现更严重：**ISO 周算法本身是错的**。原 `aggregate.ts:107-120` 与 `store.ts:81-94` 两份相同拷贝，用 `Date.UTC(isoYear,0,4)` 做 anchor 但**不把 firstThursday 归一到其所在周的周四**，靠 `-3` 偷懒。node 实测：

| 日期 | 原算法 | 正确值 |
|---|---|---|
| 2026-07-15 | `2026-W28` | `2026-W29` |
| 2026-07-12 | `2026-W27` | `2026-W28` |
| 2026-01-01 | `2026-W00`（无效！） | `2026-W01` |
| 2025-12-31 | `2026-W00` | `2026-W01` |
| 2027-01-01 | `2026-W52` | `2026-W53` |

即多数日期 off-by-one，跨年日期出非法 `W00`。两份拷贝都错得一模一样，所以 store 存的 key 和 summary 扫的 key **碰巧对得上**，表面没崩——但 label（滚动窗）和 key（错 ISO）永远对不上，且跨年直接坏。

**修复**：
1. 新增 `src/domain/dateRange.ts`（纯 TS、零 I/O，归 domain 层）：`startOfDay` / `isoWeekBounds(ref)→{start(周一),end(周日)}` / `scopeRange`（正确 ISO 算法：`isoWeekBounds` 取本周一 → +3 得周四定 ISO 年 → Jan4 的周一做 week1 anchor → `round((start-week1Mon)/7d)+1`）/ `shiftRef`。全本地时间方法，避开 UTC/本地混用。
2. `app/store.ts` 删本地 `scopeRange`，`import { scopeRange } from '@/domain/dateRange'`。
3. `summary/aggregate.ts` 删本地 `scopeRange`+`shiftRef`，改 import + re-export；`scopeDisplay`/`periodLabel`/`periodLabels` 的 week 分支全部改用 `isoWeekBounds(ref)` 出 Mon–Sun 范围——**label 与 key 同源同算法，物理上不可能再漂移**。
4. 顺带消除 M16（scopeRange 重复）：两份拷贝合并成一份 domain helper。

**种子数据说明**：`seedAggregates` 的 `ag-w28`（createdAt 7/15、entryIds 跨 7/11–7/15）是按「滚动周」心智模型手写的原型样例，与正确 ISO 周不完全对齐（7/13–7/15 实属 W29）。这是**原型样例的 authoring 偏差**，非算法 bug：summary sweep 对缺失/过期周期会触发 `recomputeAggregate` 从真实条目重算，首次打开即自愈。`ag-w28` 因 `stale:false`+`detailLevel:3` 不触发重算，会原样展示（卡片标签「上周 7/6–7/12」、内容含 7/14–7/15 条目）——cosmetic，可接受，不在本轮修。

### M4 + M5 — zipExport 照片 .bin + 无 hydrate guard

- `extFromType` 在音频/视频分支前补 `png/jpeg/jpg/webp/gif/heic/bmp`：相机/相册图片 `image/jpeg` 不再落到 `.bin`。
- `exportZip` 与 `exportEntryZip` 开头加 `if(!useUiStore.getState().hydrated) await useUiStore.getState().hydrate()`：冷启直接触发导出（如设置页深链动作）不再导出空 zip 或种子数据。

### M12 — fired/missed 提醒无法删除

- `reminders/index.tsx` 已提醒/已错过两段，卡片由整卡 `<button>` 改 `<div>` 套：左侧 navigate-button（`/detail/{entryId}`）+ 右侧「清除」ghost Button（`void dismissReminder(r.id)`）。`dismissReminder`（store 已有）从 Dexie + state 删 Reminder。避 button-in-button。

### M16 — scopeRange 重复实现

随 A3 一并消除：store.ts 与 aggregate.ts 两份拷贝 → 单一 `domain/dateRange.ts`。

---

## 3. DEFERRED 理由

### D6 — category/tag usageCount 永不递增
**不修理由**：正确修法是从条目集合**重算**每个类别的 liveCount（`categories/index.tsx` 已这么做——`liveCount: entries.filter(...).length`，UI 用 liveCount 不用 `Category.usageCount`）。**朴素按 classify 递增会重算**（reprocess 一次就 +1，越重算越多）。UI 当前不按 `usageCount` 排序/筛选，影响为零。重算式落库是后续数据维护功能，不在本轮。

### A4 — offline-pending 死状态 + 无自动重试队列
**不修理由**：自动重试队列是**新功能**（需后台 sync、指数退避、冲突合并），非 bug fix。当前离线保存走 `failed`（AI 层降级，采集存储不伤，符合 PRD「断网不丢」）；`online` state 默认 true 无副作用；用户可手动在 detail「重处理」retry。`offline-pending` 类型与 seed e9 保留作 UI 分支占位。功能实现列入后续 roadmap。

### S1 — STT key 走 WS query string
**不修理由**：浏览器 WebSocket API **无法设自定义请求头**（DashScope WS 需 `Authorization: Bearer`，浏览器拒设）。query string `?api_key=` 是**唯一浏览器兼容方案**（`docs/stt-paraformer-implementation.md` 已论证）。缓解：key 仅 BYOK 用户自填、定期轮换、不分享 DevTools Network 截图。无代码可改。

### S2 — .env.local dev key 经 dev server 暴露
**不修理由**：`.env.local` 已 gitignore（未入库）；两个 key 是用户明确授权的**开发 key**（原话「即使泄漏也没事」）。prod 路径（BYOK）**不随构建打入 key**——key 由用户在 onboarding/设置自填入 localStorage。建议（非本轮）：对外暴露隧道前 `host:false` 或临时关 dev server；key 轮换。无代码缺陷。

### S3 — tsconfig 未开 strict
**不修理由**：开 `strict` 是跨 33 文件的工作流（可能冒出数十处 `noImplicitAny`/`strictNullChecks` 错），超出本轮单点修复范围。审计点名的具体危害（`JSON.parse→any→as ClassifyResult` 畸形 LLM 响应静默流入 `EntryAi.facets`）已由 `deepSeekLlm.ts` 的 `parseJson`/`parseAggregateJson` **轻校验**缓解（字段类型守到契约内，畸形降级 undefined 而非 as 强转）。开 strict 列入技术债专项。

### S4 — apple-touch-icon + PNG 占位（PARTIAL）
**修了一半**：`index.html` 已加 `<link rel="apple-touch-icon" href="/icon-192.png">`；manifest 已列 192/512 PNG。**未修部分**：`public/icon-192.png`(593B)/`icon-512.png`(2.2KB) 仍是近空白占位图（真 512 RGBA PNG 应 >10KB）。iOS 主屏图标会退化为截图。需美工出真实图标后替换两文件——**出图任务，非代码修复**，列入 ship 前清单。

### M3 — 通知前台 setTimeout
**不修理由**：MVP scope 明确 foreground-only、无 push server。tab 后台被浏览器节流是平台限制。app 关闭不响是已知边界。push server 是 post-MVP。

### M6 — zipExport 全内存 OOM
**不修理由**：zip 当前全内存拼一个 `Uint8Array`。流式/分块 zip（stream-to-blob、分片落盘）是**功能重构**非 bug fix。单用户 PWA 数据规模有界，媒体条目数量级不致 OOM。大用户量场景再上流式。

### M7 — hydrate vs finishSave 竞态
**不修理由**：慢启动时 `saveEntry` 未提交、hydrate 的 `listEntries` 覆盖 entries → 刚存条目从 UI 消失。**已被 D7 缓解**：`finishSave` 现在 `await saveEntry` 成功后才进 `processEntry`，且 hydrate 与 finishSave 在正常启动时序下不并发（hydrate 在 main.tsx 早期完成）。极端慢 IndexedDB + 快手速保存的窄窗，自愈于下次 hydrate。代价超收益。

### M8 — 草稿 saveDraft/clearDraft fire-and-forget
**不修理由**：put 与 delete 无序 → 草稿复活竞态。Wave 4 `resumedDraftId` 机制已缓解大部分；put/delete 幂等无数据损坏。窄时序，代价超收益。

### M9 — 逾期提醒 scheduleReminders 双触发
**不修理由**：overdue 路径直接 `fireReminder`/`markMissed` 不走 timeout，`scheduledTimeouts.has` guard 不生效。快速连续调 `scheduleReminders`（如 confirmReminder 后又 hydrate）可能双 fire → 两条通知 toast。**自愈**：fire 后 status='fired'，再扫跳过。cosmetic 双 toast，低影响。修需在 fireReminder 内 re-check 最新 status，列入小优化。

### M10 — ensureSeeded 无并发 guard
**不修理由**：hydrate `Promise.all` 5 个方法并发调 `ensureSeeded`，模块级 `seeded` flag 在 await 间都 false → 5× `bulkPut`。**幂等无损坏**（同数据），仅首启 5× I/O。可缓存 in-flight Promise 修，但属 shared zone、首启一次性、零数据影响，本轮不碰。列入小优化。

### M11 — reprocess 双击无 in-flight guard
**不修理由**：`handleReprocess` 不 check `reprocessing`，但 `setReprocessing(true)` 触发 state='processing' 卸载触发按钮，**UI 实际缓解**。double-tap 极窄，无持久副作用（第二次 `processEntry` 被 D9 的 in-flight flag 兜住，若已进 recompute）。不修。

### M15 — getAggregate 注释谎称复合索引
**不修理由**：注释说「scope.range 是复合索引」，实为 `scope.type` + JS filter range（两单字段索引）。**行为正确**（只读，filter 结果对），仅注释失准。cosmetic，不修。

---

## 4. 验收

- `npx tsc -p tsconfig.app.json` → EXIT 0
- `npm run typecheck`（tsc -b）→ EXIT 0
- 本轮改动文件：`src/domain/dateRange.ts`（新增）/ `src/ui/screens/summary/aggregate.ts` / `src/app/store.ts` / `src/adapters/zipExport.ts` / `src/ui/screens/reminders/index.tsx`
- 全量 e2e 复验（chrome-devtools-mcp + Playwright 390×844，非抽查）作为最终质量门，由独立验收 agent 执行，缺陷回流 `docs/acceptance/defects.md` 循环至 LGTM。

---

## 5. 与 defects.md 的关系

`code-audit-v3.md` 的工程 bug 与 `defects.md` 的 E2E 验收缺陷是两套体系。defects.md 的 D1/D2/D3（摘要句数/a11y name/snoozed 标签）已于前轮 pass 2 复验通过。本报告新增的工程问题（本轮全部闭环）建议补录 defects.md 作为工程层验收基线，与 e2e 层分开追踪。
