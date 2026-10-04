# W0 静默失效修复包（feat/companion-echo）

> 来源：2026-10-04 五路只读审计（audit-debt/perf/ai/prd/ux）。全部 S 级、有测试网兜底。
> 铁律：子代理只写分配文件、不 commit/push、TDD 先红后绿、`npx tsc -p tsconfig.app.json` + `npx vitest run` 双绿才报完成。

## 范围与切分

| Agent | 修复项 | 独占文件 |
|---|---|---|
| fix-w0-ui | ① AndroidManifest 补 VIBRATE 权限（haptics 9 调用点静默全灭）② TimelineCard memo（条目变更全列表重渲）③ 4×img loading=lazy ④ 卸载死依赖 @use-gesture/react + dexie-react-hooks | android/app/src/main/AndroidManifest.xml、home/TimelineCard.tsx、detail/PartView.tsx、capture/widgets.tsx、feedback/index.tsx、settings/AccountSection.tsx、package.json+lock |
| fix-w0-adapters | ① greeting 读死会话 '1' → 改取 updatedAt 最新会话的 rollingSummary（照 store.ts:516-517 hydrate 逻辑）② builtinLlm.aggregate 补 mediaBlock 安全网（对齐 openAiCompatLlm.ts:1319-1338；顺带对照 classify 段 drift） | home/index.tsx（+其测试）、builtinLlm.ts、adapters/__tests__/ |
| fix-w0-store | ① saveMemory 模块级 promise 链串行化（candidates T0 快照竞态，store.ts:1628-1663）② embeddings.ts 加 deleteStaleEmbeddings + withSemanticArm 惰性 GC | data/embeddings.ts、app/store.ts、app/__tests__/、data/__tests__/ |
| fix-w0-perf | ① ReactMarkdown+remarkGfm lazy（settings chunk -30kB gzip）② zipMediaCount 惰性化（删 s.entries 订阅）③ chinese-s2t 动态导入（预加载，onresult 同步回调不可 await）④ seed 动态导入（importSampleData + DEV ensureSeeded 两处） | settings/index.tsx、webCapture.ts、dexieStorage.ts |

## 关键设计（子代理遵守）

- **会话 '1' 修复**：`di.storage.listConversations()` 取 updatedAt 最大者 → rollingSummary；无会话 → undefined。home/index.tsx:69 附近。
- **saveMemory 串行化**：模块级 `let memoryQueue = Promise.resolve()`；action 体挂链并返回链上 promise；链内 catch 吞错防毒化后续任务。现有测试串行 await，行为不变。
- **orphan GC**：不碰 deleteEntry/trashEntry 多调用点；withSemanticArm filter 时收集不在 entryIds 的行 id，fire-and-forget bulkDelete。
- **chinese-s2t**：启动录音前预加载模块并缓存模块级引用，onresult 同步回调里用缓存引用；行为逐字节不变。
- **ReactMarkdown lazy**：React.lazy + Suspense，fallback 用纯文本 pre；UI 数值/行为不变。

## 验收

1. 四路回报完成后 lead 集成：`npx tsc -p tsconfig.app.json` + `npx vitest run` 全绿 + diff 逐行过。
2. 派验收 agent：静态 review（file:line）+ 浏览器联合测试（390×844）：首页问候卡（最新会话 rollingSummary 进入 context）、设置页导出确认数值正确、关于页 releaseNotes 渲染、录音转写 t2s 正常、记忆保存两条并行不互踩。
3. 全绿 → lead commit（可分 2-3 个语义 commit）→ 关单。

## 集成记录（2026-10-04 lead）

- 四路全交付，tsc 0 error + 558/558 测试绿；diff 逐行过（ui/adapters/store/perf）。
- 构建对比：index 813.02→781.92kB（gzip 266.6→248.7，-17.9kB）；settings 227.51→74.22kB（gzip 60.2→14.8，-45.4kB）；拆出 ReleaseNotes(45.8 gzip, lazy)/seed(3.0 gzip)/chinese-s2t(11.6 gzip, lazy) 三 chunk。
- **遗留（转后续 perf wave）**：seed chunk 仍 boot 加载——`store.ts:9` 与 `devSeed.ts:3` 静态 import `seedSettings`（fix-w0-perf 范围外）。完全 lazy 需把 settings 默认形状从 seed.ts 抽成独立小模块（~3kB gzip 收益，非紧急）。
- 实测 chinese-s2t 字典 11.56kB gzip（审计估 ~6kB），已纯动态，录音启动才拉。
