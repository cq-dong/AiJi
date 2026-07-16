# Phase 9 · Batch 2b — AI 提醒（Notification 定时）分解

> 触发条件：Batch 2a 验收 LGTM + push 后启动。撞 `store.ts`/shared core，大；
> 子任务可 sub-fan-out（worktree 隔离 + lead 串行合并 store-touching 项）。
> 离线可恢复队列本批不做（D8 手动重试已够 MVP）。

## 子任务（文件域互斥 → 可并行；store/di/dexie 串行合并）

- **B1 Domain types**：`src/domain/types.ts` 加 `Reminder`（id / entryId / dueAt(ISO) /
  label / status: 'pending'|'fired'|'snoozed'|'missed' / createdAt）。`EntryAi` 加可选
  `reminderSuggestion?: { dueAt: string; label: string }`（LLM 检测到的待确认提醒）。
- **B2 Dexie schema**：`src/data/db.ts` bump v3，加 `reminders` 表（keyPath id，index
  `dueAt`+`status`+`byEntry`）。v3 migration 安全（仅加表 + 加 index，不动既有 keyPath）。
  `src/data/seed.ts`：1-2 条样例 reminder。
- **B3 StoragePort**：`src/ports/index.ts` + `src/adapters/dexieStorage.ts` 加
  `listReminders` / `getReminder` / `saveReminder` / `deleteReminder`。
- **B4 LLM 检测提醒**：`src/adapters/deepSeekLlm.ts` `classify()` prompt 扩展——从正文
  识别时间型提醒意图（「明天下午3点提醒我X」「周五记得Y」）→ 出 `reminderSuggestion`
  （dueAt 解析成绝对 ISO，label 摘要）。few-shot 一例。LLM 不做调度，只建议。
- **B5 store + 调度**：`src/app/store.ts` — 加 `reminders: Reminder[]` state + `hydrate`
  载入 reminders（`di.storage.listReminders`）+ `scheduleReminders()`（app open/hydrate 时扫
  pending：dueAt 在未来 → setTimeout 到点 fire Notification；overdue pending → <1h 补 fire、
  >1h 标 missed，见 Q3）。**processEntry 不自动建 Reminder**（Q2：用户在 B6 TodoConfirm 确认）——
  `reminderSuggestion` 留在 EntryAi 上。加 `confirmReminder(entryId, dueAt, label)` action（B6 调用：
  建 pending Reminder + 调度 + 首次请求 Notification.permission，Q4）+ `dismissReminder(id)` /
  `snoozeReminder(id, minutes)` 供 B7。
- **B6 detail TodoConfirm**：`src/ui/screens/detail/` — LLM 建议 reminder 时显示「确认提醒」
  卡（预填 dueAt+label，用户可改时间/标签）→ 确认存 Reminder + 调度；忽略则丢弃 suggestion。
- **B7 settings 提醒与待办 sheet**：`src/ui/screens/settings/` — 现 ChevronRow 占位 →
  打开 sheet 列 pending reminders（时间/标签/状态），支持 dismiss / snooze 10min。
- **B8 Notification 适配**：`src/adapters/notifications.ts`（新）— 封装
  `Notification.requestPermission` + `new Notification(label, {body, tag:id})`；
  无权限/不支持 → 降级 in-app toast。纯前台（见 Q1）。

## 仅用户能定（dispatch 前问，Q1 影响范围）

- **Q1 后台通知**：app 关闭时是否要推？**前台 only**（Notification 仅 app 开着时 fire，无 push
  server，MVP 够）vs **Push API**（需 push server + VAPID + service-worker push，重，改范围）。
  推荐：前台 only 先做，Push 后置。
- **Q2 时间解析**：LLM 把「明天下午3点」解析成绝对 ISO（用户在 TodoConfirm 可改）vs
  让用户在 TodoConfirm 手选时间（LLM 只标「含提醒意图」）。推荐：LLM 解析 + 用户确认/改。
- **Q3 missed 策略**：app open 发现有 overdue pending reminder——即 fire（补推）vs 标 missed
  不打扰。推荐：overdue <1h 补 fire，>1h 标 missed。
- **Q4 权限时机**：首次确认 reminder 时请求 Notification.permission vs 打开 settings
  提醒 sheet 时请求。推荐：首次确认 reminder 时请求（情境相关）。

## 决策结果（2026-07-16 用户拍板）

- Q1 后台通知 = **前台 only**（Notification 仅 app 开着时 fire，无 push server；Push API 后置）
- Q2 时间解析 = **LLM 解析 + 用户确认**（LLM 出绝对 ISO dueAt + label，TodoConfirm 预填可改）
- Q3 missed 策略 = **补推/标错过**（overdue <1h 补 fire；>1h 标 missed 不打扰）
- Q4 权限时机 = **首次确认提醒时**请求 Notification.permission（情境相关）

## 依赖/防撞

- B1-B3 串行合并（types→db→port 链）；B4-B8 可在 B1-B3 落地后并行 fan-out（文件域：
  deepSeekLlm / store+notifications / detail / settings 互斥）。
- 不与任何 2a 残留并行（2a 必 LGTM + push 后再启）。
- 不碰 dark mode（D2 后置）。

## lead 集成

- 2a push 后 → 问用户 Q1-Q4 → 回填本文 → fan-out B1-B3 串行 → B4-B8 并行 → 验收
  （浏览器：确认 reminder → Notification fire；reload 不丢；missed 策略）→ push。
