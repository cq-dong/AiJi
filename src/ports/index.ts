// Port interfaces (PRD §7.3). PWA-agnostic; adapters implement these.
// UI 层阶段：mock 适配器返回原型样例数据，真实采集/STT/LLM 后续接入。

import type { Aggregate, Category, Entry, EntryAi, Settings, Tag } from '@/domain/types'

export interface StoragePort {
  listEntries(): Promise<Entry[]>
  getEntry(id: string): Promise<Entry | undefined>
  getEntryAi(entryId: string): Promise<EntryAi | undefined>
  listCategories(): Promise<Category[]>
  listTags(): Promise<Tag[]>
  listAggregates(): Promise<Aggregate[]>
  getSettings(): Promise<Settings>
}

export interface CapturePort {
  startAudio(): Promise<void>
  stopAudio(): Promise<{ ref: string; durationSec: number }>
  hasMicPermission(): Promise<boolean>
  requestMicPermission(): Promise<boolean>
}

export interface SttPort {
  transcribe(ref: string): Promise<string>
}

export interface LlmPort {
  classify(entryId: string): Promise<EntryAi>
}

export interface SecretStorePort {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}
