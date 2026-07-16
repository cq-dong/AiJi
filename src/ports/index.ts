// Port interfaces (PRD §7.3). PWA-agnostic; adapters implement these.
// UI 层阶段：mock 适配器返回原型样例数据，真实采集/STT/LLM 后续接入。

import type { Aggregate, AggregateScopeType, Category, Entry, EntryAi, Reminder, Settings, Tag } from '@/domain/types'

export interface StoragePort {
  listEntries(): Promise<Entry[]>
  getEntry(id: string): Promise<Entry | undefined>
  saveEntry(entry: Entry): Promise<void>
  getEntryAi(entryId: string): Promise<EntryAi | undefined>
  saveEntryAi(ai: EntryAi): Promise<void>
  listCategories(): Promise<Category[]>
  saveCategory(cat: Category): Promise<void>
  listTags(): Promise<Tag[]>
  saveTag(tag: Tag): Promise<void>
  listAggregates(): Promise<Aggregate[]>
  getAggregate(scope: AggregateScopeType, range: string): Promise<Aggregate | undefined>
  saveAggregate(ag: Aggregate): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  // Media blobs (audio/video) persist to OPFS (PRD §7.2 媒体后置→A2)。ref = EntryPart.ref.
  // saveMedia: persist (or overwrite) a blob. getMedia: read back; undefined if absent or OPFS unsupported.
  saveMedia(ref: string, blob: Blob): Promise<void>
  getMedia(ref: string): Promise<Blob | undefined>
  // Reminders (Phase 9 Batch 2b). foreground-only (Q1), dueAt is absolute ISO (Q2).
  listReminders(): Promise<Reminder[]>
  getReminder(id: string): Promise<Reminder | undefined>
  saveReminder(r: Reminder): Promise<void>
  deleteReminder(id: string): Promise<void>
}

export interface CapturePort {
  // onInterim: partial transcript (overwrites prior interim). onFinal: a finalized
  // segment (appends). WebSpeech live preview; Whisper final-quality STT is SttPort (deferred).
  startAudio(opts: { onInterim?: (text: string) => void; onFinal?: (text: string) => void }): Promise<void>
  // Returns the recorded blob so the store can persist it (StoragePort.saveMedia).
  // blob undefined when MediaRecorder unsupported (degrades to transcript-only).
  stopAudio(): Promise<{ ref: string; durationSec: number; blob?: Blob }>
  hasMicPermission(): Promise<boolean>
  requestMicPermission(): Promise<boolean>
}

export interface SttPort {
  transcribe(ref: string): Promise<string>
}

export interface LlmPort {
  classify(entryId: string): Promise<EntryAi>
  aggregate(entryIds: string[], scope: AggregateScopeType, id?: string): Promise<Aggregate>
}

export interface SecretStorePort {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}
