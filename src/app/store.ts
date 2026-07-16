import { create } from 'zustand'
import type { Aggregate, AggregateScopeType, Category, Entry, EntryAi, EntryPart, Settings, Tag } from '@/domain/types'
import { seedAggregates, seedCategories, seedEntries, seedEntryAi, seedSettings, seedTags } from '@/data/seed'
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
  clearJustSaved: () => void
  setOnline: (v: boolean) => void
  setSettings: (patch: Partial<Settings>) => void
  setLlmConfig: (url: string, model: string, key: string) => void
  setSttConfig: (model: string, key: string) => void
  processEntry: (entryId: string) => Promise<void>
  recomputeAggregate: (scope: AggregateScopeType, range?: string) => Promise<void>
}

const emptyDraft: CaptureDraft = { parts: [], recording: false, saving: false, micDenied: false, finalized: '', interim: '' }

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
  justSaved: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const [entries, settings, categories, tags, aggregates] = await Promise.all([
        di.storage.listEntries(),
        di.storage.getSettings(),
        di.storage.listCategories(),
        di.storage.listTags(),
        di.storage.listAggregates(),
      ])
      // 载入每条条目的 AI（seed 条目 + 真实保存条目）。getEntryAi 返回最高 version。
      const aiPairs = await Promise.all(
        entries.map((e) => di.storage.getEntryAi(e.id).then((ai) => (ai ? [e.id, ai] as const : null))),
      )
      const aiByEntry = { ...Object.fromEntries(aiPairs.filter(Boolean) as [string, EntryAi][]) }
      set({ entries, settings, categories, tags, aggregates, aiByEntry, hydrated: true })
    } catch (e) {
      // 载入失败：保持 seed 兜底，标记已尝试避免反复重试（存储失败不阻断 UI）
      console.error('[store] hydrate failed', e)
      set({ hydrated: true })
    }
  },
  startRecording: async () => {
    set((s) => ({ capture: { ...s.capture, finalized: '', interim: '' } }))
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
    }
    set({ capture: emptyDraft, entries: [entry, ...s.entries], justSaved: true })
    // 落库：异步写 Dexie，失败只记日志不伤 UI（处理管线断网不丢后续补）
    void di.storage.saveEntry(entry).catch((e) => console.error('[store] saveEntry failed', e))
    // 分类入队（火忘）：AI 失败只伤 AI 层（条目标 failed，UI 可重试），采集存储已落库不受影响
    void get().processEntry(entry.id)
  },
  denyMic: () => set((s) => ({ capture: { ...s.capture, micDenied: true, recording: false } })),
  allowMic: () => set((s) => ({ capture: { ...s.capture, micDenied: false } })),
  addPart: (p) => set((s) => ({ capture: { ...s.capture, parts: [...s.capture.parts, p] } })),
  clearDraft: () => set({ capture: emptyDraft }),
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
      // 分类成功 → fire-and-forget 触发当日聚合重算（stale → LLM 重新生成今日摘要）
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
  recomputeAggregate: async (scope, range) => {
    const ref = new Date()
    const dateKey = range ?? scopeRange(scope, ref)
    const inRange = entriesInRange(get().entries, scope, dateKey)
    if (inRange.length === 0) return
    const entryIds = inRange.map((e) => e.id)
    // Snapshot existing aggregate to restore on failure (avoid stuck-stale).
    const existing = await di.storage.getAggregate(scope, dateKey)
    // 新鲜即跳过：scope 切换/挂载不再每次打付费 LLM；processEntry 先置 stale 再触发，真过期仍重算。
    if (existing && !existing.stale) return
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
      const ag = await di.llm.aggregate(entryIds, scope, existing?.id)
      await di.storage.saveAggregate(ag)
      set((s) => {
        // Replace any existing aggregate for this scope+range, else prepend.
        const rest = s.aggregates.filter(
          (a) => !(a.scope.type === scope && a.scope.range === dateKey),
        )
        return { aggregates: [ag, ...rest] }
      })
    } catch (e) {
      // 聚合失败只伤 AI 层——条目已分类落库，存储不受影响。
      // 恢复 existing 的 stale 状态（避免卡在「重新生成中」）。
      console.error('[store] recomputeAggregate failed', e)
      if (existing) {
        const restored: Aggregate = { ...existing, stale: prevStale }
        await di.storage.saveAggregate(restored)
        set((s) => ({
          aggregates: s.aggregates.map((a) => (a.id === existing.id ? restored : a)),
        }))
      }
    }
  },
}))
