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
}

export interface VideoPart {
  type: 'video'
  ref: string
  durationSec: number
  transcript?: string
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

export interface Entry {
  id: string
  createdAt: string // ISO
  updatedAt: string // ISO
  parts: EntryPart[]
  moodSelf?: string // 可选用户自标情绪侧面
  status: EntryStatus
  aiId?: string // 指向当前 EntryAi
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
}
