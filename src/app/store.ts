import { create } from 'zustand'
import type { Entry, EntryPart } from '@/domain/types'
import { seedEntries } from '@/data/seed'

// 视图状态 / 采集草稿（PRD §7.3 应用层）。UI 层阶段：本地状态足够撑原型变体。
interface CaptureDraft {
  parts: EntryPart[]
  recording: boolean
  saving: boolean
  micDenied: boolean
}

interface UiState {
  capture: CaptureDraft
  online: boolean
  entries: Entry[] // 运行期条目（含采集刚落库的处理中卡片）
  justSaved: boolean // 刚保存 → 首页 toast + 置顶处理中卡片
  startRecording: () => void
  stopRecording: () => void
  beginSave: () => void
  finishSave: () => void
  denyMic: () => void
  allowMic: () => void
  addPart: (p: EntryPart) => void
  clearDraft: () => void
  clearJustSaved: () => void
  setOnline: (v: boolean) => void
}

const emptyDraft: CaptureDraft = { parts: [], recording: false, saving: false, micDenied: false }

// 稳定递增的本地 id（不依赖 Date.now()/crypto，适配受限沙箱）
let localSeq = 0
function newLocalId(): string {
  localSeq += 1
  return `local-${localSeq}`
}

export const useUiStore = create<UiState>((set) => ({
  capture: emptyDraft,
  online: true,
  entries: seedEntries,
  justSaved: false,
  startRecording: () => set((s) => ({ capture: { ...s.capture, recording: true } })),
  stopRecording: () => set((s) => ({ capture: { ...s.capture, recording: false } })),
  beginSave: () => set((s) => ({ capture: { ...s.capture, recording: false, saving: true } })),
  finishSave: () =>
    set((s) => {
      // 采集→落库：把草稿 parts 包成 processing 条目置顶，置 justSaved 让首页弹 toast。
      const parts = s.capture.parts
      if (parts.length === 0) return { capture: emptyDraft, justSaved: false }
      const now = new Date().toISOString()
      const entry: Entry = {
        id: newLocalId(),
        createdAt: now,
        updatedAt: now,
        status: 'processing',
        parts,
      }
      return {
        capture: emptyDraft,
        entries: [entry, ...s.entries],
        justSaved: true,
      }
    }),
  denyMic: () => set((s) => ({ capture: { ...s.capture, micDenied: true, recording: false } })),
  allowMic: () => set((s) => ({ capture: { ...s.capture, micDenied: false } })),
  addPart: (p) => set((s) => ({ capture: { ...s.capture, parts: [...s.capture.parts, p] } })),
  clearDraft: () => set({ capture: emptyDraft }),
  clearJustSaved: () => set({ justSaved: false }),
  setOnline: (v) => set({ online: v }),
}))
