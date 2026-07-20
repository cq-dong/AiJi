// Domain models — pure TS, zero I/O, framework-agnostic (PRD §7.3).
// erasableSyntaxOnly is on: no enums/namespaces/param-props. Use unions + `as const`.

export type PartType = 'text' | 'audio' | 'video'

// D7: media type annotation for LLM prompt chunking. Distinguishes photos
// (VideoPart durationSec=0) from videos, and labels source modality so the
// LLM can chunk "以下图片内容：" / "以下语音转文字：" etc. Optional on all parts;
// absent on pre-D7 parts → consumers infer from `type` (+ durationSec for photo).
export type MediaType = 'text' | 'image' | 'video' | 'audio'

export interface TextPart {
  type: 'text'
  content: string
  mediaType?: MediaType
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
  mediaType?: MediaType
}

export interface VideoPart {
  type: 'video'
  ref: string
  durationSec: number
  transcript?: string
  // D5: capture-time MIME (see AudioPart.mime). 'image/jpeg' for photos.
  mime?: string
  mediaType?: MediaType
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
  // D5: reverse-geocoded human-readable address (e.g. "北京市朝阳区望京街道").
  // Async-filled after capture (enrichLocation); absent when offline/timeout →
  // UI falls back to label ?? lat/lng. Separate from `label` (LLM-filled) to
  // avoid clobbering user-curated labels on re-geocode.
  address?: string
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
  // D25: 最近一次 AI 处理失败的具体原因（processEntry catch 块写入，成功时清空）。
  // 让 FailedBody 显示可操作信息（如「LLM BYOK 未配置」「内容为空」），而非泛泛「网络异常」，
  // 用户能据此判断是去配 key、补转写文本，还是单纯重试。
  processError?: string
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
  // 用户已对"是否建待办"做出选择（创建或忽略）→ 持久旗标，detail 不再重复弹三按钮卡。
  // 仅 local state 会在屏卸载/重进时重置导致重现；此字段随 EntryAi 落 Dexie。
  todoDismissed?: boolean
  // D21: VLM 对条目内图片/视频的完整理解文本（分类同一次多模态调用返回，省一次 VLM 请求）。
  // images=照片理解、videos=视频理解，分开存以便摘要末尾分别标注。仅当 classify 走视觉
  // （images.length>0）且 LLM 返回了该字段时填；无图/纯文本条目省略。
  mediaDescription?: { images?: string; videos?: string }
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
  // Multimodal + universal BYOK (2026-07-17). STT dual-mode: 'stream'=DashScope
  // WS paraformer (works on public DashScope where REST is CORS/404-dead);
  // 'whisper'=OpenAI-compatible REST /audio/transcriptions (PI / OpenAI / Groq).
  // sttUrl: stream→DashScope WS base; whisper→OpenAI REST base (e.g. PI /compatible-mode/v1).
  sttMode: 'stream' | 'whisper'
  sttUrl?: string
  // Vision: classify 附图/视频帧总开关（默认 true）；videoFrameIntervalSec=视频抽帧间隔（默认 10s）。
  videoVisionEnabled: boolean
  videoFrameIntervalSec: number
  // 独立 VLM（vision-language model）走多模态 classify，文本 classify 仍走主 LLM（DeepSeek）。
  // 典型：vlmModel=qwen3.5-flash on Aliyun PI。vlmKeyRef='vlm:key' → SecretStorePort。
  // 未配（undefined）→ 含图条目 classify 回落主 LLM（若主 LLM 不支持 image_url 则 §5.2 降级纯文本）。
  vlmProvider: string
  vlmUrl?: string
  vlmModel?: string
  vlmKeyRef?: string
  // D24: 反向地理编码 BYOK Key（高德 web 服务）。未配 → 回落 Nominatim（OSM，国内网络常超时/不可达，
  // 此时地址显示退化为坐标）。配了高德 Key → 国内地址解析稳定可靠。Key 存 SecretStorePort('geocoding:key')。
  geocodingKeyRef?: string
}

// ── AI Chat · 纯读检索 (docs/design/ai-chat-impl-plan.md) ───────────────────
// MVP: 单会话（conversations 表 id=1 单行），messages 内嵌数组。多会话 schema 预留，v1.1 再用。

// LLM intent 轮解析问句→结构化 query。scope 为时间约束（null=不限时间）；
// keywords 用于本地 substring 召回；categorySlugs 可选过滤。LLM 不参与检索，只解析意图。
export interface ChatQuery {
  scope: { type: AggregateScopeType; range: string } | null
  keywords: string[]
  categorySlugs?: string[]
}

// 压缩传给 answer LLM 的召回条目（token 预算：top-8 × ≤120 字 excerpt ≈ 3-4K input）。
export interface ChatCite {
  id: string
  createdAt: string
  categorySlug: string
  tags: string[]
  summary?: string
  textExcerpt: string
  place?: string // entry.location.address 或 facets.place，让 answer LLM 能答地点相关问题
}

export type ChatMessageRole = 'user' | 'assistant'

// 用户消息只存 content；AI 消息存 content + citedEntryIds（后校验剔非法后的子集）。
// error 非空时 content 是失败文案、citedEntryIds 空。
export interface ChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  citedEntryIds?: string[]
  createdAt: string
  error?: boolean
}

// MVP 单会话：固定 id=1。多会话时改 schema + listConversations，UI 不动。
export interface Conversation {
  id: string
  messages: ChatMessage[]
  updatedAt: string
}

// LLM answer 轮返回。citedEntryIds 必须来自传入 cites 的 id 集——port 层后校验剔非法。
export interface ChatAnswer {
  answer: string
  citedEntryIds: string[]
}

// 使用反馈（settings → /feedback）。一次提交多条建议，每条 = 可选图片 + 文字。
// images 是 UI 已压缩的 Blob（≤1600px / JPEG 0.8）；适配器负责传图 + 建 Issue。
// 见 docs/superpowers/specs/2026-07-19-feedback-feature-design.md。
export interface FeedbackItem {
  text: string
  images: Blob[]
}
