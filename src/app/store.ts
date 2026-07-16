import { create } from 'zustand'
import type { Category, Entry, EntryAi, EntryPart, Settings, Tag } from '@/domain/types'
import { seedCategories, seedEntries, seedEntryAi, seedSettings, seedTags } from '@/data/seed'
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
}

const emptyDraft: CaptureDraft = { parts: [], recording: false, saving: false, micDenied: false, finalized: '', interim: '' }

export const useUiStore = create<UiState>((set, get) => ({
  capture: emptyDraft,
  online: true,
  entries: seedEntries,
  aiByEntry: Object.fromEntries(seedEntryAi.map((a) => [a.entryId, a])),
  categories: seedCategories,
  tags: seedTags,
  hydrated: false,
  settings: seedSettings,
  justSaved: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const [entries, settings, categories, tags] = await Promise.all([
        di.storage.listEntries(),
        di.storage.getSettings(),
        di.storage.listCategories(),
        di.storage.listTags(),
      ])
      // 载入每条条目的 AI（seed 条目 + 真实保存条目）。getEntryAi 返回最高 version。
      const aiPairs = await Promise.all(
        entries.map((e) => di.storage.getEntryAi(e.id).then((ai) => (ai ? [e.id, ai] as const : null))),
      )
      const aiByEntry = { ...Object.fromEntries(aiPairs.filter(Boolean) as [string, EntryAi][]) }
      set({ entries, settings, categories, tags, aiByEntry, hydrated: true })
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
}))
