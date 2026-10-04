# P-F 陪伴深化包（feat/companion-echo）

> 来源：2026-10-04 五路审计 audit-ai 方案 1a+2+3，用户拍板优先wave。
> 前置：W0 静默失效修复包已收口（greeting 最新会话修复是 P-F ① 的依赖）。
> 铁律：子代理只写分配文件、不 commit/push、TDD 先红后绿、`npx tsc -p tsconfig.app.json` + `npx vitest run` 双绿才报完成。

## 范围

### ① 往日回响（onThisDay → greeting context，无新 UI）
往年今日的回忆织进既有主动问候，不加新卡片。

- `ports/index.ts:112` `ProactiveGreetingContext` 加 `onThisDay?: { yearsAgo: number; excerpt: string }`
- `src/app/proactive.ts` `buildContext`（:67）：遍历 input.entries 找**同月日（本地时区）、年份 < now 年**的条目；按 createdAt 降序取第一条 excerpt 非空者。`excerpt` 三级回退 = aiById titleSuggestion → 文本首行 → transcript 首行，截 60 字。**接口已钉死（lead 契约补丁）**：`BuildContextInput.entries` 元素 = `Pick<Entry,'createdAt'> & Partial<Pick<Entry,'id'|'parts'>>`（纯可选，旧测试不破），加 `aiById?: ReadonlyMap<string, Pick<EntryAi,'titleSuggestion'>>`；`ProactiveDeps.listEntries` 同步放宽 + 加可选 `getAiById`。选择/摘录规则 100% 在 buildContext 内（纯函数可测）；home 调用方（pf-store）只加 `getAiById: () => { const m = useUiStore.getState().aiByEntry; return new Map(Object.entries(m)) }`（读 live state，防 hydrate 时序闭包旧值）。顺带修 :63 过时注释「会话 '1'」（W0 已改最新会话）。
- `openAiCompatLlm.ts` `buildProactiveGreetingPrompt`（:973）：user 块加一行（zh「{yearsAgo} 年前的今天 Ta 记了：{excerpt}」/ en 对称），system 规则 2 可承接线索清单加「往年今日的回忆」；无 onThisDay 不加行。
- `builtinLlm.ts` greeting 路径同步透传（P-D A路 双适配器真实现于 74d8f2d，builtin 同样客户端拼 context——核对其实现后镜像改）。
- 测试：buildContext onThisDay（跨年命中/同年排除/多年取最近/无匹配 undefined/无标题回退首行）；prompt 含/不含 onThisDay 行。

### ② 周回顾（home mount 惰性触发 + CompanionCard 壳变体）
- `Settings` 加 `weeklyReviewEnabled?: boolean`（缺省 true；BYOK 未配置时调用自然失败→静默，不打扰）。
- 新 `src/app/weeklyReview.ts` `maybeRunWeeklyReview(now = new Date())`：
  - `lastWeekRange = scopeRange('week', shiftRef('week', now, -1))`（dateRange.ts:34/:55 现成）。
  - localStorage rate key `aiji.wr.{lastWeekRange}` 存在 → skip（每周最多跑一次）。
  - 条件：`settings.weeklyReviewEnabled !== false` 且上周范围内 ≥1 条目（无条目不烧 quota）。
  - 调 `useUiStore.getState().recomputeAggregate('week', lastWeekRange)`（自带 skip-when-fresh 守卫，fresh 秒回）；**成功才写 rate key**，失败 console.warn 下周首页重试。
- `home/index.tsx` mount effect 调用（greeting effect 旁，fire-and-forget）。
- `CompanionCard.tsx` 周回顾变体：上周 aggregate 存在且未读（rate key `aiji.wr.seen.{range}`）时卡内容切「上周回顾」：标题 + summary 首句 + 点击跳 `/summary` 并写 seen key。复用现有卡壳，不加新组件文件。
- 设置页「AI 伙伴」区加开关行（镜像现有 autoMemory 行）。
- i18n `home.weeklyReview*` / `settings.weeklyReview*` zh+en。
- 测试：maybeRunWeeklyReview（rate key skip/开关关/无条目 skip/成功写 key/失败不写）；CompanionCard 变体渲染 + seen 行为。

### ③ chat action 扩展（op:createReminder + op:deleteEntry）
**契约（lead commit，所有子代理遵守）：**
- `ChatMessage.action`（types.ts:308）平铺扩展（非判别联合，旧数据零迁移）：
  ```ts
  op?: 'changeCategory' | 'createReminder' | 'deleteEntry' // 缺省=changeCategory（旧消息兼容）
  reminderLabel?: string   // createReminder：提醒文本
  reminderDueAt?: string   // createReminder：ISO（intent 轮 LLM 直接解析自然语言时间）
  ```
- `ChatQuery.action`（types.ts:258）加 `op?` / `reminderLabel?` / `dueAt?`（dueAt 为 intent 轮产出 ISO）。
- `Reminder.entryId`（types.ts）→ `entryId?: string`（chat 建的提醒无源头条目）。**消费点 null-guard 清单（已排查，pf-store 照修）**：
  - `reminders/index.tsx:67/87/134/174` — `open(r.entryId)` 跳详情：entryId 缺失时禁用点击（或样式降级），不 navigate。
  - `store.ts:194` — `showFiringReminder` payload entryId 同步可选；通知点击路由处 null-guard。
  - `store.ts:218` — `trashedIds.has(r.entryId)`：`Set<string>.has` 不吃 `string|undefined`，先判 `r.entryId &&`。
  - `store.ts:683/1061/1073` — `=== id`/`!== id` 语义天然安全（undefined 不匹配），仅类型适配。
- intent prompt（openAiCompatLlm.ts:402-483）zh+en 各加 createReminder/deleteEntry 1 示例；`parseIntentJson`（:563-586）白名单加三字段严格校验（非法丢弃）。
- store `sendMessage` kind==='action' 分支按 `query.action.op` 分派：
  - `changeCategory`（缺省）：现有模板路径不动。
  - `createReminder`：无条目解析——直接 pending 卡（label + dueAt 本地化展示）。
  - `deleteEntry`：entryHint → localRecall 候选（复用 changeCategory 条目解析块）→ 0=notFound / 1=pending / 多=ambiguous（≤5）。
- 新 `resolveChatAction(msgId, choice: {entryId} | 'confirm' | 'cancel')`：按消息 op 分派——
  - changeCategory：委托现有 resolveCategoryAction 逻辑（原 action 保留作兼容壳或迁移调用点）。
  - createReminder：confirm → `await di.storage.saveReminder(...)`（ownerId 盖章、status pending）+ 接现有调度入口（scheduleReminders/ reminderScheduler，实现时核对）→ done 回执「已建提醒：{label}，{本地化 dueAt}」。
  - deleteEntry：confirm(entryId) → `await get().trashEntry(entryId)` 软删 → `chatAnswerCache.clear()` → done 回执「已把《XX》移到回收站」；条目已删 → notFound（杀进程恢复防御）。
  - 全部**串行 await**（D11 先例）+ 失败复位 status。
- UI `ActionConfirmBubble`（chat/index.tsx:381）按 op 三套文案：改分类（现状）/ 建提醒（图标+label+时间）/ 删条目（警示色 catFail + 「移到回收站，可恢复」副文案）；ambiguous 候选列表三 op 复用。
- i18n `chat.action.*` 扩展双语。
- 测试：parseIntentJson 新 op 白名单/非法丢弃；store 三 op 分支相位+模板；resolveChatAction 全状态机（confirm/cancel/notFound/串行/失败复位/cache clear/saveReminder 参数断言/trashEntry 调用断言）；UI 三 op 渲染 + 回调。

## 任务拆分（契约先行 → 3 路并行）

**Lead 契约 commit**：types.ts + ports/index.ts + i18n key stub 清单 + proactive.ts 过时注释。

| Agent | 独占文件 |
|---|---|
| pf-adapters | src/app/proactive.ts、src/adapters/openAiCompatLlm.ts、src/adapters/builtinLlm.ts、src/app/__tests__/proactive*、src/adapters/__tests__/ |
| pf-store | src/app/store.ts、src/app/weeklyReview.ts（新）、src/ui/screens/home/index.tsx、src/ui/screens/reminders/（entryId null-guard）、src/app/__tests__/（store 侧） |
| pf-ui | src/ui/screens/chat/index.tsx、src/ui/screens/home/CompanionCard.tsx、src/ui/screens/home/companionCard.test.tsx、src/ui/screens/settings/index.tsx、src/app/i18n/** |

防撞：home/index.tsx 只 pf-store 碰（CompanionCard.tsx 是独立文件归 pf-ui）；i18n 只 pf-ui；types/ports 只 lead。

## 验收

1. 三路报齐 → lead 集成：tsc + vitest 全绿 + diff 逐行过。
2. 验收 agent 静态 review + 浏览器联合测试（390×844，BYOK 真 key）：
   ①往年今日问候（造一条去年今日的条目 → 首页问候承接或 NULL 不崩）
   ②周回顾卡出现 + 点击跳 /summary + 二次进首页不重跑（rate key）
   ③「明天下午三点提醒我交稿」→ 建提醒确认卡全流程 → 提醒屏出现该条
   ④「把桂花拿铁那条删了」→ 删条目确认卡 → 回收站可见
   ⑤回归：「把 XX 改成美食分类」旧改分类卡不破
3. 全绿 → lead commit（契约+三路，3-4 个语义 commit）→ 关单。
