import { create } from 'zustand'
import type { Aggregate, AggregateScopeType, Category, ChatAnswer, ChatCite, ChatMessage, ChatTrace, Conversation, Draft, Entry, EntryAi, EntryEmbedding, EntryPart, GeoPoint, Memory, MemoryVerdict, Reminder, Settings, Tag } from '@/domain/types'
import { scopeRange } from '@/domain/dateRange'
import { localRecall, dateKey, currentTimeLine, resolveActionCategory, toCite } from '@/ui/screens/chat/helpers'
import { semanticArm, mergeCites, queryVectorCache, DEFAULT_EMBEDDING_MODEL } from '@/app/semanticRecall'
import { topSimilarMemories, isStaleMemory, applyMemoryVerdict } from '@/app/memoryLifecycle'
import { buildEmbeddingText, textHash, listEmbeddings, saveEmbedding, deleteStaleEmbeddings } from '@/data/embeddings'
import { getCurrentOwner } from '@/app/currentOwner'
import { seedSettings } from '@/data/seed'
import { enrichLocation, reverseGeocodeCity } from '@/adapters/geocoding'
import { getWeatherLive } from '@/adapters/weather'
import { webSearch } from '@/adapters/webSearch'
import { playReminderBeep } from '@/adapters/reminderSound'
import { extractPartialAnswer } from '@/adapters/sseStream'
import * as summaryCache from '@/adapters/summaryCache'
import { di } from './di'
import { useAccountStore, registerStoreRehydrate } from './accountStore'
import { setCurrentLang, detectLang } from '@/app/currentLang'
import { t } from '@/app/i18n'

// 视图状态 / 采集草稿（PRD §7.3 应用层）。entries 走 DexieStorage：D9 后首屏空状态（不再
// seed 兜底），hydrate() 异步从 Dexie 载入真实条目替换；finishSave 同时落库 + 入队分类。
interface CaptureDraft {
  parts: EntryPart[]
  recording: boolean
  saving: boolean
  micDenied: boolean
  finalized: string // accumulated finalized STT segments (live preview)
  interim: string // current partial segment (live preview)
  location?: GeoPoint // recordLocation 开时，采集开始时取一次（best-effort，未解析则 undefined）
  title?: string // Wave 3: user-editable compose title (UI-only, not on Entry domain)
  // Wave 4: if this capture resumed a persisted draft, the draft's id — so finishSave /
  // clearDraft can delete that draft row (multi-draft: each draft is its own row).
  resumedDraftId?: string
}

interface UiState {
  capture: CaptureDraft
  online: boolean
  entries: Entry[] // D9: 首屏空状态（不再 seed 兜底），hydrate 后为 Dexie 真实数据
  aiByEntry: Record<string, EntryAi> // D9: 首屏空，hydrate 从 Dexie 载入；processEntry 成功后补
  categories: Category[] // D9: 首屏空，hydrate 从 Dexie 载入（含涌现类别）
  tags: Tag[] // D9: 首屏空，hydrate 从 Dexie 载入（含涌现标签）
  hydrated: boolean // 是否已从 Dexie 载入
  settings: Settings // 首屏 seedSettings 默认形状（非样例数据），hydrate 后为 Dexie 真实数据
  aggregates: Aggregate[] // D9: 首屏空，hydrate 从 Dexie 载入；recomputeAggregate 后更新
  reminders: Reminder[] // D9: 首屏空，hydrate 从 Dexie 载入；scheduleReminders 扫 pending 到点 fire
  drafts: Draft[] // Wave 4: multi-row capture drafts；hydrate 从 Dexie 载入；草稿视图消费
  trashed: Entry[] // Wave 4: 软删条目（deletedAt set）；hydrate 从 Dexie 载入 + purge >30d；回收站视图消费
  memories: Memory[] // AI 记忆（2026-07-22）：hydrate 从 Dexie 载入；settings MemorySheet 消费
  recalculating: Record<string, boolean> // key=`${scope}:${range}`；recomputeAggregate in-flight 标记，UI 据此显 spinner（与 stale 分离，失败不永转）
  justSaved: boolean // 刚保存 → 首页 toast + 置顶处理中卡片
  // 保存后 LLM 检出 reminderSuggestion → 全局 ReminderPopup 即时确认。仅 finishSave(isFresh=true) 的
  // processEntry 置；detail reprocess 走 isFresh=false 不弹。confirmReminder/忽略 → dismissPendingReminder。
  pendingReminder: { entryId: string; dueAt: string; label: string } | null
  // D20: 到点触发的前台弹窗。原生 LocalNotifications listener / web webNotify handler
  // → setReminderFireHandler → showFiringReminder → FiringReminderPopup overlay。
  // 与 pendingReminder（保存后确认创建）区分；本字段是「已到点」强提示。
  firingReminder: { reminderId: string; entryId?: string; label: string; dueAt?: string } | null
  hydrate: () => Promise<void>
  // D9: 导入示例数据后重读 Dexie。重置 hydrated 跑 hydrate 全量载入（onboarding/settings 导入后调）。
  rehydrate: () => Promise<void>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  beginSave: () => void
  finishSave: () => Promise<void>
  denyMic: () => void
  allowMic: () => void
  addPart: (p: EntryPart) => void
  clearDraft: () => void
  // Wave 4: multi-draft. saveDraft persists current capture (new row or resumed). loadDraft(id?)
  // resumes a specific draft (drafts view click), or the latest on hydrate (auto-restore safety).
  // deleteDraft discards one. finishSave / clearDraft drop the resumed draft row.
  saveDraft: () => void
  loadDraft: (id?: string) => Promise<void>
  deleteDraft: (id: string) => Promise<void>
  // Wave 4: 30-day trash. trashEntry soft-deletes (entry → trashed state, deletedAt set);
  // recoverEntry restores (clears deletedAt). deleteEntry (below, Wave 1) is the hard
  // permanent delete — trash "删除 forever" + hydrate purge (>30d) use it.
  trashEntry: (id: string) => Promise<void>
  recoverEntry: (id: string) => Promise<void>
  clearJustSaved: () => void
  dismissPendingReminder: () => void
  // D20: 到点触发弹窗
  showFiringReminder: (p: { reminderId: string; entryId?: string; label: string; dueAt?: string }) => void
  dismissFiringReminder: () => void
  setOnline: (v: boolean) => void
  setSettings: (patch: Partial<Settings>) => void
  setLlmConfig: (url: string, model: string, key: string) => void
  setVlmConfig: (url: string, model: string, key: string) => void
  setSttConfig: (model: string, key: string) => void
  setGeocodingConfig: (key: string) => void
  // 能力大补（2026-09-29）：Tavily 网络搜索 BYOK Key（secrets 'search:key'）。
  setSearchConfig: (key: string) => void
  setKeySource: (source: 'byok' | 'builtin') => void
  processEntry: (entryId: string, isFresh?: boolean) => Promise<void>
  recomputeAggregate: (scope: AggregateScopeType, range?: string, detailLevel?: number) => Promise<void>
  // Phase 9 Batch 2b · 提醒。processEntry 不自动建 Reminder（Q2：用户在 B6 TodoConfirm 确认）。
  confirmReminder: (entryId: string, dueAt: string, label: string) => Promise<void>
  dismissReminder: (id: string) => Promise<void>
  snoozeReminder: (id: string, minutes: number) => Promise<void>
  // D4: 编辑已设提醒的时间/内容。cancel 旧通知 + 更新 Reminder + 重新 schedule。
  editReminder: (id: string, dueAt: string, label: string) => Promise<void>
  // Wave 1 core actions（屏层纯消费，不碰 store.ts）
  saveCategory: (cat: Category) => Promise<void>
  deleteCategory: (slug: string) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  updateEntry: (id: string, patch: Partial<Entry>) => Promise<void>
  updateEntryAi: (entryId: string, patch: Partial<EntryAi>) => Promise<void>
  // 流式 flush 专用（2026-09-28）：纯内存 map-replace 更新当前会话的某条消息（其余消息引用
  // 不变，配合气泡 memo）。不落库——saveConversation 由 sendMessage 占位创建/流式结束两次收口。
  updateChatMessage: (msgId: string, patch: Partial<ChatMessage>) => void
  // 能力大补（2026-09-29）：改条目分类确认卡的用户抉择。confirm={entryId} 执行改分类
  // （串行 await：新类别 saveCategory → updateEntryAi → 日聚合 stale → chatAnswerCache.clear →
  // 消息 done + 回执）；'cancel' 置 cancelled + 回执。条目已删 → notFound（杀进程恢复防御）。
  resolveCategoryAction: (msgId: string, choice: { entryId: string } | 'cancel') => Promise<void>
  primeLocation: () => void
  // AI Chat · 纯读检索 (docs/design/ai-chat-impl-plan.md)。多会话（2026-07-22）。
  // conversation null = 尚无当前会话（newConversation 后或首次 sendMessage lazy-create）。
  // chatList = 历史会话缓存（refreshChatList 过滤空会话后倒序）。chatLoading 驱动
  // 两轮 loading 文案（intent 理解问题 / recall 检索库中 / answer 组织回答）。
  conversation: Conversation | null
  chatList: Conversation[]
  chatLoading: 'idle' | 'intent' | 'recall' | 'answer' | 'weather' | 'search'
  sendMessage: (text: string) => Promise<void>
  // 多会话动作（docs/superpowers/specs/2026-07-22-chat-history-design.md §3）：
  // newConversation 置 conversation=null（旧会话每次 append 已落库存档，无需显式存）；
  // loadConversation 载入历史会话续聊；deleteChatConversation 删单个（删当前→回到 null）；
  // refreshChatList 重读列表（hydrate/sendMessage 落库后/delete 后调）。
  newConversation: () => void
  loadConversation: (id: string) => Promise<void>
  deleteChatConversation: (id: string) => Promise<void>
  refreshChatList: () => Promise<void>
  // 语音输入（chat 屏复用 CapturePort.startAudio 的 live STT；transcript 流入输入框，不落库不存媒体）。
  // 与 capture 切片分离：chat 语音是临时的，不进 Entry/草稿；blob 丢弃（stopAudio 仍返，适配器要 stop 释放 mic）。
  chatVoice: { recording: boolean; interim: string; finalized: string; micDenied: boolean }
  startChatVoice: () => Promise<void>
  stopChatVoice: () => Promise<string> // 返回 transcript（finalized+interim.trim），调用方写入输入框
  allowChatMic: () => void
  // AI 记忆（2026-07-22）：增/删/开关。落库后 set 内存态，settings MemorySheet 消费。
  // 风格照抄 reminder 相关 action：save upsert + 内存态替换、delete 落库 + 过滤、toggle 翻转 enabled。
  saveMemory: (content: string) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  toggleMemory: (id: string) => Promise<void>
  // P-C（2026-10-03）：恢复归档记忆（清 archivedAt + 刷 lastConfirmedAt，保持 enabled）。
  restoreMemory: (id: string) => Promise<void>
  // P-C：90 天过期扫描——enabled && 未归档 && 距今(lastConfirmedAt ?? createdAt)>90d → 盖 archivedAt。
  // 时机：hydrate 完成后一次 + saveMemory 成功后（spec §4）。nowIso 可注入（测试边界）。
  // 返回本次归档条数。
  archiveStaleMemories: (nowIso?: string) => Promise<number>
}

const emptyDraft: CaptureDraft = { parts: [], recording: false, saving: false, micDenied: false, finalized: '', interim: '', location: undefined, title: undefined }

// range key (dateKey) for a scope+ref comes from @/domain/dateRange (A3: same ISO-week
// algorithm the summary navigator uses, so filed entries match the period card).
// day → '2026-07-15' · week → '2026-W29' · month → '2026-07'.

// Filter entries that fall within the given scope+range. Each entry's own
// createdAt determines which day/week/month it belongs to; we match the range string.
function entriesInRange(entries: Entry[], scope: AggregateScopeType, range: string): Entry[] {
  return entries.filter((e) => scopeRange(scope, new Date(e.createdAt)) === range)
}

// ── 提醒调度（Phase 9 Batch 2b · B5 · D4 重构）──────────────────────────
// D4：旧方案纯 setTimeout 前台 only——app 进后台/被杀后到点不触发（无铃声无弹窗）。
// 新方案：di.localNotifications.schedule(r) 预约系统级本地通知（原生：铃声+弹窗+
// 锁屏，后台/被杀仍触发；web：浏览器 Notification 前台 best-effort）。store 仍保留
// setTimeout 做前台状态更新（标 fired/missed）——两路并行，通知展示归 port，状态归 store。
// module-level timeout 句柄表，key=reminder.id，供 dismiss/snooze cancel。
const scheduledTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
// Q4：仅在首次 confirmReminder 时请求权限一次（permission !== 'default' 后不再弹）。
let permissionRequested = false

function clearScheduledTimeout(id: string): void {
  const h = scheduledTimeouts.get(id)
  if (h !== undefined) {
    clearTimeout(h)
    scheduledTimeouts.delete(id)
  }
  // D4: 同步取消系统级本地通知预约（原生 cancel pending notification；web 清 adapter timeout）
  void di.localNotifications.cancel(id)
}

// 到点 fire：置 fired + 落库 + 更新 state + 清 timeout 表。
// D39: 始终显式 notify 一次系统通知。原非 overdue 路径省略 notify（依赖 schedule 预约），
// 但 Android 前台 schedule 触发的系统横幅常被抑制 → 用户只看到 in-app 弹窗，通知栏无横幅。
// notify 用 hashId(r.id) 与 schedule 同 id → NotificationManager 替换，不产生重复通知。
function fireReminder(r: Reminder, _opts?: { fromOverdue?: boolean }): void {
  clearScheduledTimeout(r.id)
  di.localNotifications.notify('AiJi 提醒', r.label, r.id)
  // 前台 setTimeout 到点：直接 in-app 弹窗 + beep 兜底（不依赖 listener）。后台时
  // setTimeout 不跑，靠原生 schedule 发系统通知 + listener；notify 亦补一发系统横幅。
  useUiStore.getState().showFiringReminder({ reminderId: r.id, entryId: r.entryId, label: r.label, dueAt: r.dueAt })
  playReminderBeep()
  const fired: Reminder = { ...r, status: 'fired' }
  void di.storage.saveReminder(fired).catch((e) => console.error('[store] saveReminder(fired) failed', e))
  useUiStore.setState((s) => ({ reminders: s.reminders.map((x) => (x.id === r.id ? fired : x)) }))
}

// Q3：>1h overdue pending → 标 missed 不打扰。
function markMissed(r: Reminder): void {
  clearScheduledTimeout(r.id)
  const missed: Reminder = { ...r, status: 'missed' }
  void di.storage.saveReminder(missed).catch((e) => console.error('[store] saveReminder(missed) failed', e))
  useUiStore.setState((s) => ({ reminders: s.reminders.map((x) => (x.id === r.id ? missed : x)) }))
}

// 扫 reminders state：pending 的 → 未来预约系统通知 + setTimeout 状态更新；overdue <1h 补 fire；>1h 标 missed。
// 去重守卫：已在 timeout 表的 id 跳过（confirm/snooze 先 clearScheduledTimeout 再调本函数）。
function scheduleReminders(): void {
  const { reminders, trashed } = useUiStore.getState()
  const trashedIds = new Set(trashed.map((e) => e.id))
  const now = Date.now()
  for (const r of reminders) {
    if (r.status !== 'pending' && r.status !== 'snoozed') continue
    if (scheduledTimeouts.has(r.id)) continue
    if (trashedIds.has(r.entryId)) continue // Wave 4: 条目在回收站 → 不调度其提醒（recover 后 scheduleReminders 重 arm）
    const due = new Date(r.dueAt).getTime()
    const diff = due - now
    if (diff <= 0) {
      // overdue（含到点 0ms）
      if (-diff < 3_600_000) fireReminder(r, { fromOverdue: true }) // <1h 补推（Q3）
      else markMissed(r) // ≥1h 标错过
    } else {
      // D4: 预约系统级本地通知（原生铃声+弹窗 / web 浏览器 Notification）——后台/被杀仍触发
      void di.localNotifications.schedule(r).catch((e) => console.error('[store] localNotifications.schedule failed', e))
      // 前台状态更新：setTimeout 到点标 fired；fire 前 re-check（可能已被 dismiss/snooze）
      const h = setTimeout(() => {
        const cur = useUiStore.getState().reminders.find((x) => x.id === r.id)
        if (cur && (cur.status === 'pending' || cur.status === 'snoozed')) fireReminder(cur)
        else scheduledTimeouts.delete(r.id)
      }, diff)
      scheduledTimeouts.set(r.id, h)
    }
  }
}

// ── AI Chat · 纯读检索 (docs/design/ai-chat-impl-plan.md §4) ──────────────
// 多会话（2026-07-22）：无固定 id，新会话用 crypto.randomUUID()；chatList 缓存历史。
// answer 轮塞入的先前对话条数（滑动窗，token 预算——不全量塞历史）。
const CHAT_HISTORY_WINDOW = 6

// 同会话同问题缓存（hash(question + entries 签名)）：entries 数量/最新 updatedAt 不变即复用上次
// answer，免两轮付费 LLM。内存态不持久——重载空，可接受。entries 变（新记/删/改）即失效。
const chatAnswerCache = new Map<string, ChatAnswer>()

function chatCacheKey(question: string, entries: Entry[]): string {
  const norm = question.trim().toLowerCase()
  const sig = entries.length + ':' + (entries[0]?.updatedAt ?? '')
  return `${norm}::${sig}`
}

// conversation null → 新空会话（首次 sendMessage lazy-create，id=uuid）。
function ensureConversation(c: Conversation | null): Conversation {
  return c ?? { id: crypto.randomUUID(), messages: [], updatedAt: new Date().toISOString() }
}

function appendMessage(c: Conversation, m: ChatMessage): Conversation {
  return { ...c, messages: [...c.messages, m], updatedAt: m.createdAt }
}

// Finding 5 兜底（2026-09-29 rc9）：历史注入 prompt 带 [YYYY-MM-DD] 前缀，模型可能模仿该格式
// 把回答正文以 [日期] 开头（prompt 规则引导之外的第二道防线）。只 strip 开头一处——
// 正文中间的合法日期引用（如「[2026-09-29] 那天…」非开头）不动。
function stripLeadingDatePrefix(text: string): string {
  return text.replace(/^\s*\[\d{4}-\d{2}-\d{2}\]\s*/, '')
}

// M2（2026-09-28 流式验收）：chatLoading 所有权序号。每次 sendMessage 递增并记录本轮 seq；
// 离开/切换会话（newConversation/loadConversation 异 id/deleteChatConversation 当前条）同样递增——
// 旧轮随即放弃 chatLoading 所有权：相位推入点（recall/answer）仅在 seq 最新时生效，
// finalize/早退路径 guard 失败时仅在自己仍是最新 seq 才复位 idle（防永久卡 'answer' 软锁输入框）。
let chatSendSeq = 0

// W0（2026-10-04）：saveMemory 串行化队列。旧实现 candidates 取 T0 快照后经 embed/裁决两次
// await 让出事件循环——两次并行 saveMemory（sendMessage 记忆提取 fire-and-forget 与
// MemorySheet 手动添加可并行）各持 T0 快照裁决，merge/replace 后写覆盖先写，记忆静默丢失。
// 模块级 promise 链：每次调用把整个函数体挂到链尾串行执行；链尾 catch 吞错（console.error）
// 防一次失败毒化后续所有排队任务。
let memoryQueue: Promise<unknown> = Promise.resolve()

// M4：流式占位（streaming:true）是内存态语义——进程被杀后 Dexie 可能残留 streaming:true 的
// 尸体会话（空气泡+打字光标+压住 LoadingBubble）。读出时一律抹 false：内存态不信持久层。
function stripStreamingFlags(conv: Conversation): Conversation {
  if (!conv.messages.some((m) => m.streaming)) return conv
  return { ...conv, messages: conv.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }
}

// 从 conversation 取最近 N 条 {role, content, date} 作 answer LLM 对话历史（不含当前问题——
// buildAnswerPrompt 把当前问题作为最后一轮 user 追加，故此处只给先前轮次）。跳过 error 消息。
// date（2026-09-29 能力大补）：每条历史的本地日键（YYYY-MM-DD），prompt 渲染 [日期] 前缀，
// LLM 可解析「昨天说的」等跨天指代。
function chatHistory(conv: Conversation | null, limit: number): { role: 'user' | 'assistant'; content: string; date?: string }[] {
  if (!conv) return []
  return conv.messages
    .filter((m) => !m.error)
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content, date: dateKey(m.createdAt) }))
}

// ── P-B 语义召回（2026-10-03 spec §1）────────────────────────────────────
// 语义臂：embed 可用时按问句向量补召回——关键词 cites 在前保序，语义命中且未中关键词的
// 条目按 sim 降序追加（总长 ≤12，ChatTrace.recalled 照旧记录合并后列表，prompt 零改动）。
// embed 缺席/抛错/返 null → 原样返回关键词 cites（行为与纯关键词召回逐字节一致）。
async function withSemanticArm(
  question: string,
  cites: ChatCite[],
  entries: Entry[],
  aiByEntry: Record<string, EntryAi>,
): Promise<ChatCite[]> {
  const embed = di.llm.embed
  if (!embed) return cites
  try {
    // model 与适配器同源（accept-pb 修 1）：读 di.storage.getSettings()（适配器 embed
    // 同读 Dexie settings），不用 uiStore 内存态——两侧失步会「戳≠实际模型」致重复重嵌。
    // 读失败回退缺省模型，不阻断召回。
    const settings = await di.storage.getSettings().catch(() => null)
    const model = settings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
    // 问句向量：进程内 LRU(50) 同问免调（键含模型名，换模型不串）；每问至多 1 次 embed 调用。
    let qv = queryVectorCache.get(model, question)
    if (!qv) {
      const vecs = await embed.call(di.llm, [question]).catch(() => null)
      qv = vecs?.[0] ?? undefined
      if (qv && qv.length > 0) queryVectorCache.set(model, question, qv)
    }
    if (!qv) return cites
    // 只召回当前条目集内的向量（回收站/已删条目的残留向量自然出局）。
    const entryIds = new Set(entries.map((e) => e.id))
    const allRows = await listEmbeddings()
    const rows = allRows.filter((r) => entryIds.has(r.entryId))
    // W0 惰性 GC（2026-10-04）：embeddings 表无 delete 挂点，条目已删/已清的向量行永久残留
    // ——召回过滤时顺带发现（allRows 比 rows 多即有残留），fire-and-forget 清掉。
    // 不阻塞召回主路径；失败静默（console.warn），下轮召回再试。
    if (allRows.length !== rows.length) {
      void deleteStaleEmbeddings(entryIds).catch((e) => console.warn('[store] stale embedding GC failed', e))
    }
    // 惰性回填：发现无向量/文本已变的 ready 条目 → 后台补嵌（每轮 ≤20），本轮不等。
    void backfillEmbeddings(rows, entries, aiByEntry, model)
    const sem = semanticArm(qv, rows)
    if (sem.length === 0) return cites
    const mergedIds = mergeCites(cites.map((c) => c.id), sem)
    const citeById = new Map(cites.map((c) => [c.id, c]))
    const entryById = new Map(entries.map((e) => [e.id, e]))
    const merged: ChatCite[] = []
    for (const id of mergedIds) {
      const hit = citeById.get(id)
      if (hit) {
        merged.push(hit)
        continue
      }
      // 语义臂新命中：复用 localRecall 同一压缩逻辑造 ChatCite（形状与关键词臂一致）。
      const e = entryById.get(id)
      if (e) merged.push(toCite(e, aiByEntry[e.id]))
    }
    return merged
  } catch (e) {
    console.warn('[store] semantic arm failed, fallback to keyword recall', e)
    return cites
  }
}

// 惰性回填（spec §1）：语义臂激活时，无向量或文本已变（textHash/model 不等）的 ready
// 条目 → fire-and-forget 批量补嵌，每轮最多 20 条（防首轮爆配额）。失败静默。
// model 由调用方（withSemanticArm）传入——与本轮 embed 实际用模同源，免二次 IDB 读。
async function backfillEmbeddings(
  existing: EntryEmbedding[],
  entries: Entry[],
  aiByEntry: Record<string, EntryAi>,
  model: string,
): Promise<void> {
  const embed = di.llm.embed
  if (!embed) return
  try {
    const byEntryId = new Map(existing.map((r) => [r.entryId, r]))
    const targets: { entry: Entry; text: string; hash: string }[] = []
    for (const entry of entries) {
      if (entry.status !== 'ready') continue // STT/分类失败的条目不嵌
      const text = buildEmbeddingText(entry, aiByEntry[entry.id])
      if (!text.trim()) continue
      const hash = textHash(text)
      const row = byEntryId.get(entry.id)
      if (row && row.textHash === hash && row.model === model) continue // 双键新鲜 → 跳过
      targets.push({ entry, text, hash })
      if (targets.length >= 20) break
    }
    if (targets.length === 0) return
    const vecs = await embed.call(di.llm, targets.map((x) => x.text)).catch(() => null)
    if (!vecs) return
    const now = new Date().toISOString()
    for (let i = 0; i < targets.length; i++) {
      const v = vecs[i]
      if (!v || v.length === 0) continue
      await saveEmbedding({
        entryId: targets[i].entry.id,
        ownerId: getCurrentOwner(),
        vector: v,
        model,
        textHash: targets[i].hash,
        updatedAt: now,
      })
    }
  } catch (e) {
    console.warn('[store] embedding backfill failed', e)
  }
}

// 增量嵌（spec §1）：processEntry classify 成功后 fire-and-forget 嵌该条目。
// embed 缺席/失败静默——绝不影响条目处理主流程。
async function embedEntryNow(entry: Entry, ai: EntryAi): Promise<void> {
  const embed = di.llm.embed
  if (!embed) return
  try {
    const text = buildEmbeddingText(entry, ai)
    if (!text.trim()) return
    // model 与适配器同源（accept-pb 修 1）：读 Dexie settings，不用 uiStore 内存态。
    const settings = await di.storage.getSettings().catch(() => null)
    const model = settings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
    const vecs = await embed.call(di.llm, [text]).catch(() => null)
    const v = vecs?.[0]
    if (!v || v.length === 0) return
    await saveEmbedding({
      entryId: entry.id,
      ownerId: getCurrentOwner(),
      vector: v,
      model,
      textHash: textHash(text),
      updatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[store] embedEntry failed', e)
  }
}

// ── P-B 滚动对话摘要（2026-10-03 spec §2）────────────────────────────────
// 答案落库后 fire-and-forget：积攒 >10 条未压缩 → 把 [summarizedCount, len-6) 区间压进
// rollingSummary（最近 6 条永保原文，与 chatHistory 窗口同边界，摘要与原文不重叠）。
// 本轮问答不等摘要——摘要为下一轮准备。失败仅 console.warn，不影响问答。
async function maybeRollSummary(conv: Conversation): Promise<void> {
  if (typeof di.llm.summarizeConversation !== 'function') return
  try {
    const total = conv.messages.length
    // 防御：summarizedCount 越界（杀进程恢复/历史脏数据）按 0 重算。
    let start = conv.summarizedCount ?? 0
    if (start < 0 || start > total) start = 0
    if (total - start <= 10) return
    const end = total - 6
    const chunk = conv.messages
      .slice(start, end)
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content, date: dateKey(m.createdAt) }))
    if (chunk.length === 0) return
    const summary = await di.llm.summarizeConversation(conv.rollingSummary ?? null, chunk)
    if (!summary) return
    // 竞态：await 期间用户可能已发新消息。以最新会话为底合并摘要字段——messages 只增
    // 不改，end 作为前缀位置仍合法（≤ 最新长度），不会盖住后到的消息。
    const cur = useUiStore.getState().conversation
    const base = cur?.id === conv.id ? cur : await di.storage.getConversation(conv.id)
    if (!base) return
    const next: Conversation = { ...base, rollingSummary: summary, summarizedCount: Math.min(end, base.messages.length) }
    if (cur?.id === conv.id) useUiStore.setState({ conversation: next })
    await di.storage.saveConversation(next)
  } catch (e) {
    console.warn('[store] rolling summary failed', e)
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  capture: emptyDraft,
  online: true,
  // D9: 首屏空状态——不再 seed 兜底。hydrate() 从 Dexie 载入真实数据（dev 自动 seed / 用户导入）。
  entries: [],
  aiByEntry: {},
  categories: [],
  tags: [],
  hydrated: false,
  settings: seedSettings,
  aggregates: [],
  reminders: [],
  drafts: [],
  trashed: [],
  memories: [],
  recalculating: {},
  justSaved: false,
  pendingReminder: null,
  firingReminder: null,
  conversation: null,
  chatList: [],
  chatLoading: 'idle',
  chatVoice: { recording: false, interim: '', finalized: '', micDenied: false },
  hydrate: async () => {
    if (get().hydrated) return
    try {
      // Wave 4: 先 purge >30d 软删条目（硬删 + cascade AI/提醒），再读列表（listTrashed 不返过期）。
      try { await di.storage.purgeExpired() } catch (e) { console.error('[store] purgeExpired failed', e) }
      const [entries, settings, categories, tags, aggregates, reminders, drafts, trashed, memories] = await Promise.all([
        di.storage.listEntries(),
        di.storage.getSettings(),
        di.storage.listCategories(),
        di.storage.listTags(),
        di.storage.listAggregates(),
        di.storage.listReminders(),
        di.storage.listDrafts(),
        di.storage.listTrashed(),
        di.storage.listMemories(),
      ])
      // 载入每条条目的 AI（seed 条目 + 真实保存条目）。getEntryAi 返回最高 version。
      const aiPairs = await Promise.all(
        entries.map((e) => di.storage.getEntryAi(e.id).then((ai) => (ai ? [e.id, ai] as const : null))),
      )
      const aiByEntry = { ...Object.fromEntries(aiPairs.filter(Boolean) as [string, EntryAi][]) }
      set({ entries, settings, categories, tags, aggregates, reminders, drafts, trashed, memories, aiByEntry, hydrated: true })
      // i18n：语言固化——用户选过 → 尊重；没选过 → detect 系统语言并持久化（一次性，
      // 之后系统语言变化不跟随，用户在设置里手动改）。
      const lang = settings.language ?? detectLang()
      setCurrentLang(lang)
      if (!settings.language) {
        const next = { ...settings, language: lang }
        set({ settings: next })
        void di.storage.saveSettings(next).catch(() => {})
      }
      // 载入后扫 pending 提醒：未来调度到点；overdue <1h 补 fire、≥1h 标 missed（Q3）。
      scheduleReminders()
      // Wave 4: 恢复最近草稿（跨刷新/重启续记）。多草稿里取最新一条载入 capture（仅当 capture 空）。
      await get().loadDraft()
      // AI Chat: 载入历史列表（refreshChatList 过滤空会话），conversation 续聊最近一条
      // （chatList[0] = updatedAt 最大）。替代旧 id=1 直读——多会话下无固定 id。
      // M4: 续聊会话同样抹 streaming 尸体标记（内存态语义不信持久层）。
      try {
        await get().refreshChatList()
        const top = get().chatList[0]
        set({ conversation: top ? stripStreamingFlags(top) : null })
      } catch (e) { console.error('[store] hydrate chatList failed', e) }
      // P-C 记忆生命周期（spec §4 时机）：hydrate 完成后扫一次 90 天过期归档（fire-and-forget，
      // 失败不阻断 UI；saveMemory 成功后另有一次）。
      void get().archiveStaleMemories().catch((e) => console.error('[store] archiveStaleMemories failed', e))
    } catch (e) {
      // D9: 载入失败保持空状态（不再 seed 兜底），标记已尝试避免反复重试（存储失败不阻断 UI）
      console.error('[store] hydrate failed', e)
      set({ hydrated: true })
    }
  },
  rehydrate: async () => {
    // D9: importSampleData 后重读 Dexie。重置 hydrated 让 hydrate 跳过守卫全量重载。
    set({ hydrated: false })
    await get().hydrate()
  },
  startRecording: async () => {
    set((s) => ({ capture: { ...s.capture, finalized: '', interim: '' } }))
    get().primeLocation()
    try {
      await di.capture.startAudio({
        onInterim: (t) => set((s) => ({ capture: { ...s.capture, interim: t } })),
        onFinal: (t) => set((s) => ({ capture: { ...s.capture, finalized: s.capture.finalized + t, interim: '' } })),
      })
      set((s) => ({ capture: { ...s.capture, recording: true } }))
    } catch (e) {
      console.error('[store] startAudio failed', e)
      set((s) => ({ capture: { ...s.capture, recording: false, micDenied: true } }))
    }
  },
  stopRecording: async () => {
    const s = get()
    if (!s.capture.recording) return
    let result: { ref: string; durationSec: number; blob?: Blob; mime?: string }
    try {
      result = await di.capture.stopAudio()
    } catch (e) {
      console.error('[store] stopAudio failed', e)
      result = { ref: `audio-${crypto.randomUUID()}`, durationSec: 0.1 }
    }
    const cur = get().capture
    const transcript = (cur.finalized + cur.interim).trim()
    // D4 尾巴3: 显式标 mediaType='audio'——PartView 已有 fallback 推断但显式更准（LLM prompt 分块 / 导出 extension 均依赖）
    const part: EntryPart = { type: 'audio', ref: result.ref, durationSec: Math.max(1, Math.round(result.durationSec)), transcript, mime: result.mime, mediaType: 'audio' }
    if (result.blob) void di.storage.saveMedia(result.ref, result.blob).catch((e) => console.error('[store] saveMedia failed', e))
    set((s2) => ({
      capture: { ...s2.capture, recording: false, finalized: '', interim: '', parts: [...s2.capture.parts, part] },
    }))
  },
  beginSave: () => set((s) => ({ capture: { ...s.capture, recording: false, saving: true } })),
  finishSave: async () => {
    const s = get()
    const parts = s.capture.parts
    if (parts.length === 0) { set({ capture: emptyDraft, justSaved: false }); return }
    const now = new Date().toISOString()
    const entry: Entry = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'processing',
      parts,
      location: s.capture.location,
    }
    set({ capture: emptyDraft, entries: [entry, ...s.entries], justSaved: true })
    // Wave 4: 保存成功 → 若本条目续自某草稿，删该草稿行（多草稿，每条独立），避免草稿视图残留已转正条目。
    const draftId = s.capture.resumedDraftId
    if (draftId) {
      void di.storage.deleteDraft(draftId)
        .then(() => set((st) => ({ drafts: st.drafts.filter((d) => d.id !== draftId) })))
        .catch((e) => console.error('[store] deleteDraft(resumed) failed', e))
    }
    // D7: 先 await saveEntry 再 processEntry —— 否则慢 IndexedDB 上 saveEntry 未提交时 processEntry 的
    // getEntry 返 undefined → ready 更新静默跳过、无 catch 触发 → 条目卡 processing 永转圈。落库失败 →
    // 标 failed（UI 显重试，不是永转 processing）。
    try {
      await di.storage.saveEntry(entry)
    } catch (e) {
      console.error('[store] saveEntry failed', e)
      const failed: Entry = { ...entry, status: 'failed' }
      set((st) => ({ entries: st.entries.map((x) => (x.id === entry.id ? failed : x)) }))
      return
    }
    // 分类入队（火忘）：AI 失败只伤 AI 层（条目标 failed，UI 可重试），采集存储已落库不受影响
    // isFresh=true → processEntry 完成若检出 reminderSuggestion 置 pendingReminder，AppShell 弹窗即时确认。
    void get().processEntry(entry.id, true)
  },
  denyMic: () => set((s) => ({ capture: { ...s.capture, micDenied: true, recording: false } })),
  allowMic: () => set((s) => ({ capture: { ...s.capture, micDenied: false } })),
  addPart: (p) => set((s) => ({ capture: { ...s.capture, parts: [...s.capture.parts, p] } })),
  clearDraft: () => {
    // 内存草稿清空 + 若续自某草稿则删该 Dexie 行（避免清空后下次又恢复）。
    const draftId = get().capture.resumedDraftId
    set({ capture: emptyDraft })
    if (draftId) {
      void di.storage.deleteDraft(draftId)
        .then(() => set((st) => ({ drafts: st.drafts.filter((d) => d.id !== draftId) })))
        .catch((e) => console.error('[store] clearDraft deleteDraft failed', e))
    }
  },
  saveDraft: () => {
    // Wave 4: 持久化当前 parts/title/location 为一条草稿。续自已有草稿则更新该行；否则新建（id=draft-<uuid>）。
    // 设 resumedDraftId 以便后续 save/clear/finishSave 命中同一条。recording/saving/micDenied 不存（运行期态）。
    const c = get().capture
    if (c.parts.length === 0) return
    const now = new Date().toISOString()
    const id = c.resumedDraftId ?? `draft-${crypto.randomUUID()}`
    const existing = get().drafts.find((d) => d.id === id)
    const draft: Draft = {
      id,
      parts: c.parts,
      title: c.title,
      location: c.location,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    set((s) => ({ capture: { ...s.capture, resumedDraftId: id } }))
    void di.storage.saveDraft(draft)
      .then(() => {
        set((s) => {
          const rest = s.drafts.filter((d) => d.id !== id)
          return { drafts: [draft, ...rest].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) }
        })
      })
      .catch((e) => console.error('[store] saveDraft failed', e))
  },
  loadDraft: async (id) => {
    // id 给定：从草稿视图点某条 → 载入该条（覆盖当前 capture，用户显式选择续这条）。
    // id 缺省：hydrate 自动恢复最新一条（多草稿取 listDrafts[0]），仅当 capture 空（不覆盖本会话已记）。
    const c = get().capture
    let d: Draft | undefined
    if (id) {
      d = await di.storage.getDraft(id)
    } else {
      if (c.parts.length > 0) return
      d = (await di.storage.listDrafts())[0]
    }
    if (d && d.parts.length > 0) {
      set({ capture: { ...emptyDraft, parts: d.parts, title: d.title, location: d.location, resumedDraftId: d.id } })
    }
  },
  deleteDraft: async (id) => {
    // 丢弃一条草稿。若该草稿正被 capture 续着（resumedDraftId===id），同步清 capture。
    await di.storage.deleteDraft(id)
    set((s) => {
      const cap = s.capture.resumedDraftId === id ? emptyDraft : s.capture
      return { drafts: s.drafts.filter((d) => d.id !== id), capture: cap }
    })
  },
  trashEntry: async (id) => {
    // 软删：从 entries 移到 trashed（deletedAt=now）。关联 pending/snoozed 提醒先 cancel timeout（条目进回收站不 fire）。
    await di.storage.trashEntry(id)
    const linked = get().reminders.filter((r) => r.entryId === id)
    linked.forEach((r) => { if (r.status === 'pending' || r.status === 'snoozed') clearScheduledTimeout(r.id) })
    set((s) => {
      const moved = s.entries.find((e) => e.id === id)
      if (!moved) return s
      const trashed = [{ ...moved, deletedAt: new Date().toISOString() }, ...s.trashed]
      return {
        entries: s.entries.filter((e) => e.id !== id),
        trashed: trashed.sort((a, b) => new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime()),
      }
    })
  },
  recoverEntry: async (id) => {
    // 从回收站恢复：清 deletedAt，移回 entries（按 createdAt 时序位）。重 arm 关联提醒（scheduleReminders）。
    await di.storage.recoverEntry(id)
    set((s) => {
      const found = s.trashed.find((e) => e.id === id)
      if (!found) return s
      const rest = { ...found }
      delete rest.deletedAt
      const entries = [...s.entries, rest].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return { trashed: s.trashed.filter((e) => e.id !== id), entries }
    })
    scheduleReminders()
  },
  clearJustSaved: () => set({ justSaved: false }),
  dismissPendingReminder: () => set({ pendingReminder: null }),
  // D20: 到点弹窗 show/dismiss。showFiringReminder 由 reminderFire.ts 的 fire handler
  // 调用（payload 来自原生 listener 或 web webNotify）。dismiss 由弹窗组件按钮/遮罩点击。
  showFiringReminder: (p) => set({ firingReminder: p }),
  dismissFiringReminder: () => set({ firingReminder: null }),
  setOnline: (v) => set({ online: v }),
  setSettings: (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    // i18n：切语言 → 同步 currentLang 单例（t()/提示词构建读它），useT 订阅 settings.language 触发重渲。
    if (patch.language) setCurrentLang(patch.language)
  },
  setLlmConfig: (url, model, key) => {
    const cur = get().settings
    // D8: key 清空 → apiKeyRef 置 undefined + 删 localStorage 行。否则旧 key 残留、UI 仍显「已配置」、XSS 可读旧值。
    const next = { ...cur, llmUrl: url, llmModel: model, apiKeyRef: key ? 'llm:key' : undefined }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    if (key) void di.secrets.set('llm:key', key).catch((e) => console.error('[store] setLlmKey failed', e))
    else void di.secrets.delete('llm:key').catch((e) => console.error('[store] deleteLlmKey failed', e))
  },
  setVlmConfig: (url, model, key) => {
    const cur = get().settings
    // 同 setLlmConfig（D8）：独立 VLM 多模态端点。key 清空 → vlmKeyRef undefined + 删 'vlm:key'。
    // 未配 vlmUrl/vlmModel/vlmKeyRef → classify 含图回落主 LLM（§5.2 再降级纯文本）。
    const next = { ...cur, vlmUrl: url, vlmModel: model, vlmKeyRef: key ? 'vlm:key' : undefined }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    if (key) void di.secrets.set('vlm:key', key).catch((e) => console.error('[store] setVlmKey failed', e))
    else void di.secrets.delete('vlm:key').catch((e) => console.error('[store] deleteVlmKey failed', e))
  },
  setSttConfig: (model, key) => {
    const cur = get().settings
    // D8: 同 setLlmConfig——清空时删 secret + 清 ref。
    const next = { ...cur, sttModel: model, sttKeyRef: key ? 'stt:key' : undefined }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    if (key) void di.secrets.set('stt:key', key).catch((e) => console.error('[store] setSttKey failed', e))
    else void di.secrets.delete('stt:key').catch((e) => console.error('[store] deleteSttKey failed', e))
  },
  setGeocodingConfig: (key) => {
    // D24: 高德反向地理编码 BYOK Key。清空 → 删 secret + 清 ref（回落 Nominatim）。
    const cur = get().settings
    const next = { ...cur, geocodingKeyRef: key ? 'geocoding:key' : undefined }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    if (key) void di.secrets.set('geocoding:key', key).catch((e) => console.error('[store] setGeocodingKey failed', e))
    else void di.secrets.delete('geocoding:key').catch((e) => console.error('[store] deleteGeocodingKey failed', e))
  },
  setSearchConfig: (key) => {
    // 能力大补（2026-09-29）：Tavily 网络搜索 BYOK Key。镜像 setGeocodingConfig——
    // 清空 → 删 secret + 清 ref（问 AI 搜索意图友好降级）。
    const cur = get().settings
    const next = { ...cur, searchKeyRef: key ? 'search:key' : undefined }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    if (key) void di.secrets.set('search:key', key).catch((e) => console.error('[store] setSearchKey failed', e))
    else void di.secrets.delete('search:key').catch((e) => console.error('[store] deleteSearchKey failed', e))
  },
  setKeySource: (source) => {
    const account = useAccountStore.getState().account
    if (source === 'builtin' && (!account || account.type === 'guest')) return
    const next = { ...get().settings, keySource: source }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
  },
  processEntry: async (entryId, isFresh) => {
    // §4：STT 失败原因收集——per-part try/catch 默认吞错，classify 因「无文本」失败时，
    // 外层 catch 据此顶用 STT 原始错误（额度/转码/超时）而非误导性的「无文本」。
    // 在 try 之前声明：catch 块需读取；每次 processEntry 调用需 fresh 一份。
    let sttFailedError: string | undefined
    try {
      // D13: 后置回填地点地址。capture 屏的 enrichLocation effect 只更新 Zustand
      // capture.location，保存后 navigate('/') → capture 卸载 → effect cleanup
      // cancelled=true，Nominatim 返回被丢弃，entry 以纯 lat/lng 落库。此处对已落库
      // entry 的无 address location 做回填（await 串行，避免与 STT/classify 的 saveEntry
      // 并发覆盖）。不阻塞 finishSave（processEntry 是 fire-and-forget）；失败只 warn
      // 不影响后续 STT/classify（enrichLocation 内部已 catch 返原 loc，此处双保险）。
      const fresh0 = await di.storage.getEntry(entryId)
      if (fresh0?.location && !fresh0.location.address) {
        try {
          const geoKey = (await di.secrets.get('geocoding:key')) ?? undefined
          const enriched = await enrichLocation(fresh0.location, { key: geoKey })
          if (enriched.address) {
            const updated0: Entry = { ...fresh0, location: enriched, updatedAt: new Date().toISOString() }
            await di.storage.saveEntry(updated0)
            set((s) => ({ entries: s.entries.map((e) => (e.id === entryId ? updated0 : e)) }))
          }
        } catch (e) {
          console.warn('[store] enrichLocation backfill failed', e)
        }
      }
      // STT 终稿（保存后）：paraformer 重写音频/视频 transcript，比 WebSpeech live 预览准。
      // 无 stt:key → 跳过整步（用 WebSpeech 预览文本分类即可）；单 part 失败 → 回退预览文本，不阻断分类。
      // D25: 重试（isFresh=false）时不得覆盖已有 transcript——用户可能已手动编辑过转写文本，
      // 重跑 STT 会把手工修订抹掉（"手动编辑之后没有保存"的根因）。仅对新条目（isFresh）做
      // 预览→终稿升级，重试时只补 transcribe 缺失的 part（transcript 为空才跑）。
      const settings = await di.storage.getSettings()
      const session = useAccountStore.getState().session
      const shouldStt = (settings.keySource ?? 'byok') === 'byok'
        ? !!(await di.secrets.get('stt:key'))
        : !!session
      if (shouldStt) {
        const fresh = await di.storage.getEntry(entryId)
        if (fresh) {
          let changed = false
          const parts = await Promise.all(
            fresh.parts.map(async (p) => {
              if (p.type !== 'audio' && p.type !== 'video') return p
              if (!isFresh && p.transcript) return p
              try {
                const text = await di.stt.transcribe(p.ref)
                if (!text) { sttFailedError = sttFailedError ?? 'STT 转写为空'; return p }
                changed = true
                return { ...p, transcript: text }
              } catch (e) {
                console.error('[store] stt failed for ' + p.ref, e)
                sttFailedError = sttFailedError ?? (e instanceof Error ? e.message : String(e))
                return p
              }
            }),
          )
          if (changed) {
            const updated: Entry = { ...fresh, parts, updatedAt: new Date().toISOString() }
            await di.storage.saveEntry(updated)
          }
        }
      }
      const ai = await di.llm.classify(entryId)
      await di.storage.saveEntryAi(ai)
      // 涌现：分类可能新建了类别/标签（适配器已落库），重载让 home chip / detail 标签能解析。
      const [categories, tags] = await Promise.all([di.storage.listCategories(), di.storage.listTags()])
      const entry = await di.storage.getEntry(entryId)
      if (entry) {
        const updated: Entry = { ...entry, status: 'ready', aiId: ai.id, processError: undefined, updatedAt: new Date().toISOString() }
        await di.storage.saveEntry(updated)
        set((s) => ({
          entries: s.entries.map((e) => (e.id === entryId ? updated : e)),
          aiByEntry: { ...s.aiByEntry, [entryId]: ai },
          categories,
          tags,
        }))
        // P-B 增量嵌（2026-10-03）：classify 成功后后台嵌该条目；embed 缺席/失败静默。
        void embedEntryNow(updated, ai)
      }
      // 保存后弹窗：仅新建条目（finishSave→isFresh=true）+ LLM 检出 reminderSuggestion 时置，
      // AppShell 渲全局 ReminderPopup 让用户即时确认。detail 的 reprocess 走 isFresh=false 不弹。
      if (isFresh && ai.reminderSuggestion) {
        set({ pendingReminder: { entryId, dueAt: ai.reminderSuggestion.dueAt, label: ai.reminderSuggestion.label } })
      }
      // 分类成功 → 先把当日聚合置 stale，再触发重算。processEntry 必须置 stale 才能穿过
      // recomputeAggregate 的 skip-when-fresh 守卫——新条目 genuinely 让当日摘要过期。
      // （scope-switch 路径不置 stale → 守卫正确跳过新鲜聚合，省付费 LLM 调用。）
      const dayRange = scopeRange('day', new Date())
      const existingDay = await di.storage.getAggregate('day', dayRange)
      if (existingDay && !existingDay.stale) {
        const staleAg: Aggregate = { ...existingDay, stale: true }
        await di.storage.saveAggregate(staleAg)
        set((s) => ({
          aggregates: s.aggregates.map((a) => (a.id === existingDay.id ? staleAg : a)),
        }))
      }
      void get().recomputeAggregate('day').catch((e) => console.error('[store] recomputeAggregate failed', e))
    } catch (e) {
      console.error('[store] processEntry failed', e)
      const entry = await di.storage.getEntry(entryId)
      if (entry) {
        let errMsg = e instanceof Error ? e.message : String(e)
        // §4：classify 抛「无文本」（含音频 part 但转写为空），若 STT 此前失败且无回退文本，
        // 真实原因是 STT（额度/转码/超时）而非「无文本」——用 STT 原始错误，不再误导。
        if (sttFailedError && /无文本|empty|无可用/.test(errMsg)) errMsg = sttFailedError
        const updated: Entry = { ...entry, status: 'failed', processError: errMsg, updatedAt: new Date().toISOString() }
        await di.storage.saveEntry(updated)
        set((s) => ({ entries: s.entries.map((e) => (e.id === entryId ? updated : e)) }))
      }
    }
  },
  recomputeAggregate: async (scope, range, detailLevel) => {
    const ref = new Date()
    const dateKey = range ?? scopeRange(scope, ref)
    // Wave 3: detailLevel 默认取 settings.aggregateDetailLevel；level 变更视为过期需重算。
    const lvl = detailLevel ?? get().settings.aggregateDetailLevel ?? 3
    const inRange = entriesInRange(get().entries, scope, dateKey)
    if (inRange.length === 0) return
    const entryIds = inRange.map((e) => e.id)
    // Snapshot existing aggregate to restore on failure (avoid stuck-stale).
    const existing = await di.storage.getAggregate(scope, dateKey)
    // 新鲜即跳过：scope 切换/挂载不再每次打付费 LLM；processEntry 先置 stale 再触发，真过期仍重算。
    // Wave 3: detailLevel 变了也算过期——避免级别改了却显示旧级别摘要。
    if (existing && !existing.stale && (existing.detailLevel ?? 3) === lvl) return
    // D27: Dexie 聚合是别的 detailLevel（切换 3→4→3 回到 3）或 stale 时，查本 lvl 的 localStorage
    // 缓存——缓存按 detailLevel 分桶保留之前生成过的结果，命中即跳过付费 LLM，UI 用缓存秒开。
    // D18: stale 时缓存兜底亦在此——LLM 失败后 catch restore stale=true，但缓存里有上次成功摘要；
    // shouldRefresh 对 day scope 比较 entryCount：新条目仍重算，LLM 失败后 entryCount 未变 → 缓存
    // fresh → return 跳过，避免死循环「生成中」。
    {
      const count = inRange.length
      const cached = summaryCache.get(scope, dateKey, lvl)
      if (cached !== null && !summaryCache.shouldRefresh(scope, dateKey, count, lvl)) {
        return
      }
    }
    const recalcingKey = `${scope}:${dateKey}`
    // D9: in-flight 守卫——processEntry 与 summary onRegen 并发调同 scope+range 时，第二个直接 return，
    // 不发第二次付费 LLM 调用（结果会互相踩）。summary sweep 的 RECOMPUTE_CONCURRENCY=2 只限单 source 内并发，
    // 不防跨 source；此守卫补上跨 source。in-flight 完成后会 set 聚合结果，跳过者自然看到更新。
    if (get().recalculating[recalcingKey]) return
    // recalculating 与 stale 分离：in-flight 标记驱动 UI spinner；失败时清 in-flight、留 stale → 显「重新生成」而非永转（1b 修）。
    set((s) => ({ recalculating: { ...s.recalculating, [recalcingKey]: true } }))
    const prevStale = existing?.stale ?? false
    if (existing) {
      const staleAg: Aggregate = { ...existing, stale: true }
      await di.storage.saveAggregate(staleAg)
      set((s) => ({
        aggregates: s.aggregates.map((a) => (a.id === existing.id ? staleAg : a)),
      }))
    }
    try {
      // 传 existing?.id → 适配器复用同主键 → saveAggregate put 原地替换，避免孤儿 stale 行（重载后重复卡片）。
      const ag = await di.llm.aggregate(entryIds, scope, dateKey, lvl, existing?.id)
      await di.storage.saveAggregate(ag)
      set((s) => {
        // Replace any existing aggregate for this scope+range, else prepend.
        const rest = s.aggregates.filter(
          (a) => !(a.scope.type === scope && a.scope.range === dateKey),
        )
        return { aggregates: [ag, ...rest], recalculating: { ...s.recalculating, [recalcingKey]: false } }
      })
    } catch (e) {
      // 聚合失败只伤 AI 层——条目已分类落库，存储不受影响。
      // 恢复 existing 的 stale 状态 + 清 in-flight（避免卡在「重新生成中」永转）。
      console.error('[store] recomputeAggregate failed', e)
      if (existing) {
        const restored: Aggregate = { ...existing, stale: prevStale }
        await di.storage.saveAggregate(restored)
        set((s) => ({
          aggregates: s.aggregates.map((a) => (a.id === existing.id ? restored : a)),
          recalculating: { ...s.recalculating, [recalcingKey]: false },
        }))
      } else {
        set((s) => ({ recalculating: { ...s.recalculating, [recalcingKey]: false } }))
      }
    }
  },
  // ── 提醒 actions（Phase 9 Batch 2b · B5 · D4 重构）────────────────────
  confirmReminder: async (entryId, dueAt, label) => {
    // Q4：首次确认提醒时请求通知权限（情境相关，不无脑弹）。
    // permissionRequested flag 保证只问一次；denied 后不再骚扰，notify 走 toast 降级。
    // D4: 走 di.localNotifications（原生 requestPermissions / web Notification.requestPermission）
    // D4 修复：await requestPermission 检查返回值——未授权仍落库 Reminder 但 warn（不阻塞）。
    if (!permissionRequested) {
      permissionRequested = true
      const ok = await di.localNotifications.requestPermission()
      if (!ok) {
        console.warn('[store] notification permission not granted; reminder saved but alerts may be suppressed')
      }
    }
    const r: Reminder = {
      id: crypto.randomUUID(),
      entryId,
      dueAt,
      label,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    await di.storage.saveReminder(r)
    // 确认即消费 suggestion：清掉 EntryAi 上的 reminderSuggestion，避免 reload 后卡片重现 → 重确认建重复 Reminder。
    // D11: await saveEntryAi（不再 fire-and-forget）——否则在途 processEntry 的 saveEntryAi(含原 suggestion) 会覆盖
    // cleared 版本 → suggestion 复活 → reload 后 ReminderConfirm 卡重现 → 可重确认建重复 Reminder。写失败只记日志
    // 不让 confirmReminder reject（Reminder 已落库是关键步，suggestion 清除是 cosmetic；reject 反致用户重试建重复）。
    // 深链直达 detail 时 hydrate 可能尚未载入 aiByEntry → 从 Dexie 取，确保 suggestion 仍被清掉。
    const ai = get().aiByEntry[entryId] ?? (await di.storage.getEntryAi(entryId))
    if (ai?.reminderSuggestion || !ai?.todoDismissed) {
      // 建 Reminder 即"已选择" → 同时清 suggestion 并置 todoDismissed，detail 三按钮卡
      // 不再重弹（仅靠清 suggestion 反满足 TodoConfirm 显示条件；持久旗标才是真护栏）。
      const cleared: EntryAi = { ...ai, reminderSuggestion: undefined, todoDismissed: true }
      try {
        await di.storage.saveEntryAi(cleared)
        set((s) => ({ aiByEntry: { ...s.aiByEntry, [entryId]: cleared } }))
      } catch (e) {
        console.error('[store] clear reminderSuggestion failed', e)
      }
    }
    set((s) => ({ reminders: [r, ...s.reminders] }))
    scheduleReminders()
  },
  dismissReminder: async (id) => {
    clearScheduledTimeout(id)
    await di.storage.deleteReminder(id)
    set((s) => ({ reminders: s.reminders.filter((x) => x.id !== id) }))
  },
  snoozeReminder: async (id, minutes) => {
    // Wave 3 修复：snooze 设 status='snoozed'，UI chip 显示"已稍后"反馈稍后动作。
    // scheduleReminders 把 snoozed 当 pending 一样调度/触发（到点 → fired）。
    clearScheduledTimeout(id)
    const cur = get().reminders.find((x) => x.id === id)
    if (!cur) return
    // 锚定 max(now, dueAt)：稍后提醒必须更晚，不能把未来到点的提醒往前挪。
    const base = Math.max(Date.now(), new Date(cur.dueAt).getTime())
    const snoozed: Reminder = {
      ...cur,
      dueAt: new Date(base + minutes * 60_000).toISOString(),
      status: 'snoozed',
    }
    await di.storage.saveReminder(snoozed)
    set((s) => ({ reminders: s.reminders.map((x) => (x.id === id ? snoozed : x)) }))
    scheduleReminders()
  },
  editReminder: async (id, dueAt, label) => {
    // D4: 编辑已设提醒的时间/内容。cancel 旧通知预约 → 更新 Reminder → 重新 schedule。
    // 状态保持 pending/snoozed（编辑不改状态，只改 dueAt+label）；已 fired/missed 不可编辑（UI 不暴露入口）。
    clearScheduledTimeout(id)
    const cur = get().reminders.find((x) => x.id === id)
    if (!cur) return
    const updated: Reminder = { ...cur, dueAt, label }
    await di.storage.saveReminder(updated)
    set((s) => ({ reminders: s.reminders.map((x) => (x.id === id ? updated : x)) }))
    scheduleReminders()
  },
  // ── Wave 1 core actions（屏层纯消费，不碰 store.ts）─────────────────────
  saveCategory: async (cat) => {
    // rename/recolor/新增类别：upsert by slug；listCategories 顺序保持（新类别追加末尾）。
    await di.storage.saveCategory(cat)
    set((s) => {
      const exists = s.categories.some((c) => c.slug === cat.slug)
      return { categories: exists ? s.categories.map((c) => (c.slug === cat.slug ? cat : c)) : [...s.categories, cat] }
    })
  },
  primeLocation: () => {
    // 采集开始时取一次地点：recordLocation 关 + 尚未取到时触发；best-effort，失败/拒绝→ location 留 undefined。
    if (!get().settings.recordLocation) return
    if (get().capture.location) return
    void di.capture.getLocation().then((loc) => {
      if (loc) set((s) => ({ capture: { ...s.capture, location: loc } }))
    })
  },
  deleteCategory: async (slug) => {
    // 受影响条目：分类指向该 slug 的。重映射 category=''（未分类）而非删 AI 记录——保留 summary/tags/facets。
    const affected = Object.values(get().aiByEntry).filter((ai) => ai.category === slug)
    await Promise.all(
      affected.map(async (ai) => {
        const next: EntryAi = { ...ai, category: '', version: ai.version + 1, createdAt: new Date().toISOString() }
        await di.storage.saveEntryAi(next)
        set((s) => ({ aiByEntry: { ...s.aiByEntry, [ai.entryId]: next } }))
      }),
    )
    await di.storage.deleteCategory(slug)
    set((s) => ({ categories: s.categories.filter((c) => c.slug !== slug) }))
  },
  deleteEntry: async (id) => {
    // 关联提醒：条目都没了，提醒无意义——pending 的先 cancel timeout 再删 Reminder。
    const linked = get().reminders.filter((r) => r.entryId === id)
    await Promise.all(
      linked.map(async (r) => {
        clearScheduledTimeout(r.id)
        await di.storage.deleteReminder(r.id)
      }),
    )
    await di.storage.deleteEntry(id)
    set((s) => ({
      entries: s.entries.filter((e) => e.id !== id),
      trashed: s.trashed.filter((e) => e.id !== id),
      aiByEntry: Object.fromEntries(Object.entries(s.aiByEntry).filter(([k]) => k !== id)),
      reminders: s.reminders.filter((r) => r.entryId !== id),
    }))
  },
  updateEntry: async (id, patch) => {
    // 手动编辑条目（如改文本/parts）：merge patch + bump updatedAt；id/createdAt 不变。
    const cur = await di.storage.getEntry(id)
    if (!cur) return
    const next: Entry = { ...cur, ...patch, updatedAt: new Date().toISOString() }
    await di.storage.saveEntry(next)
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? next : e)) }))
  },
  updateEntryAi: async (entryId, patch) => {
    // 手动编辑 AI 面板（如改类别/标题/摘要/标签）：bump version + 新 createdAt，同 id 原地 put。
    const cur = get().aiByEntry[entryId] ?? (await di.storage.getEntryAi(entryId))
    if (!cur) return
    const next: EntryAi = { ...cur, ...patch, version: cur.version + 1, createdAt: new Date().toISOString() }
    await di.storage.saveEntryAi(next)
    set((s) => ({ aiByEntry: { ...s.aiByEntry, [entryId]: next } }))
  },
  updateChatMessage: (msgId, patch) => {
    // 照 updateEntry 的 map-replace 模式，只替换目标消息对象（配合气泡 memo 的引用比较）。
    // 纯内存：流式期间 ~80ms 一帧调用，落库由 sendMessage 占位/结束两次收口。
    const cur = get().conversation
    if (!cur || !cur.messages.some((m) => m.id === msgId)) return
    set({
      conversation: { ...cur, messages: cur.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) },
    })
  },
  // ── 能力大补（2026-09-29）：改条目分类确认卡的用户抉择 ─────────────────────
  // confirm 串行 await（D11）：新类别先 saveCategory（slug 冲突已有同名则跳过）→
  // updateEntryAi → 日聚合 stale（拷贝 processEntry 块，range 取条目 createdAt 当日）→
  // chatAnswerCache.clear（同问缓存含旧分类答案）→ 消息 done + 回执。
  // cancel → cancelled + 回执。条目已删 → notFound 终态（杀进程恢复/他端删除防御）。
  resolveCategoryAction: async (msgId, choice) => {
    const conv = get().conversation
    if (!conv) return
    const msg = conv.messages.find((m) => m.id === msgId)
    if (!msg || msg.kind !== 'actionConfirm' || !msg.action) return
    const a = msg.action
    if (a.status !== 'pending' && a.status !== 'ambiguous') return // 终态 → no-op

    // 闭包 conv 内原位更新该消息（竞态防护照 :1045 模式：set 前查当前会话 id，
    // 已切会话则只落库不 set 当前视图）。
    const replaceMsg = (c: Conversation, next: ChatMessage): Conversation => ({
      ...c,
      messages: c.messages.map((m) => (m.id === msgId ? next : m)),
      updatedAt: new Date().toISOString(),
    })
    // Finding 1 修复（2026-09-29 rc9）：在途多个 await 期间 sendMessage 可能已向同会话
    // 追加新消息——persist 前重取 get().conversation，是同一会话则在**新鲜** messages 上做
    // 消息级 merge（原位更新目标卡 + append 回执），不用 :912 旧快照整体覆写；
    // 会话已切 → 沿用旧守卫语义，只落库（旧快照派生）不 set 当前视图。
    const persist = async (target: ChatMessage, receipt?: ChatMessage): Promise<void> => {
      const fresh = get().conversation
      const same = fresh !== null && fresh.id === conv.id
      const base = same && fresh ? fresh : conv
      const replaced = replaceMsg(base, target)
      const next = receipt ? appendMessage(replaced, receipt) : replaced
      if (same) set({ conversation: next })
      try {
        await di.storage.saveConversation(next)
        await get().refreshChatList()
      } catch (e) {
        console.error('[store] saveConversation(resolveCategoryAction) failed', e)
      }
    }

    if (choice === 'cancel') {
      const cancelled: ChatMessage = { ...msg, action: { ...a, status: 'cancelled' } }
      const receipt: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: t('chat.action.cancelled'),
        createdAt: new Date().toISOString(),
      }
      await persist(cancelled, receipt)
      return
    }

    const cand = a.candidates.find((c) => c.entryId === choice.entryId)
    if (!cand) return // 非候选 id（UI 只会传候选 entryId）→ no-op
    // 条目已删（杀进程恢复后条目数据变了/他端删除）→ notFound 终态，不执行改动。
    const entry = get().entries.find((e) => e.id === choice.entryId) ?? (await di.storage.getEntry(choice.entryId))
    if (!entry) {
      await persist({ ...msg, action: { ...a, status: 'notFound' } })
      return
    }

    // 串行 await（D11）——任一步失败抛给调用方（UI 可提示），已完成的步骤保持落库态。
    if (a.isNewCategory && !get().categories.some((c) => c.slug === a.toCategorySlug)) {
      await get().saveCategory({ slug: a.toCategorySlug, label: a.toCategoryLabel, aliases: [], usageCount: 0, createdAt: new Date().toISOString() })
    }
    await get().updateEntryAi(choice.entryId, { category: a.toCategorySlug })
    // 日聚合 stale（同 processEntry 块）：分类变了，条目当日摘要过期 → 置 stale 后触发重算。
    const dayRange = scopeRange('day', new Date(entry.createdAt))
    const existingDay = await di.storage.getAggregate('day', dayRange)
    if (existingDay && !existingDay.stale) {
      const staleAg: Aggregate = { ...existingDay, stale: true }
      await di.storage.saveAggregate(staleAg)
      set((s) => ({
        aggregates: s.aggregates.map((ag) => (ag.id === existingDay.id ? staleAg : ag)),
      }))
    }
    void get().recomputeAggregate('day', dayRange).catch((e) => console.error('[store] recomputeAggregate failed', e))
    // 同问缓存里的答案可能引用旧分类 → 全清（比 bump Entry.updatedAt 干净）。
    chatAnswerCache.clear()
    // 现有类别显示名以 categories 为准（用户可能后续改过名）；新类别用 action 里的 label。
    const toLabel = get().categories.find((c) => c.slug === a.toCategorySlug)?.label ?? a.toCategoryLabel
    const done: ChatMessage = { ...msg, action: { ...a, status: 'done' } }
    const receipt: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: t('chat.action.doneReceipt', { label: cand.label, category: toLabel }),
      createdAt: new Date().toISOString(),
    }
    await persist(done, receipt)
  },
  // ── AI Chat · sendMessage (docs/design/ai-chat-impl-plan.md §4) ──────────
  // intent(LLM) → 本地 localRecall → answer(LLM) → 落 conversation。离线直接拒绝（不假装降级）。
  // 防幻觉层 3：空 cites 不调 answer LLM，直接「库内未找到依据」裸答拒绝。同问缓存命中跳两轮。
  sendMessage: async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const { online, conversation, entries } = get()
    const now = new Date().toISOString()

    // 离线拒绝：追加 error 消息，UI 显禁用提示，不调 LLM。
    if (!online) {
      const errMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: t('chat.errOffline'), createdAt: now, error: true }
      const conv = appendMessage(ensureConversation(conversation), errMsg)
      set({ conversation: conv, chatLoading: 'idle' })
      void di.storage.saveConversation(conv)
        .then(() => get().refreshChatList())
        .catch((e) => console.error('[store] saveConversation(offline) failed', e))
      return
    }

    // M2: 本轮 chatLoading 所有权序号（离线拒绝是 UI 级拒绝、不占用序号）。
    const seq = ++chatSendSeq

    // 1. 乐观追加用户消息 + intent 阶段。先落库用户消息（即使后续 LLM 失败也保留对话记录）。
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed, createdAt: now }
    let conv = appendMessage(ensureConversation(conversation), userMsg)
    set({ conversation: conv, chatLoading: 'intent' })
    void di.storage.saveConversation(conv)
      .then(() => get().refreshChatList())
      .catch((e) => console.error('[store] saveConversation(user) failed', e))

    // 缓存命中：跳两轮付费 LLM，直接追加缓存 answer。
    const cached = chatAnswerCache.get(chatCacheKey(trimmed, entries))
    if (cached) {
      const aiMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: cached.answer, citedEntryIds: cached.citedEntryIds, createdAt: new Date().toISOString() }
      conv = appendMessage(conv, aiMsg)
      set({ conversation: conv, chatLoading: 'idle' })
      void di.storage.saveConversation(conv)
        .then(() => get().refreshChatList())
        .catch((e) => console.error('[store] saveConversation(cached) failed', e))
      // P-B 滚动摘要（2026-10-03）：缓存答案同样落库计条，积攒 >10 条未压缩 → 后台压缩。
      void maybeRollSummary(conv)
      return
    }

    // 流式占位消息 id/创建时间（2026-09-28）：answer 轮 append 占位后赋值；外层 catch 用它
    // 把占位原位转为错误消息（不追加新气泡，位置稳定）。
    let streamMsgId: string | null = null
    let streamCreatedAt = ''
    // 流式累积态提升到 try 外（m9）：外层 catch 的错误消息 trace 需带上已累积 reasoning 便于排查。
    let reasoningAccum = ''
    let rawAccum = ''

    try {
      // 2. intent 轮：解析问句 → ChatQuery（scope/keywords/categorySlugs + kind/timeIntent/city/action）。
      // categories 第三参（2026-09-29 能力大补）：现有类别注入 intent prompt，提高 action 分支 slug 命中率。
      const query = await di.llm.parseChatIntent(
        trimmed,
        new Date().toISOString(),
        get().categories.map((c) => ({ slug: c.slug, label: c.label })),
      )
      const kind = query.kind ?? 'recall'
      const { aiByEntry, tags } = get()

      // 能力大补 dispatch（2026-09-29）：action=改分类确认卡（不调 answer LLM、不写缓存、
      // 不跑记忆提取——动作类问题无可记，模板化 i18n 文案早 return）；weather/search=外部
      // 数据块拼 extraSystem（跳过 localRecall，cites=[]）；否则旧 recall 流程（一字不动）。
      if (kind === 'action' && query.action) {
        const act = query.action
        // 1. 类别解析：slug 命中 → 现有；label/aliases 大小写不敏感匹配 → 现有；都不中 → 新涌现类别。
        const cat = resolveActionCategory(act, get().categories)
        // 2. 条目解析：intent keywords + entryHint 去重喂 localRecall，取前 5 候选。
        const keywords = [...new Set([...(query.keywords ?? []), act.entryHint].filter(Boolean))]
        const candidates = localRecall({ scope: null, keywords }, entries, aiByEntry, tags)
          .slice(0, 5)
          .map((c) => ({
            entryId: c.id,
            label: aiByEntry[c.id]?.titleSuggestion || aiByEntry[c.id]?.summary || c.textExcerpt.slice(0, 20) || t('chat.entryFallback'),
            fromCategory: aiByEntry[c.id]?.category || '',
          }))
        const actionTrace: ChatTrace = {
          intent: {
            keywords: query.keywords ?? [],
            scope: null,
            categorySlugs: query.categorySlugs,
            kind: query.kind,
            timeIntent: query.timeIntent,
            actionHint: act.entryHint,
          },
          recalled: candidates.map((c) => ({ id: c.entryId, label: c.label })),
        }
        // 0 候选 → notFound 模板文案；1 → pending 确认卡；多 → ambiguous 候选卡（≤5）。
        const actionMsg: ChatMessage = candidates.length === 0
          ? { id: crypto.randomUUID(), role: 'assistant', content: t('chat.action.notFound', { hint: act.entryHint }), createdAt: new Date().toISOString(), trace: actionTrace }
          : {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString(),
              kind: 'actionConfirm',
              trace: actionTrace,
              action: {
                entryHint: act.entryHint,
                status: candidates.length === 1 ? 'pending' : 'ambiguous',
                candidates,
                toCategorySlug: cat.slug,
                toCategoryLabel: cat.label,
                isNewCategory: cat.isNew,
              },
            }
        conv = appendMessage(conv, actionMsg)
        // 竞态防护照 answer finalize（:1045 模式）：已切会话只落库不动当前视图；
        // 自己仍是最新 seq 时复位 chatLoading（防软锁）。
        if (get().conversation?.id === conv.id) set({ conversation: conv, chatLoading: 'idle' })
        else if (seq === chatSendSeq) set({ chatLoading: 'idle' })
        void di.storage.saveConversation(conv)
          .then(() => get().refreshChatList())
          .catch((e) => console.error('[store] saveConversation(action) failed', e))
        return
      }
      // action 缺负载（intent 解析异常）→ 防御降级 recall，不崩主流程。
      const dispatchKind: 'recall' | 'weather' | 'search' = kind === 'action' ? 'recall' : kind

      // 3. 本地召回 / 外部数据块。
      // M2: seq 过期（用户已切会话/发新问）→ 不再推相位，防覆盖新轮的 chatLoading。
      let cites: ChatCite[] = []
      let extraSystem = ''
      if (dispatchKind === 'weather') {
        // weather 分支：city=问句地名 → 有 key 时定位反查兜底；一切失败写降级数据块（不抛错）。
        if (seq === chatSendSeq) set({ chatLoading: 'weather' })
        const key = await di.secrets.get('geocoding:key')
        let city = query.city
        if (!city && key) {
          const loc = await di.capture.getLocation()
          if (loc) city = (await reverseGeocodeCity(loc.lat, loc.lng, key))?.city
        }
        if (!key) {
          extraSystem = t('chat.weather.noKey')
        } else if (!city) {
          extraSystem = t('chat.weather.noCity')
        } else {
          const w = await getWeatherLive(city, key)
          extraSystem = w
            ? `天气数据（高德，${w.reporttime} 发布）：${w.city} ${w.weather}，气温 ${w.temperature}°C，${w.winddirection}风 ${w.windpower} 级，湿度 ${w.humidity}%。以此为准回答，不要凭记忆猜天气。`
            : t('chat.weather.failed')
        }
      } else if (dispatchKind === 'search') {
        // search 分支（Tavily 唯一 provider）：结果块带 [标题](URL) 标注指令；失败写降级数据块。
        if (seq === chatSendSeq) set({ chatLoading: 'search' })
        const key = await di.secrets.get('search:key')
        if (!key) {
          extraSystem = t('chat.search.noKey')
        } else {
          const results = await webSearch(trimmed, key)
          extraSystem = results && results.length > 0
            ? '网络搜索结果（回答时用 [标题](URL) 标注来源）：\n' +
              results.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet}（${r.url}）`).join('\n')
            : t('chat.search.failed')
        }
      } else {
        // 本地召回（recall 阶段，纯函数，毫秒级）。
        if (seq === chatSendSeq) set({ chatLoading: 'recall' })
        cites = localRecall(query, entries, aiByEntry, tags)
        // P-B 语义臂（2026-10-03）：embed 可用时按问句向量补召回合并进 cites；
        // 缺席/失败静默降级，行为与纯关键词召回逐字节一致。
        cites = await withSemanticArm(trimmed, cites, entries, aiByEntry)
      }

      // timeIntent（与 kind 正交）：当前时间行拼 extraSystem 第一行。
      if (query.timeIntent) {
        extraSystem = currentTimeLine(new Date()) + (extraSystem ? '\n' + extraSystem : '')
      }

      // 滚动摘要注入（2026-10-03 P-B）：有摘要才拼「早前对话摘要：…」段，
      // 与时间行/天气块/搜索块并列（extraSystem 一个口子，answer prompt 本体零改动）。
      if (conv.rollingSummary) {
        extraSystem = t('chat.rollingSummary', { summary: conv.rollingSummary }) + (extraSystem ? '\n' + extraSystem : '')
      }

      // trace：思维链记录，UI 默认折叠可展开（D37）。
      const trace: ChatTrace = {
        intent: {
          keywords: query.keywords ?? [],
          scope: query.scope ? { type: query.scope.type, range: query.scope.range } : null,
          categorySlugs: query.categorySlugs,
          kind: query.kind,
          timeIntent: query.timeIntent,
          city: query.city,
          actionHint: query.action?.entryHint,
        },
        recalled: cites.map((c) => ({
          id: c.id,
          label: aiByEntry[c.id]?.titleSuggestion || aiByEntry[c.id]?.summary || c.textExcerpt.slice(0, 20) || '条目',
        })),
      }

      // 4. answer 轮：localRecall 兜底保证 cites 非空（全 0 命中时回落近期 top-K）。
      // 不再因 cites 空硬裸答——交给 LLM 综合判断相关性并自然作答（D35：效果优先）。
      // M2: seq 守卫同 recall——旧轮不得把 chatLoading 推成 answer（曾致全局输入软锁）。
      if (seq === chatSendSeq) set({ chatLoading: 'answer' })

      // 流式编排（2026-09-28）：cites 非空走流式链路——先 append 占位 assistant 消息
      // （streaming:true，落库一次），onEvent 增量 ~80ms 节流 flush 到内存（流式期间不再
      // 落库），结束 finalize 原位替换占位 + 落库。cites 空维持旧裸答路径（不调 LLM）。
      let streamPartial = false // 断流/失败以部分可见文本 finalize 的降级答案（不完整，不进缓存）

      let answer: ChatAnswer
      // cites 空门槛（2026-09-29）：仅 recall 且 cites 空才裸答拒绝；weather/search 的
      // cites=[] 照常进流式 answer（事实在 extraSystem 数据块里）。
      if (dispatchKind === 'recall' && cites.length === 0) {
        answer = { answer: t('chat.errNoCites'), citedEntryIds: [] }
      } else {
        streamMsgId = crypto.randomUUID()
        streamCreatedAt = new Date().toISOString()
        const placeholder: ChatMessage = { id: streamMsgId, role: 'assistant', content: '', streaming: true, createdAt: streamCreatedAt, trace }
        conv = appendMessage(conv, placeholder)
        // M3: 竞态防护同 finalize——intent 轮中用户可能已切会话，此时只 saveConversation
        // 落占位到原会话，绝不 set 把当前视图掰回本会话。
        if (get().conversation?.id === conv.id) set({ conversation: conv })
        void di.storage.saveConversation(conv)
          .then(() => get().refreshChatList())
          .catch((e) => console.error('[store] saveConversation(placeholder) failed', e))

        // 节流 flush：reasoning 累积进 trace.reasoning（「思考过程」折叠块实时渲染）；
        // content 累积 rawAccum 过 extractPartialAnswer 提可见文本（气泡逐字渲染）。
        // 增量合并进 pending，~80ms 一帧写 store。会话已切换时丢弃内存 flush
        // （finalize 仍 saveConversation 收口到原会话）。
        const convId = conv.id
        const msgId = streamMsgId
        let flushTimer: ReturnType<typeof setTimeout> | null = null
        let pending: Partial<ChatMessage> = {}
        const flush = (): void => {
          flushTimer = null
          const patch = pending
          pending = {}
          if (Object.keys(patch).length === 0) return
          if (get().conversation?.id !== convId) return
          get().updateChatMessage(msgId, patch)
        }
        const scheduleFlush = (patch: Partial<ChatMessage>): void => {
          pending = { ...pending, ...patch }
          if (flushTimer === null) flushTimer = setTimeout(flush, 80)
        }
        const cancelFlush = (): void => {
          if (flushTimer !== null) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          pending = {}
        }
        try {
          answer = await di.llm.answerChat(
            {
              question: trimmed,
              cites,
              conversation: chatHistory(conversation, CHAT_HISTORY_WINDOW),
              // 能力大补（2026-09-29）：当前时间行（timeIntent）/ 天气数据块 / 搜索结果块。
              extraSystem: extraSystem || undefined,
            },
            (ev) => {
              if (ev.type === 'reasoning') {
                reasoningAccum += ev.delta
                scheduleFlush({ trace: { ...trace, reasoning: reasoningAccum } })
              } else {
                rawAccum += ev.delta
                scheduleFlush({ content: extractPartialAnswer(rawAccum) })
              }
            },
          )
        } catch (streamErr) {
          // 断流/失败：有部分可见文本 → finalize 部分答案（不报错）；无 → 抛给外层 catch 错误路径。
          const partial = extractPartialAnswer(rawAccum)
          if (!partial) throw streamErr
          streamPartial = true
          answer = { answer: partial, citedEntryIds: [] }
        } finally {
          cancelFlush()
        }
      }

      // Finding 5 兜底：剥掉回答正文开头的 [YYYY-MM-DD] 前缀（模型模仿历史格式的回显）。
      // 在缓存写入与落库/ finalize 之前统一清洗，缓存命中路径复用的也是干净文本。
      answer = { ...answer, answer: stripLeadingDatePrefix(answer.answer) }

      // 缓存（entries 签名不变即复用）。断流降级答案不完整，不进缓存。
      // 缓存门（2026-09-29）：仅 recall 且无时间意图才写——weather/search 每次查新数据、
      // timeIntent 答案绑定发问时刻，缓存会答出过期天气/旧时间。
      if (!streamPartial && dispatchKind === 'recall' && !query.timeIntent) chatAnswerCache.set(chatCacheKey(trimmed, entries), answer)

      if (streamMsgId !== null) {
        // 流式 finalize：原位替换占位消息（id/createdAt 稳定，UI 无跳变、不重播入场动画）；
        // reasoning 全文留 trace 可回看。conv.updatedAt bump 到现在（chatList 倒序置顶）。
        const finalTrace: ChatTrace = reasoningAccum ? { ...trace, reasoning: reasoningAccum } : trace
        const finalMsg: ChatMessage = { id: streamMsgId, role: 'assistant', content: answer.answer, citedEntryIds: answer.citedEntryIds, createdAt: streamCreatedAt, streaming: false, trace: finalTrace }
        conv = { ...conv, messages: conv.messages.map((m) => (m.id === streamMsgId ? finalMsg : m)), updatedAt: new Date().toISOString() }
      } else {
        const aiMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: answer.answer, citedEntryIds: answer.citedEntryIds, createdAt: new Date().toISOString(), trace }
        conv = appendMessage(conv, aiMsg)
      }
      // 会话切换竞态防护：流式窗口长，期间用户可能 newConversation/loadConversation。
      // 仍是当前会话 → set 内存态；已切换 → 只 saveConversation 落库到原会话，不动当前
      // conversation/chatLoading（新会话自己的 sendMessage 在管理 loading 相位）。
      // M2: guard 失败但自己仍是最新 seq（如切走但未发新问）→ 必须复位 chatLoading，
      // 否则本轮推入的 'answer' 相位永久残留 → 全局输入框软锁。
      if (get().conversation?.id === conv.id) set({ conversation: conv, chatLoading: 'idle' })
      else if (seq === chatSendSeq) set({ chatLoading: 'idle' })
      void di.storage.saveConversation(conv)
        .then(() => get().refreshChatList())
        .catch((e) => console.error('[store] saveConversation(answer) failed', e))

      // P-B 滚动摘要（2026-10-03）：积攒 >10 条未压缩 → 后台压缩早期对话（本轮不等，
      // 摘要为下一轮准备；独立 try/catch，失败仅 console.warn）。
      void maybeRollSummary(conv)

      // 回答成功落库后：自动记忆提取（2026-09-10 陪伴化——每轮都尝试，不再仅限「记住」类意图）。
      // 闸门与分流：
      // - settings.autoMemory===false → 只响应显式「记住 X」意图（用户明示永远生效），隐式轮跳过。
      // - 显式意图提取成功 → 追加「已记住」确认消息；隐式提取成功 → 静默落记忆（聊天流免打扰，
      //   用户可在 设置→AI 记忆 里审阅/停用/删除）。
      // - 去重：现有 enabled 记忆原文传给提取器（knownMemories），无新增信息 → NULL。
      // 缓存命中路径在前面早返、不走这里（同问句首次已提取过，省一次 LLM 调用）。
      // fire-and-forget + 自闭环 try/catch：extractMemory 失败静默，不影响主问答（answer 已显）。
      // 复用 saveMemory action：内部造 Memory 对象（id/enabled/timestamps）+ 落库 + 内存态追加。
      void (async () => {
        const explicit = /记住|记一下|以后.*记|别忘了|给我记/.test(trimmed)
        if (!explicit && get().settings.autoMemory === false) return
        // memories 数组新者在首（saveMemory prepend）；截 50 条防 prompt 膨胀。
        // P-C：归档记忆不进 prompt 注入，也不参与提取去重（视为不再已知，允许重新记住）。
        const known = get().memories.filter((m) => m.enabled && !m.archivedAt).map((m) => m.content).slice(0, 50)
        let memoryContent: string | null
        try {
          memoryContent = await di.llm.extractMemory(trimmed, known)
        } catch (e) {
          console.error('[store] extractMemory failed', e)
          return
        }
        if (!memoryContent) return
        await get().saveMemory(memoryContent)
        if (!explicit) return // 隐式提取静默落，不打扰聊天流
        const confirmMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t('chat.memoryConfirm', { content: memoryContent }),
          createdAt: new Date().toISOString(),
          kind: 'memoryConfirm',
        }
        const cur = get().conversation ?? ensureConversation(null)
        const conv2 = appendMessage(cur, confirmMsg)
        set({ conversation: conv2 })
        void di.storage.saveConversation(conv2)
          .then(() => get().refreshChatList())
          .catch((e) => console.error('[store] saveConversation(memory) failed', e))
      })().catch((e) => console.error('[store] memory pipeline failed', e))
    } catch (e) {
      // 任一 LLM 轮失败：追加 error 消息（不抛——UI 显重试态而非卡 loading）。
      // D37: content 带真实失败原因（非笼统「稍后重试」），trace.error 存原文便于排查。
      console.error('[store] sendMessage failed', e)
      const reason = e instanceof Error ? e.message : String(e)
      // m9: 错误消息 trace 带上已累积 reasoning（流式断点前思考模型已推理的部分），便于排查断点。
      const errTrace: ChatTrace = reasoningAccum ? { error: reason, reasoning: reasoningAccum } : { error: reason }
      const errMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: t('chat.errGeneric', { reason }), createdAt: new Date().toISOString(), error: true, trace: errTrace }
      if (streamMsgId !== null) {
        // 流式占位已 append：原位转为错误消息（不追加新气泡，位置稳定；沿用占位 id/createdAt）。
        conv = { ...conv, messages: conv.messages.map((m) => (m.id === streamMsgId ? { ...errMsg, id: streamMsgId, createdAt: m.createdAt } : m)) }
      } else {
        conv = appendMessage(conv, errMsg)
      }
      // 竞态防护同 answer finalize：已切会话只落库，不动当前 conversation/chatLoading；
      // M2: 自己仍是最新 seq 时复位 chatLoading（防错误路径同样软锁）。
      if (get().conversation?.id === conv.id) set({ conversation: conv, chatLoading: 'idle' })
      else if (seq === chatSendSeq) set({ chatLoading: 'idle' })
      void di.storage.saveConversation(conv)
        .then(() => get().refreshChatList())
        .catch((e2) => console.error('[store] saveConversation(err) failed', e2))
    }
  },
  newConversation: () => {
    // 置 conversation=null。当前会话消息每次 append 时已落库（saveConversation），无需显式存档；
    // 空会话不落库自然消失。下条 sendMessage lazy-create 新 uuid 行。
    // M2: 离开发问中的会话 → 递增 seq，旧轮放弃 chatLoading 所有权（相位推入/finalize 复位随之失效）。
    chatSendSeq++
    set({ conversation: null, chatLoading: 'idle' })
  },
  loadConversation: async (id) => {
    // 载入历史会话续聊。未命中/跨账号（getConversation 返 undefined）或空会话 → 静默 noop，
    // 不动当前 conversation，避免误切到不存在的会话。
    // M4: 读出时抹掉持久层残留的 streaming:true 尸体（内存态语义不信持久层）。
    const conv = await di.storage.getConversation(id)
    if (conv && conv.messages.length > 0) {
      // M2: 切到不同会话 → 递增 seq（同 id 续看不夺权——发问中的会话仍归本轮管）。
      if (get().conversation?.id !== conv.id) chatSendSeq++
      set({ conversation: stripStreamingFlags(conv), chatLoading: 'idle' })
    }
  },
  deleteChatConversation: async (id) => {
    // 删单个会话。若删的是当前会话 → conversation=null（回到空新会话语义）。chatList 同步剔除。
    await di.storage.deleteConversation(id)
    // M2: 删除发问中的当前会话 → 递增 seq，旧轮放弃 chatLoading 所有权。
    if (get().conversation?.id === id) chatSendSeq++
    set((s) => ({
      conversation: s.conversation?.id === id ? null : s.conversation,
      chatList: s.chatList.filter((c) => c.id !== id),
    }))
  },
  refreshChatList: async () => {
    // 重读历史列表（过滤空会话——空会话不进历史）。hydrate / sendMessage 落库后 / delete 后调。
    try {
      const all = await di.storage.listConversations()
      set({ chatList: all.filter((c) => c.messages.length > 0) })
    } catch (e) { console.error('[store] refreshChatList failed', e) }
  },
  startChatVoice: async () => {
    // 复用 CapturePort.startAudio 的 WebSpeech live STT（zh-CN interim+final）。
    // transcript 写 chatVoice.finalized/interim，chat 屏实时渲染进输入框；blob 丢弃。
    set((s) => ({ chatVoice: { ...s.chatVoice, finalized: '', interim: '', micDenied: false } }))
    try {
      await di.capture.startAudio({
        onInterim: (t) => set((s) => ({ chatVoice: { ...s.chatVoice, interim: t } })),
        onFinal: (t) => set((s) => ({ chatVoice: { ...s.chatVoice, finalized: s.chatVoice.finalized + t, interim: '' } })),
      })
      set((s) => ({ chatVoice: { ...s.chatVoice, recording: true } }))
    } catch (e) {
      // getUserMedia NotAllowedError → micDenied；NotFoundError/SecurityError 也走这里。
      console.error('[store] chat startAudio failed', e)
      set((s) => ({ chatVoice: { ...s.chatVoice, recording: false, micDenied: true } }))
    }
  },
  stopChatVoice: async () => {
    if (!get().chatVoice.recording) return ''
    try {
      // stopAudio 释放 mic track + MediaRecorder；blob 忽略（chat 不存媒体）。
      await di.capture.stopAudio()
    } catch (e) {
      console.error('[store] chat stopAudio failed', e)
    }
    const cur = get().chatVoice
    const transcript = (cur.finalized + cur.interim).trim()
    set({ chatVoice: { recording: false, interim: '', finalized: '', micDenied: false } })
    return transcript
  },
  allowChatMic: () => set((s) => ({ chatVoice: { ...s.chatVoice, micDenied: false } })),
  // ── AI 记忆 actions（2026-07-22）──────────────────────────────────────────
  // 风格照抄 reminder 相关 action：save upsert + 内存态替换、delete 落库 + 过滤、toggle 翻转 enabled。
  // prompt 注入由 classify/answerChat 调用点自行 di.storage.listMemories() 拉取，store 不参与注入逻辑。
  // P-C 生命周期编排（2026-10-03 spec §2/§3）：embed 一次 batch 初筛（cosine≥0.85 top-3）→
  // adjudicateMemory 四选一 → applyMemoryVerdict 执行落库。降级矩阵（spec §5）：embed 缺席/
  // 抛错/返 null、无相似命中、裁决失败 → 全部走 ADD（与旧行为逐字节一致的新增路径）。
  saveMemory: (content) => {
    // 串行化（W0，见模块级 memoryQueue 注释）：整个函数体挂链尾执行。candidates 读取发生在
    // 链上任务真正运行时（非调用时），两次并行调用不再各持 T0 快照互踩。
    // 返回本次任务的 promise——调用方仍能 await/捕获本次错误（与串行 await 旧行为一致）；
    // 队列本身走 catch 分支续链，一次失败不毒化后续排队任务。
    const task = memoryQueue.then(async () => {
      const trimmed = content.trim()
      if (!trimmed) return
      const nowIso = new Date().toISOString()
      // 初筛候选 = enabled && 未归档（spec §2「enabled 记忆原文」；归档行不再参与判重）。
      const candidates = get().memories.filter((m) => m.enabled && !m.archivedAt)
      let similar: { id: string; content: string }[] = []
      const embed = di.llm.embed
      if (embed && candidates.length > 0) {
        try {
          const vecs = await embed([trimmed, ...candidates.map((m) => m.content)])
          if (vecs && vecs.length === candidates.length + 1 && vecs[0]) {
            const hits = topSimilarMemories(
              vecs[0],
              candidates.map((m, i) => ({ id: m.id, content: m.content, vec: vecs[i + 1] ?? [] })),
            )
            similar = hits.map(({ id, content }) => ({ id, content }))
          }
        } catch {
          similar = [] // embed 抛错 → 降级 ADD（spec §5，静默）
        }
      }
      let verdict: MemoryVerdict = { action: 'add' }
      if (similar.length > 0) {
        try {
          verdict = await di.llm.adjudicateMemory(trimmed, similar)
        } catch (e) {
          // 裁决失败兜底（spec §3）：默认 ADD 宁可多存不丢信息。
          console.warn('[store] adjudicateMemory failed, default ADD', e)
          verdict = { action: 'add' }
        }
      }
      const upserts = applyMemoryVerdict({
        memories: get().memories,
        newContent: trimmed,
        verdict,
        similar,
        nowIso,
        newId: crypto.randomUUID(),
      })
      for (const row of upserts) await di.storage.saveMemory(row)
      // 内存态合并：新行 prepend（新者在首），已有行原位替换。
      set((s) => {
        const byId = new Map(upserts.map((r) => [r.id, r]))
        const fresh = upserts.filter((r) => !s.memories.some((m) => m.id === r.id))
        return { memories: [...fresh, ...s.memories.map((m) => byId.get(m.id) ?? m)] }
      })
      // 归档扫描时机之一（spec §4）：saveMemory 成功后。await 保测试确定性；全表几十条开销可忽略。
      await get().archiveStaleMemories()
    })
    memoryQueue = task.catch((e) => console.error('[store] saveMemory task failed', e))
    return task
  },
  restoreMemory: async (id) => {
    const cur = get().memories.find((m) => m.id === id)
    if (!cur) return
    const now = new Date().toISOString()
    // 清 archivedAt + 刷 lastConfirmedAt + 保持 enabled（spec §4「恢复即回到 enabled」）。
    const updated: Memory = { ...cur, archivedAt: undefined, lastConfirmedAt: now, updatedAt: now }
    await di.storage.saveMemory(updated)
    set((s) => ({ memories: s.memories.map((m) => (m.id === id ? updated : m)) }))
  },
  archiveStaleMemories: async (nowIso) => {
    const nowMs = Date.parse(nowIso ?? new Date().toISOString())
    const stamp = new Date(nowMs).toISOString()
    const stale = get().memories.filter((m) => isStaleMemory(m, nowMs))
    if (stale.length === 0) return 0
    const rows = stale.map((m): Memory => ({ ...m, archivedAt: stamp }))
    for (const r of rows) await di.storage.saveMemory(r)
    const byId = new Map(rows.map((r) => [r.id, r]))
    set((s) => ({ memories: s.memories.map((m) => byId.get(m.id) ?? m) }))
    return rows.length
  },
  deleteMemory: async (id) => {
    await di.storage.deleteMemory(id)
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }))
  },
  toggleMemory: async (id) => {
    const cur = get().memories.find((m) => m.id === id)
    if (!cur) return
    const updated: Memory = { ...cur, enabled: !cur.enabled, updatedAt: new Date().toISOString() }
    await di.storage.saveMemory(updated)
    set((s) => ({ memories: s.memories.map((m) => (m.id === id ? updated : m)) }))
  },
}))

// 账号切换（login/register/bindNetwork/logout/registerGuest）后，accountStore 调本回调触发
// store 全量重载——清旧 owner 快照（隔离）。`if (hydrated)` 守卫：boot 期 accountStore.hydrate
// 的 post-adopt 触发时 store 尚未 hydrated → 跳过（store.hydrate 后续自读 adopt 后数据，不双载）。
// store→accountStore 单向依赖（本文件已 import accountStore），accountStore 不反向 import store，
// 故无环。注册替代动态 import（避免 Vite dev `?t=` HMR query 造成 useUiStore 实例分裂）。
registerStoreRehydrate(async () => {
  if (useUiStore.getState().hydrated) {
    await useUiStore.getState().rehydrate()
  }
})
