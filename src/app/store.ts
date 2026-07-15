import { create } from 'zustand'
import type { EntryPart } from '@/domain/types'

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
  startRecording: () => void
  stopRecording: () => void
  beginSave: () => void
  finishSave: () => void
  denyMic: () => void
  allowMic: () => void
  addPart: (p: EntryPart) => void
  clearDraft: () => void
  setOnline: (v: boolean) => void
}

const emptyDraft: CaptureDraft = { parts: [], recording: false, saving: false, micDenied: false }

export const useUiStore = create<UiState>((set) => ({
  capture: emptyDraft,
  online: true,
  startRecording: () => set((s) => ({ capture: { ...s.capture, recording: true } })),
  stopRecording: () => set((s) => ({ capture: { ...s.capture, recording: false } })),
  beginSave: () => set((s) => ({ capture: { ...s.capture, recording: false, saving: true } })),
  finishSave: () => set({ capture: emptyDraft }),
  denyMic: () => set((s) => ({ capture: { ...s.capture, micDenied: true, recording: false } })),
  allowMic: () => set((s) => ({ capture: { ...s.capture, micDenied: false } })),
  addPart: (p) => set((s) => ({ capture: { ...s.capture, parts: [...s.capture.parts, p] } })),
  clearDraft: () => set({ capture: emptyDraft }),
  setOnline: (v) => set({ online: v }),
}))
