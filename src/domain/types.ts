// Domain models — pure TS, zero I/O, framework-agnostic (PRD §7.3).
// erasableSyntaxOnly is on: no enums/namespaces/param-props. Use unions + `as const`.

export type PartType = 'text' | 'audio' | 'video'

export interface TextPart {
  type: 'text'
  content: string
}

export interface AudioPart {
  type: 'audio'
  ref: string // OPFS blob ref (mock: placeholder)
  durationSec: number
  transcript?: string
  // D5: capture-time MIME (e.g. 'audio/webm'). OPFS files are stored under an
  // extension-less ref → getFile().type==="" on read-back, so the blob loses its
  // type. Carrying mime on the part lets export derive the right extension without
  // relying on OPFS filename→type inference. Absent on pre-D5 parts (→ fallback).
  mime?: string
}

export interface VideoPart {
  type: 'video'
  ref: string
  durationSec: number
  transcript?: string
  // D5: capture-time MIME (see AudioPart.mime). 'image/jpeg' for photos.
  mime?: string
}

export type EntryPart = TextPart | AudioPart | VideoPart

export type EntryStatus =
  | 'idle'
  | 'processing' // AI 处理中
  | 'ready' // AI 已完成
  | 'failed' // AI 处理失败
  | 'offline-pending' // 离线待补跑

export interface Facets {
  mood?: string
  person?: string[]
  place?: string
  project?: string
  event?: string
}

export interface GeoPoint {
  lat: number
  lng: number
  label?: string // 反查地点名（可选；LLM/后置填）
}

export interface Entry {
  id: string
  createdAt: string // ISO
  updatedAt: string // ISO
  parts: EntryPart[]
  moodSelf?: string // 可选用户自标情绪侧面
  location?: GeoPoint // 记录地点（settings.recordLocation 开时，采集时取一次）
  status: EntryStatus
  aiId?: string // 指向当前 EntryAi
  // Wave 4: 30-day trash (soft delete). Set to ISO timestamp when trashed; absent = active.
  // listEntries filters these out; trash view surfaces them; hydrate purges >30d hard.
  // Kept separate from EntryStatus (AI-processing state) so recover = clear field, no
  // need to remember pre-delete status.
  deletedAt?: string
}

export interface EntryAi {
  id: string
  entryId: string
  version: number
  category: string // category slug
  tags: string[] // tag slugs
  facets: Facets
  titleSuggestion?: string
  summary?: string
  // LLM-detected time-based reminder intent (B4). dueAt is absolute ISO 8601;
  // label is a short summary the user can edit in TodoConfirm (B6).
  // The suggestion is NOT a scheduled Reminder — user must confirm to create one (B5).
  reminderSuggestion?: { dueAt: string; label: string }
  modelUsed: string
  createdAt: string
}

export type ReminderStatus = 'pending' | 'fired' | 'snoozed' | 'missed'

export interface Reminder {
  id: string
  entryId: string // links back to the Entry that gave rise to this reminder
  dueAt: string // ISO 8601 absolute timestamp (LLM-parsed, Q2)
  label: string // short description shown in notification + settings sheet
  status: ReminderStatus
  createdAt: string // ISO
}

export interface Category {
  slug: string
  label: string
  aliases: string[]
  usageCount: number
  accent?: 'catIdea' | 'catProject' | 'catPending' | 'catFail'
  createdAt: string
}

export interface Tag {
  slug: string
  label: string
  usageCount: number
  createdAt: string
}

export type AggregateScopeType = 'day' | 'week' | 'month'

export interface Aggregate {
  id: string
  scope: { type: AggregateScopeType; range: string } // range: '2026-07-15' / '2026-W28' / '2026-07'
  summary: string
  highlights?: string[] // optional LLM-highlighted key items
  entryIds: string[]
  modelUsed: string
  createdAt: string
  stale: boolean
  // Wave 3: detail level the digest was generated at (1-5). Absent on pre-Wave3
  // rows → treated as 3 (standard). Changing settings.aggregateDetailLevel marks
  // existing aggregates stale so recompute regenerates at the new verbosity.
  detailLevel?: number
}

// Wave 4: multi-row persistent capture drafts. Lets a user pause multiple in-progress
// entries and resume any later from the drafts view. title is UI-only (not on Entry).
// Wave 3 used single-row key=1; v5 upgrade clears stale rows (dev data, acceptable loss).
export interface Draft {
  id: string
  parts: EntryPart[]
  title?: string
  location?: GeoPoint
  createdAt: string
  updatedAt: string
}

export interface Settings {
  llmProvider: string
  apiKeyRef?: string
  llmUrl?: string // BYOK endpoint (OpenAI-compatible chat completions)
  llmModel?: string // e.g. 'deepseek-v4-flash'
  sttProvider: string
  sttModel?: string // e.g. 'paraformer-realtime-v2' (DashScope realtime WS, BYOK)
  sttKeyRef?: string // 'stt:key' when a key is set in SecretStorePort
  recordLocation: boolean
  dailyReminder: boolean
  theme: 'light' | 'dark' | 'system'
  // A2: 首次运行 onboarding gating。onboarding 完成 → true；absent/undefined 视为未完成（存量用户首次也会见一次 onboarding，符合引入 gating 的预期）。
  onboarded?: boolean
  // Wave 3: aggregate digest verbosity (1-5, default 3). Stored on Aggregate so
  // changing this marks existing digests stale → recompute at new verbosity.
  aggregateDetailLevel: 1 | 2 | 3 | 4 | 5
}
