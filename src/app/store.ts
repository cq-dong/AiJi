import { create } from 'zustand'
import type { Entry, EntryPart, Settings } from '@/domain/types'
import { seedEntries, seedSettings } from '@/data/seed'
import { di } from './di'

// 视图状态 / 采集草稿（PRD §7.3 应用层）。entries 走 DexieStorage：首屏 seed 兜底即时渲染，
// hydrate() 异步从 Dexie 载入真实条目（含历史保存）替换；finishSave 同时落库。
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
}

const emptyDraft: CaptureDraft = { parts: [], recording: false, saving: false, micDenied: false, finalized: '', interim: '' }

export const useUiStore = create<UiState>((set, get) => ({
  capture: emptyDraft,
  online: true,
  entries: seedEntries,
  hydrated: false,
  settings: seedSettings,
  justSaved: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const [entries, settings] = await Promise.all([
        di.storage.listEntries(),
        di.storage.getSettings(),
      ])
      set({ entries, settings, hydrated: true })
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
}))
