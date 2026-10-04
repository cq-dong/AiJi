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

---

## 验收记录（2026-10-05，feat/companion-echo）

**执行方式说明（诚实记录）**：验收 agent（accept-pf）派活后失联（>50min 无回报、无文档落盘、无 LLM 网络活动，SendMessage 不应，TaskStop 尸位）→ 按「lead 不亲验，除非必要」的**除非必要**条款收回 lead inline 执行。静态 review 独立性未受损——三路 diff 在集成阶段已逐行过（16 文件 +853/−112 + 6 新文件，零契约漂移），非子代理自报。

**静态门**：`npx tsc -p tsconfig.app.json` 0 错；`npx vitest run` **624/624 绿**（含 lead 补的 F2 空会话过滤语义钉死用例；F2 过滤致 2 个 W0 mock 过期已由 lead 修 fixture 复原）。

**浏览器联合测试**：prod build（`VITE_AIJI_BACKEND=mock`，BYOK 直连 DeepSeek 真 key，注入方式 = dist 临时文件 fetch，key 未进上下文）+ preview :4173 + Playwright MCP，视口 390×844，游客账号 + 12 条 seed。

| 用例 | 结果 | 关键证据 |
|---|---|---|
| ① 往日回响 | ✅ | 注入去年今日条目（pf-otd-1）→ 清 `aiji.pd.*` → reload → greeting LLM 请求体含「**1 年前的今天 Ta 记了：去年今日标题PF01**」（excerpt 走 ① 级 titleSuggestion，yearsAgo=1 正确）；阴性对照（无候选时请求体无此行）来自同会话早前请求 #91；system 规则 2 含「往年今日的回忆」；LLM 返 NULL → 模板兜底卡正常渲染（NULL 解析路径） |
| ② 周回顾 | ✅ | 注入上周条目（pf-wr-1）→ reload → rate key `aiji.wr.2026-W40` 写入（ISO 周键正确）；问候 6h 频控中 → 周回顾卡补位渲染（LLM 真摘要，非模板）；CTA → /summary ✓ + seen key `aiji.wr.seen.2026-W40` 写入；IDB aggregates 落 week/2026-W40 行 stale=false；二次进首页卡消失 ✓、rate key 在 → 不重算 |
| ③ createReminder | ✅ | 「明天下午三点提醒我交稿」→ 卡「建提醒 · 交稿 · 10/6 15:00」（LLM 锚定当前时间解析正确）→ 确认 → IDB reminders 恰 1 条新提醒（label=交稿、dueAt=2026-10-06T15:00:00+08:00、status=pending、**entryId 缺省**符合契约）、无双写；回执「已建提醒：交稿，10/6 15:00」；/reminders 屏「交稿 10/6 15:00 · 待提醒」✓ |
| ④ deleteEntry | ✅ | 注入唯一令牌条目（pf-del-1）→「把PF04删除验收那条删了」→ 卡「删除条目 · 《PF04删除验收条目》+ 移到回收站，30 天内可恢复」→ 确认 → 条目 deletedAt 盖章（软删非物理删）✓；首页不再出现 ✓；/trash 屏可见（含「30 天后自动清理 · 原 10-05」+ 恢复/删除按钮）✓ |
| ⑤ 回归 changeCategory | ✅ | 「把桂花拿铁那条改成美食分类」→ 旧式卡「《桂花拿铁》改成「美食」（新类别）」→ 确认 → EntryAi(e5).category='美食' 持久化 ✓；done 卡紧凑式「《桂花拿铁》→「美食」」+ 回执句双形态互补（非重复） |

**发现项**：
- **MINOR-1（UI 重复文案）**：createReminder/deleteEntry 的 done 卡内嵌回执与 store 追加的独立回执消息渲染**同一句话**（chat.action.reminder.done / chat.action.delete.done 同 key 同源），屏上出现两遍；changeCategory 无此问题（紧凑式 + 句子互补）。仅观感，状态机正确。建议后续 wave 把新 op 的 done 卡改紧凑式对齐旧 op。
- **OBS-1（环境，非产品缺陷）**：headless Chromium 下 `Notification.requestPermission()` promise 永不 resolve → createReminder 确认挂在权限 await。真实浏览器有原生授权弹窗不受影响；旧 reminders 屏「开启通知」同源行为。e2e 跑法已定：预先 `context.grantPermissions(['notifications'])`。顺带实证：挂起期间 reload → 半截卡按 pending 复原（杀进程恢复防御）+ 重试成功无双写。
- **OBS-2（工具怪癖）**：playwright-mcp 网络日志未捕获周回顾 aggregate 那次 LLM POST（前后请求均在）；以持久化证据（aggregate 行 + rate key + 条目专属 LLM 文案）旁证调用发生。

**结论：5/5 用例通过，0 BLOCKER / 0 MAJOR，1 MINOR + 2 观察项。P-F 验收 LGTM，进入 commit/push。**
