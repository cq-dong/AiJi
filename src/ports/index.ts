// Port interfaces (PRD §7.3). PWA-agnostic; adapters implement these.
// UI 层阶段：mock 适配器返回原型样例数据，真实采集/STT/LLM 后续接入。

import type { Aggregate, AggregateScopeType, Category, Draft, Entry, EntryAi, GeoPoint, Reminder, Settings, Tag } from '@/domain/types'

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
  // Category/entry deletion (Wave 1 core). deleteCategory only drops the row —
  // the store action re-maps affected entries' AI category to '' (未分类) first.
  deleteCategory(slug: string): Promise<void>
  deleteEntry(id: string): Promise<void>
  // Capture draft (Wave 3): single-row at key=1. saveDraft persists mid-entry
  // parts/title/location so a refresh or app restart can resume. clearDraft on save.
  saveDraft(d: Draft): Promise<void>
  loadDraft(): Promise<Draft | undefined>
  clearDraft(): Promise<void>
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
  // Geolocation for recordLocation setting (Wave 1 core). Null if denied/unsupported.
  getLocation(): Promise<GeoPoint | null>

  // ── Camera + gallery (Wave 2 capture redesign). Photo/video share the 'video'
  // EntryPart (no 'photo' PartType): photos are a video part with durationSec=0.
  // The adapter owns the MediaStream; the screen passes a <video> for live preview.
  /** Open the camera. Attaches the live stream to `preview` (if given). Returns false if denied/unsupported. */
  startCamera(opts: { preview?: HTMLVideoElement; facingMode?: 'user' | 'environment'; withAudio?: boolean }): Promise<boolean>
  /** Grab a single still frame from the active camera stream. Null if no active camera. */
  capturePhoto(): Promise<{ ref: string; blob: Blob } | null>
  /** Begin recording video (+audio) from the active camera stream. */
  startVideo(): Promise<void>
  /** Stop recording; returns blob + ref + duration. Null if nothing was recording. */
  stopVideo(): Promise<{ ref: string; blob: Blob; durationSec: number } | null>
  /** Stop the camera, release tracks, detach preview. Safe to call when not running. */
  stopCamera(): Promise<void>
  /** Open the system file picker (image/video). Returns null when the user cancels. */
  pickMedia(): Promise<{ ref: string; blob: Blob; kind: 'image' | 'video'; durationSec: number } | null>
}

export interface SttPort {
  transcribe(ref: string): Promise<string>
}

export interface LlmPort {
  classify(entryId: string): Promise<EntryAi>
  // range = the period key the store wants this digest scoped to ('2026-07-16' / '2026-W28' / '2026-07').
  // Adapter must use it verbatim — NOT recompute from today（过去周期重算会用错 range 覆盖，1b 根因之一）。
  // detailLevel (1-5, default 3) controls digest verbosity; stored on the Aggregate so
  // changing settings.aggregateDetailLevel marks existing digests stale → recompute.
  aggregate(
    entryIds: string[],
    scope: AggregateScopeType,
    range: string,
    detailLevel?: number,
    id?: string,
  ): Promise<Aggregate>
}

export interface SecretStorePort {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}
