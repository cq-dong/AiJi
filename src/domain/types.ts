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
  modelUsed: string
  createdAt: string
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
  recordLocation: boolean
  dailyReminder: boolean
  theme: 'light' | 'dark' | 'system'
}
