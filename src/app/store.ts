import { create } from 'zustand'
import type { Aggregate, AggregateScopeType, Category, Draft, Entry, EntryAi, EntryPart, GeoPoint, Reminder, Settings, Tag } from '@/domain/types'
import { seedAggregates, seedCategories, seedEntries, seedEntryAi, seedReminders, seedSettings, seedTags } from '@/data/seed'
import { di } from './di'

// 视图状态 / 采集草稿（PRD §7.3 应用层）。entries 走 DexieStorage：首屏 seed 兜底即时渲染，
// hydrate() 异步从 Dexie 载入真实条目（含历史保存）替换；finishSave 同时落库 + 入队分类。
interface CaptureDraft {
  parts: EntryPart[]
  recording: boolean
  saving: boolean
  micDenied: boolean
  finalized: string // accumulated finalized STT segments (live preview)
  interim: string // current partial segment (live preview)
  location?: GeoPoint // recordLocation 开时，采集开始时取一次（best-effort，未解析则 undefined）
  title?: string // Wave 3: user-editable compose title (UI-only, not on Entry domain)
}

interface UiState {
  capture: CaptureDraft
  online: boolean
  entries: Entry[] // 首屏 seed 兜底，hydrate 后为 Dexie 真实数据
  aiByEntry: Record<string, EntryAi> // 首屏 seed 兜底，hydrate 从 Dexie 载入；processEntry 成功后补
  categories: Category[] // 首屏 seed 兜底，hydrate 从 Dexie 载入（含涌现类别）
  tags: Tag[] // 首屏 seed 兜底，hydrate 从 Dexie 载入（含涌现标签）
  hydrated: boolean // 是否已从 Dexie 载入
  settings: Settings // 首屏 seed 兜底，hydrate 后为 Dexie 真实数据
  aggregates: Aggregate[] // 首屏 seed 兜底，hydrate 从 Dexie 载入；recomputeAggregate 后更新
  reminders: Reminder[] // 首屏 seed 兜底，hydrate 从 Dexie 载入；scheduleReminders 扫 pending 到点 fire
  recalculating: Record<string, boolean> // key=`${scope}:${range}`；recomputeAggregate in-flight 标记，UI 据此显 spinner（与 stale 分离，失败不永转）
  justSaved: boolean // 刚保存 → 首页 toast + 置顶处理中卡片
  hydrate: () => Promise<void>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  beginSave: () => void
  finishSave: () => void
  denyMic: () => void
  allowMic: () => void
  addPart: (p: EntryPart) => void
  clearDraft: () => void
  // Wave 3: persist/resume mid-entry draft across refresh + app restart.
  saveDraft: () => void
  loadDraft: () => Promise<void>
  clearJustSaved: () => void
  setOnline: (v: boolean) => void
  setSettings: (patch: Partial<Settings>) => void
  setLlmConfig: (url: string, model: string, key: string) => void
  setSttConfig: (model: string, key: string) => void
  processEntry: (entryId: string) => Promise<void>
  recomputeAggregate: (scope: AggregateScopeType, range?: string, detailLevel?: number) => Promise<void>
  // Phase 9 Batch 2b · 提醒。processEntry 不自动建 Reminder（Q2：用户在 B6 TodoConfirm 确认）。
  confirmReminder: (entryId: string, dueAt: string, label: string) => Promise<void>
  dismissReminder: (id: string) => Promise<void>
  snoozeReminder: (id: string, minutes: number) => Promise<void>
  // Wave 1 core actions（屏层纯消费，不碰 store.ts）
  saveCategory: (cat: Category) => Promise<void>
  deleteCategory: (slug: string) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  updateEntry: (id: string, patch: Partial<Entry>) => Promise<void>
  updateEntryAi: (entryId: string, patch: Partial<EntryAi>) => Promise<void>
  primeLocation: () => void
}

const emptyDraft: CaptureDraft = { parts: [], recording: false, saving: false, micDenied: false, finalized: '', interim: '', location: undefined, title: undefined }

// Compute the range string (dateKey) for a given scope anchored at a reference date.
// day → '2026-07-15' · week → '2026-W28' · month → '2026-07'.
function scopeRange(scope: AggregateScopeType, ref: Date): string {
  const y = ref.getFullYear()
  const m = String(ref.getMonth() + 1).padStart(2, '0')
  const d = String(ref.getDate()).padStart(2, '0')
  if (scope === 'day') return `${y}-${m}-${d}`
  if (scope === 'month') return `${y}-${m}`
  // ISO week: Thursday-based to avoid year-boundary edge cases.
  const tmp = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()))
  const dayNum = (tmp.getUTCDay() + 6) % 7
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3)
  const isoYear = tmp.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const week = 1 + Math.round(((tmp.getTime() - firstThursday.getTime()) / 86400000 - 3) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

// Filter entries that fall within the given scope+range. Each entry's own
// createdAt determines which day/week/month it belongs to; we match the range string.
function entriesInRange(entries: Entry[], scope: AggregateScopeType, range: string): Entry[] {
  return entries.filter((e) => scopeRange(scope, new Date(e.createdAt)) === range)
}

// ── 提醒调度（Phase 9 Batch 2b · B5）─────────────────────────────────────
// 前台 only（Q1）：setTimeout 到点 fire Notification；无 push server。
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
}

// 到点 fire：通知 + 置 fired + 落库 + 更新 state + 清 timeout 表。
function fireReminder(r: Reminder): void {
  clearScheduledTimeout(r.id)
  di.notifications.notify('AiJi 提醒', r.label, r.id)
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

// 扫 reminders state：pending 的 → 未来 setTimeout 到点；overdue <1h 补 fire；>1h 标 missed。
// 去重守卫：已在 timeout 表的 id 跳过（confirm/snooze 先 clearScheduledTimeout 再调本函数）。
function scheduleReminders(): void {
  const { reminders } = useUiStore.getState()
  const now = Date.now()
  for (const r of reminders) {
    if (r.status !== 'pending' && r.status !== 'snoozed') continue
    if (scheduledTimeouts.has(r.id)) continue
    const due = new Date(r.dueAt).getTime()
    const diff = due - now
    if (diff <= 0) {
      // overdue（含到点 0ms）
      if (-diff < 3_600_000) fireReminder(r) // <1h 补推（Q3）
      else markMissed(r) // ≥1h 标错过
    } else {
      // 未来：setTimeout 到点；fire 前 re-check（可能已被 dismiss/snooze）
      const h = setTimeout(() => {
        const cur = useUiStore.getState().reminders.find((x) => x.id === r.id)
        if (cur && (cur.status === 'pending' || cur.status === 'snoozed')) fireReminder(cur)
        else scheduledTimeouts.delete(r.id)
      }, diff)
      scheduledTimeouts.set(r.id, h)
    }
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  capture: emptyDraft,
  online: true,
  entries: seedEntries,
  aiByEntry: Object.fromEntries(seedEntryAi.map((a) => [a.entryId, a])),
  categories: seedCategories,
  tags: seedTags,
  hydrated: false,
  settings: seedSettings,
  aggregates: seedAggregates,
  reminders: seedReminders,
  recalculating: {},
  justSaved: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const [entries, settings, categories, tags, aggregates, reminders] = await Promise.all([
        di.storage.listEntries(),
        di.storage.getSettings(),
        di.storage.listCategories(),
        di.storage.listTags(),
        di.storage.listAggregates(),
        di.storage.listReminders(),
      ])
      // 载入每条条目的 AI（seed 条目 + 真实保存条目）。getEntryAi 返回最高 version。
      const aiPairs = await Promise.all(
        entries.map((e) => di.storage.getEntryAi(e.id).then((ai) => (ai ? [e.id, ai] as const : null))),
      )
      const aiByEntry = { ...Object.fromEntries(aiPairs.filter(Boolean) as [string, EntryAi][]) }
      set({ entries, settings, categories, tags, aggregates, reminders, aiByEntry, hydrated: true })
      // 载入后扫 pending 提醒：未来调度到点；overdue <1h 补 fire、≥1h 标 missed（Q3）。
      scheduleReminders()
      // Wave 3: 恢复上次未保存的采集草稿（跨刷新/重启续记）。
      await get().loadDraft()
    } catch (e) {
      // 载入失败：保持 seed 兜底，标记已尝试避免反复重试（存储失败不阻断 UI）
      console.error('[store] hydrate failed', e)
      set({ hydrated: true })
    }
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
    let result: { ref: string; durationSec: number; blob?: Blob }
    try {
      result = await di.capture.stopAudio()
    } catch (e) {
      console.error('[store] stopAudio failed', e)
      result = { ref: `audio-${crypto.randomUUID()}`, durationSec: 0.1 }
    }
    const cur = get().capture
    const transcript = (cur.finalized + cur.interim).trim()
    const part: EntryPart = { type: 'audio', ref: result.ref, durationSec: Math.max(1, Math.round(result.durationSec)), transcript }
    if (result.blob) void di.storage.saveMedia(result.ref, result.blob).catch((e) => console.error('[store] saveMedia failed', e))
    set((s2) => ({
      capture: { ...s2.capture, recording: false, finalized: '', interim: '', parts: [...s2.capture.parts, part] },
    }))
  },
  beginSave: () => set((s) => ({ capture: { ...s.capture, recording: false, saving: true } })),
  finishSave: () => {
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
    // Wave 3: 保存成功 → 清掉持久化草稿（若之前存过），避免下次进 capture 又恢复已保存内容。
    void di.storage.clearDraft().catch((e) => console.error('[store] clearDraft failed', e))
    // 落库：异步写 Dexie，失败只记日志不伤 UI（处理管线断网不丢后续补）
    void di.storage.saveEntry(entry).catch((e) => console.error('[store] saveEntry failed', e))
    // 分类入队（火忘）：AI 失败只伤 AI 层（条目标 failed，UI 可重试），采集存储已落库不受影响
    void get().processEntry(entry.id)
  },
  denyMic: () => set((s) => ({ capture: { ...s.capture, micDenied: true, recording: false } })),
  allowMic: () => set((s) => ({ capture: { ...s.capture, micDenied: false } })),
  addPart: (p) => set((s) => ({ capture: { ...s.capture, parts: [...s.capture.parts, p] } })),
  clearDraft: () => {
    // 内存草稿清空 + 删 Dexie 持久化草稿（避免清空后下次又恢复）。
    set({ capture: emptyDraft })
    void di.storage.clearDraft().catch((e) => console.error('[store] clearDraft failed', e))
  },
  saveDraft: () => {
    // 持久化当前 parts/title/location 到 Dexie drafts（单行覆盖，key=1）。
    // recording/saving/micDenied 不存（运行期态，不需跨会话）。
    const c = get().capture
    if (c.parts.length === 0) return
    const draft: Draft = {
      id: 1,
      parts: c.parts,
      title: c.title,
      location: c.location,
      updatedAt: new Date().toISOString(),
    }
    void di.storage.saveDraft(draft).catch((e) => console.error('[store] saveDraft failed', e))
  },
  loadDraft: async () => {
    // 仅在当前 capture 为空时恢复，避免覆盖用户本会话已记的 parts。
    const c = get().capture
    if (c.parts.length > 0) return
    const d = await di.storage.loadDraft()
    if (d && d.parts.length > 0) {
      set({ capture: { ...emptyDraft, parts: d.parts, title: d.title, location: d.location } })
    }
  },
  clearJustSaved: () => set({ justSaved: false }),
  setOnline: (v) => set({ online: v }),
  setSettings: (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
  },
  setLlmConfig: (url, model, key) => {
    const cur = get().settings
    const next = { ...cur, llmUrl: url, llmModel: model, apiKeyRef: key ? 'llm:key' : cur.apiKeyRef }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    if (key) void di.secrets.set('llm:key', key).catch((e) => console.error('[store] setLlmKey failed', e))
  },
  setSttConfig: (model, key) => {
    const cur = get().settings
    const next = { ...cur, sttModel: model, sttKeyRef: key ? 'stt:key' : cur.sttKeyRef }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    if (key) void di.secrets.set('stt:key', key).catch((e) => console.error('[store] setSttKey failed', e))
  },
  processEntry: async (entryId) => {
    try {
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
    const recalcingKey = `${scope}:${dateKey}`
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
  // ── 提醒 actions（Phase 9 Batch 2b · B5）──────────────────────────────
  confirmReminder: async (entryId, dueAt, label) => {
    // Q4：首次确认提醒时请求 Notification.permission（情境相关，不无脑弹）。
    // permissionRequested flag 保证只问一次；denied 后不再骚扰，notify 走 toast 降级。
    if (!permissionRequested) {
      permissionRequested = true
      void di.notifications.requestPermission()
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
    // fire-and-forget：Reminder 已落库（关键步），清 suggestion 是 cosmetic——写失败不应让 confirmReminder reject（否则用户重试会建重复）。
    // 深链直达 detail 时 hydrate 可能尚未载入 aiByEntry → 从 Dexie 取，确保 suggestion 仍被清掉。
    const ai = get().aiByEntry[entryId] ?? (await di.storage.getEntryAi(entryId))
    if (ai?.reminderSuggestion) {
      const cleared: EntryAi = { ...ai, reminderSuggestion: undefined }
      void di.storage.saveEntryAi(cleared)
        .then(() => set((s) => ({ aiByEntry: { ...s.aiByEntry, [entryId]: cleared } })))
        .catch((e) => console.error('[store] clear reminderSuggestion failed', e))
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
}))
