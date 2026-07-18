import { create } from 'zustand'
import type { Aggregate, AggregateScopeType, Category, ChatAnswer, ChatMessage, Conversation, Draft, Entry, EntryAi, EntryPart, GeoPoint, Reminder, Settings, Tag } from '@/domain/types'
import { scopeRange } from '@/domain/dateRange'
import { localRecall } from '@/ui/screens/chat/helpers'
import { seedSettings } from '@/data/seed'
import { enrichLocation } from '@/adapters/geocoding'
import * as summaryCache from '@/adapters/summaryCache'
import { di } from './di'

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
  primeLocation: () => void
  // AI Chat · 纯读检索 (docs/design/ai-chat-impl-plan.md)。MVP 单会话 id=1。
  // conversation null = 尚未载入/无会话（首次 sendMessage lazy-create）。chatLoading 驱动
  // 两轮 loading 文案（intent 理解问题 / recall 检索库中 / answer 组织回答）。
  conversation: Conversation | null
  chatLoading: 'idle' | 'intent' | 'recall' | 'answer'
  sendMessage: (text: string) => Promise<void>
  clearConversation: () => Promise<void>
  // 语音输入（chat 屏复用 CapturePort.startAudio 的 live STT；transcript 流入输入框，不落库不存媒体）。
  // 与 capture 切片分离：chat 语音是临时的，不进 Entry/草稿；blob 丢弃（stopAudio 仍返，适配器要 stop 释放 mic）。
  chatVoice: { recording: boolean; interim: string; finalized: string; micDenied: boolean }
  startChatVoice: () => Promise<void>
  stopChatVoice: () => Promise<string> // 返回 transcript（finalized+interim.trim），调用方写入输入框
  allowChatMic: () => void
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
// 通知展示由 di.localNotifications.schedule 预约（未来到点）或 fireReminder 内 notify（overdue 补推）处理。
function fireReminder(r: Reminder, opts?: { fromOverdue?: boolean }): void {
  clearScheduledTimeout(r.id)
  // overdue 补推路径（hydrate 时发现已过到点 <1h）未走过 schedule → 此处即时 notify。
  // 未来到点路径：schedule 已预约系统通知，不重复 notify（避免双通知）。
  if (opts?.fromOverdue) {
    di.localNotifications.notify('AiJi 提醒', r.label, r.id)
  }
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
// MVP 单会话 id=1。多会话时改 CHAT_CONVERSATION_ID 为 list + UI 选会话。
const CHAT_CONVERSATION_ID = '1'
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

// conversation null → 空会话单行（首次 sendMessage lazy-create）。
function ensureConversation(c: Conversation | null): Conversation {
  return c ?? { id: CHAT_CONVERSATION_ID, messages: [], updatedAt: new Date().toISOString() }
}

function appendMessage(c: Conversation, m: ChatMessage): Conversation {
  return { ...c, messages: [...c.messages, m], updatedAt: m.createdAt }
}

// 从 conversation 取最近 N 条 {role, content} 作 answer LLM 对话历史（不含当前问题——
// buildAnswerPrompt 把当前问题作为最后一轮 user 追加，故此处只给先前轮次）。跳过 error 消息。
function chatHistory(conv: Conversation | null, limit: number): { role: 'user' | 'assistant'; content: string }[] {
  if (!conv) return []
  return conv.messages
    .filter((m) => !m.error)
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }))
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
  recalculating: {},
  justSaved: false,
  pendingReminder: null,
  firingReminder: null,
  conversation: null,
  chatLoading: 'idle',
  chatVoice: { recording: false, interim: '', finalized: '', micDenied: false },
  hydrate: async () => {
    if (get().hydrated) return
    try {
      // Wave 4: 先 purge >30d 软删条目（硬删 + cascade AI/提醒），再读列表（listTrashed 不返过期）。
      try { await di.storage.purgeExpired() } catch (e) { console.error('[store] purgeExpired failed', e) }
      const [entries, settings, categories, tags, aggregates, reminders, drafts, trashed] = await Promise.all([
        di.storage.listEntries(),
        di.storage.getSettings(),
        di.storage.listCategories(),
        di.storage.listTags(),
        di.storage.listAggregates(),
        di.storage.listReminders(),
        di.storage.listDrafts(),
        di.storage.listTrashed(),
      ])
      // 载入每条条目的 AI（seed 条目 + 真实保存条目）。getEntryAi 返回最高 version。
      const aiPairs = await Promise.all(
        entries.map((e) => di.storage.getEntryAi(e.id).then((ai) => (ai ? [e.id, ai] as const : null))),
      )
      const aiByEntry = { ...Object.fromEntries(aiPairs.filter(Boolean) as [string, EntryAi][]) }
      set({ entries, settings, categories, tags, aggregates, reminders, drafts, trashed, aiByEntry, hydrated: true })
      // 载入后扫 pending 提醒：未来调度到点；overdue <1h 补 fire、≥1h 标 missed（Q3）。
      scheduleReminders()
      // Wave 4: 恢复最近草稿（跨刷新/重启续记）。多草稿里取最新一条载入 capture（仅当 capture 空）。
      await get().loadDraft()
      // AI Chat: 载入单会话 id=1（无则首次 sendMessage 时 lazy-create）。
      try {
        const conv = await di.storage.getConversation(CHAT_CONVERSATION_ID)
        if (conv) set({ conversation: conv })
      } catch (e) { console.error('[store] loadConversation failed', e) }
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
  processEntry: async (entryId, isFresh) => {
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
          const enriched = await enrichLocation(fresh0.location)
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
      const sttKey = await di.secrets.get('stt:key')
      if (sttKey) {
        const fresh = await di.storage.getEntry(entryId)
        if (fresh) {
          let changed = false
          const parts = await Promise.all(
            fresh.parts.map(async (p) => {
              if (p.type !== 'audio' && p.type !== 'video') return p
              try {
                const text = await di.stt.transcribe(p.ref)
                if (!text) return p
                changed = true
                return { ...p, transcript: text }
              } catch (e) {
                console.error('[store] stt failed for ' + p.ref, e)
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
        const updated: Entry = { ...entry, status: 'ready', aiId: ai.id, updatedAt: new Date().toISOString() }
        await di.storage.saveEntry(updated)
        set((s) => ({
          entries: s.entries.map((e) => (e.id === entryId ? updated : e)),
          aiByEntry: { ...s.aiByEntry, [entryId]: ai },
          categories,
          tags,
        }))
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
        const updated: Entry = { ...entry, status: 'failed', updatedAt: new Date().toISOString() }
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
    // D18: stale 时查 localStorage 缓存兜底——LLM 失败后 catch 块 restore stale=prevStale=true，
    // 但缓存里其实有上次成功的旧摘要。shouldRefresh 对 day scope 比较 entryCount：新条目仍重算
    // （设计意图保留），LLM 失败后 entryCount 未变 → 缓存 fresh → return 跳过重算，避免死循环。
    // 双保险：防 onRegen 后 sweep 绕过、或其它路径直调 recomputeAggregate 时不必要地重打付费 LLM。
    if (existing?.stale) {
      const count = inRange.length
      const cached = summaryCache.get(scope, dateKey)
      if (
        cached !== null &&
        !summaryCache.shouldRefresh(scope, dateKey, count) &&
        (existing.detailLevel ?? 3) === lvl
      ) {
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
      const errMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '离线中，连上网再问。', createdAt: now, error: true }
      const conv = appendMessage(ensureConversation(conversation), errMsg)
      set({ conversation: conv, chatLoading: 'idle' })
      void di.storage.saveConversation(conv).catch((e) => console.error('[store] saveConversation(offline) failed', e))
      return
    }

    // 1. 乐观追加用户消息 + intent 阶段。先落库用户消息（即使后续 LLM 失败也保留对话记录）。
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed, createdAt: now }
    let conv = appendMessage(ensureConversation(conversation), userMsg)
    set({ conversation: conv, chatLoading: 'intent' })
    void di.storage.saveConversation(conv).catch((e) => console.error('[store] saveConversation(user) failed', e))

    // 缓存命中：跳两轮付费 LLM，直接追加缓存 answer。
    const cached = chatAnswerCache.get(chatCacheKey(trimmed, entries))
    if (cached) {
      const aiMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: cached.answer, citedEntryIds: cached.citedEntryIds, createdAt: new Date().toISOString() }
      conv = appendMessage(conv, aiMsg)
      set({ conversation: conv, chatLoading: 'idle' })
      void di.storage.saveConversation(conv).catch((e) => console.error('[store] saveConversation(cached) failed', e))
      return
    }

    try {
      // 2. intent 轮：解析问句 → ChatQuery（scope/keywords/categorySlugs）。
      const query = await di.llm.parseChatIntent(trimmed, new Date().toISOString())

      // 3. 本地召回（recall 阶段，纯函数，毫秒级）。
      set({ chatLoading: 'recall' })
      const { aiByEntry, tags } = get()
      const cites = localRecall(query, entries, aiByEntry, tags)

      // 4. answer 轮：空 cites 不调 LLM（防幻觉层 3）；非空则基于 cites 作答 + 后校验剔非法 id（适配器已做）。
      set({ chatLoading: 'answer' })
      const answer: ChatAnswer =
        cites.length === 0
          ? { answer: '库内未找到依据。可以换个问法，或告诉我大致的时间、关键词。', citedEntryIds: [] }
          : await di.llm.answerChat({ question: trimmed, cites, conversation: chatHistory(conversation, CHAT_HISTORY_WINDOW) })

      // 缓存（entries 签名不变即复用）。
      chatAnswerCache.set(chatCacheKey(trimmed, entries), answer)

      const aiMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: answer.answer, citedEntryIds: answer.citedEntryIds, createdAt: new Date().toISOString() }
      conv = appendMessage(conv, aiMsg)
      set({ conversation: conv, chatLoading: 'idle' })
      void di.storage.saveConversation(conv).catch((e) => console.error('[store] saveConversation(answer) failed', e))
    } catch (e) {
      // 任一 LLM 轮失败：追加 error 消息（不抛——UI 显重试态而非卡 loading）。
      console.error('[store] sendMessage failed', e)
      const errMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '问答出了点问题，稍后重试。', createdAt: new Date().toISOString(), error: true }
      conv = appendMessage(conv, errMsg)
      set({ conversation: conv, chatLoading: 'idle' })
      void di.storage.saveConversation(conv).catch((e2) => console.error('[store] saveConversation(err) failed', e2))
    }
  },
  clearConversation: async () => {
    // 清空当前会话消息（保留 id=1 行，messages=[]）。下次 sendMessage 重新开始。
    const conv = ensureConversation(get().conversation)
    const cleared: Conversation = { ...conv, messages: [], updatedAt: new Date().toISOString() }
    set({ conversation: cleared, chatLoading: 'idle' })
    void di.storage.saveConversation(cleared).catch((e) => console.error('[store] clearConversation failed', e))
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
}))
