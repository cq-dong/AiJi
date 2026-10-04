// Port interfaces (PRD §7.3). PWA-agnostic; adapters implement these.
// UI 层阶段：mock 适配器返回原型样例数据，真实采集/STT/LLM 后续接入。

import type { Aggregate, AggregateScopeType, Category, ChatAnswer, ChatCite, ChatQuery, Conversation, Draft, Entry, EntryAi, FeedbackItem, GeoPoint, Memory, MemoryVerdict, Reminder, Settings, Tag } from '@/domain/types'
import type { Account, AuthSession } from '@/domain/account'
import type { Quota } from '@/domain/quota'
import type { PlanTier } from '@/domain/plan'

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
  // Media blobs (audio/video) persist to OPFS (PRD §7.2 媒体后置→A2)。ref = EntryPart.ref。
  // saveMedia: persist (or overwrite) a blob. getMedia: read back; undefined if absent or OPFS unsupported。
  // deleteMedia (D5): hard-delete paths (trash 永久删除 + 30 天 purge) 调用，清 OPFS blob 免配额累积。
  saveMedia(ref: string, blob: Blob): Promise<void>
  getMedia(ref: string): Promise<Blob | undefined>
  deleteMedia(ref: string): Promise<void>
  // Reminders (Phase 9 Batch 2b). foreground-only (Q1), dueAt is absolute ISO (Q2).
  listReminders(): Promise<Reminder[]>
  getReminder(id: string): Promise<Reminder | undefined>
  saveReminder(r: Reminder): Promise<void>
  deleteReminder(id: string): Promise<void>
  // Category/entry deletion (Wave 1 core). deleteCategory only drops the row —
  // the store action re-maps affected entries' AI category to '' (未分类) first.
  deleteCategory(slug: string): Promise<void>
  deleteEntry(id: string): Promise<void>
  // Capture drafts (Wave 4: multi-row). saveDraft upserts by d.id (string);
  // listDrafts feeds the drafts view; getDraft(id) resumes a specific one;
  // deleteDraft(id) on discard or after the draft becomes a saved entry.
  saveDraft(d: Draft): Promise<void>
  listDrafts(): Promise<Draft[]>
  getDraft(id: string): Promise<Draft | undefined>
  deleteDraft(id: string): Promise<void>
  // 30-day trash (Wave 4). trashEntry soft-deletes (sets deletedAt); recoverEntry
  // clears it; listTrashed surfaces recoverable entries; purgeExpired hard-deletes
  // entries whose deletedAt is older than 30 days (cascades entryAi + reminders).
  // deleteEntry (above) stays a hard, immediate delete — trash "删除 forever" + purge use it.
  listTrashed(): Promise<Entry[]>
  trashEntry(id: string): Promise<void>
  recoverEntry(id: string): Promise<void>
  purgeExpired(): Promise<number>
  // AI Chat · conversations (docs/design/ai-chat-impl-plan.md §3)。MVP 单会话 id=1；
  // 多会话 schema 已就位，v1.1 铺 listConversations UI。getConversation 载入、
  // saveConversation upsert（messages 内嵌数组整体覆写）、deleteConversation 清会话。
  listConversations(): Promise<Conversation[]>
  getConversation(id: string): Promise<Conversation | undefined>
  saveConversation(c: Conversation): Promise<void>
  deleteConversation(id: string): Promise<void>
  // 账号分区 · 收养 local 数据（Slice B）。login/register 成功后调用：把 6 张分区表里
  // ownerId==='local' 的行改盖为 accountId，未登录期间记的数据归属首次登录的网络账号。
  // 单用户手机语义；多用户共用设备不在本期。entryAi/drafts/settings 不参与。
  adoptLocal(accountId: string): Promise<void>
  // AI 记忆（2026-07-22）：用户明确记忆/偏好。分区语义同 reminders——list 按 currentOwner
  // 过滤、save 强制盖章、delete 先 get 验 owner。classify 与 answerChat 注入 prompt。
  listMemories(): Promise<Memory[]>
  saveMemory(m: Memory): Promise<void>
  deleteMemory(id: string): Promise<void>
}

export interface CapturePort {
  // onInterim: partial transcript (overwrites prior interim). onFinal: a finalized
  // segment (appends). WebSpeech live preview; Whisper final-quality STT is SttPort (deferred).
  startAudio(opts: { onInterim?: (text: string) => void; onFinal?: (text: string) => void }): Promise<void>
  // Returns the recorded blob so the store can persist it (StoragePort.saveMedia).
  // blob undefined when MediaRecorder unsupported (degrades to transcript-only).
  stopAudio(): Promise<{ ref: string; durationSec: number; blob?: Blob; mime: string }>
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
  capturePhoto(): Promise<{ ref: string; blob: Blob; mime: string } | null>
  /** Begin recording video (+audio) from the active camera stream. */
  startVideo(): Promise<void>
  /** Stop recording; returns blob + ref + duration. Null if nothing was recording. */
  stopVideo(): Promise<{ ref: string; blob: Blob; durationSec: number; mime: string } | null>
  /** Stop the camera, release tracks, detach preview. Safe to call when not running. */
  stopCamera(): Promise<void>
  /** Open the system file picker (image/video). Returns null when the user cancels. */
  pickMedia(): Promise<{ ref: string; blob: Blob; kind: 'image' | 'video'; durationSec: number; mime: string } | null>
}

export interface SttPort {
  transcribe(ref: string): Promise<string>
}

// 流式增量事件（2026-09-28 问 AI 流式输出）：reasoning = 思考模型推理片段（UI「思考过程」
// 折叠块实时渲染）；content = answer 正文 JSON 封包原始片段（经 extractPartialAnswer
// 提取可见文本渲染）。BYOK/builtin 两条链路共用此契约。
export type ChatStreamEvent = { type: 'reasoning' | 'content'; delta: string }

// P-D 主动触达 context（2026-10-03）：store 按可得性拼装，**不瞎编**——openLoops 是
// enabled 未归档记忆原文（≤5 截断），LLM 自判相关性；daysSinceLastEntry null = 从未记过。
export interface ProactiveGreetingContext {
  daypart: 'morning' | 'afternoon' | 'evening' | 'night'
  recentEntryCount7d: number
  daysSinceLastEntry: number | null
  openLoops: string[]
  rollingSummary?: string
  dueReminderCount: number
  // P-F ① 往日回响（2026-10-04）：历年同月日的最近一条回忆（无则 undefined，不瞎编）。
  // yearsAgo=距今年数（≥1）；excerpt=标题或文本首行截 60 字，问候可作承接线索。
  onThisDay?: { yearsAgo: number; excerpt: string }
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
  // AI Chat (docs/design/ai-chat-impl-plan.md)。两轮：intent 解析问句→结构化 query；
  // answer 基于本地召回的 cites 作答 + 引用。调用方在两轮之间跑 localRecall。
  // intent 轮：解析「上个月关于 X 的想法」→ scope(时间 range) + keywords。无时间意图时 scope=null。
  // categories（2026-09-29 能力大补，可选）：现有类别列表注入 intent prompt，
  // 提高 action 分支 categorySlug 命中率（不传=旧行为，LLM 只给 categoryLabel）。
  parseChatIntent(
    question: string,
    nowIso: string,
    categories?: { slug: string; label: string }[],
  ): Promise<ChatQuery>
  // answer 轮：基于传入 cites（已压缩）+ 对话历史作答。铁律：citedEntryIds 必须来自 cites.id；
  // port 层后校验剔非法 id。空 cites 调用方应直接走「库内未找到依据」不调此方法。
  // onEvent（2026-09-28 流式输出）：传入时适配器走流式链路，逐帧回调 reasoning/content 增量；
  // 省略 = 旧非流式行为（向后兼容，intent/extractMemory 等调用不动）。返回值不变——
  // 流式结束仍产完整 ChatAnswer（落库/缓存收口不变）；断流有部分内容时宽容返回部分答案。
  // conversation[].date（2026-09-29）：每条历史的本地日键（YYYY-MM-DD），prompt 渲染为
  // [日期] 前缀，LLM 可解析「昨天说的」等跨天指代。
  // extraSystem（2026-09-29 能力大补）：store 侧拼好的附加 system 段——当前时间行（timeIntent）/
  // 天气数据块 / 搜索结果块，拼在 memoryBlock 之后。一个口子覆盖所有注入，prompt 本体零改动。
  answerChat(opts: {
    question: string
    cites: ChatCite[] // 已压缩的 top-K 召回条目（LLM 作答的上下文素材）
    conversation: { role: 'user' | 'assistant'; content: string; date?: string }[] // 先前多轮对话
    extraSystem?: string
  }, onEvent?: (ev: ChatStreamEvent) => void): Promise<ChatAnswer>
  // AI 记忆自动提取（2026-07-22 §4；2026-09-10 陪伴化扩展）：从用户一句话提取应长期记住的
  // 事实/偏好/归类指令/进行中事项。返一句精炼记忆原文；无可记内容（普通提问）返 null。
  // store.sendMessage 每轮回答成功后调用（settings.autoMemory===false 时仅显式「记住 X」意图调）。
  // knownMemories = 现有 enabled 记忆原文（去重：已覆盖的信息应返 NULL，避免逐轮重复累积）。
  // 失败静默（不影响主问答）。
  extractMemory(text: string, knownMemories?: string[]): Promise<string | null>
  // 文本向量化（2026-10-03 P-B 语义召回，可选方法）：适配器不实现（undefined）= 该链路
  // 无 embedding 能力（builtin 老服务端无端点）——调用方 di.llm.embed?.(...) ?? null 兜底，
  // 静默降级纯关键词召回。返回 null 同上语义。抛错 = 调用失败（网络/key），调用方 catch
  // 后同样降级。**任何失败都不允许影响问答主流程。** BYOK：POST {baseUrl}/embeddings，
  // model 读 settings.embeddingModel（缺省 text-embedding-3-small）。
  embed?(texts: string[]): Promise<number[][] | null>
  // 滚动对话摘要（2026-10-03 P-B，必需方法）：把对话片段压缩成第三人称摘要，prior 为
  // 已有摘要（并入输出合并后的新摘要）。保留事实/约定/进行中事项/用户偏好与状态，丢弃
  // 寒暄。max_tokens ~300 / temperature 0。失败抛错由调用方吞掉（摘要失败不影响问答）。
  summarizeConversation(
    prior: string | null,
    chunk: { role: 'user' | 'assistant'; content: string; date?: string }[],
  ): Promise<string>
  // P-C 记忆冲突裁决（2026-10-03，必需方法）：向量初筛命中相似记忆后，LLM 判新记忆
  // 与 ≤3 条相似旧记忆的关系，输出四选一 MemoryVerdict。JSON 白名单解析；oldId 必须
  // 来自 similar[].id（调用方后校验）。**仅相似命中时调用**（无命中直接 ADD，省一轮 LLM）。
  // 抛错/JSON 坏 = 裁决失败，调用方兜底默认 ADD（宁可多存不丢信息）。
  adjudicateMemory(
    newMemory: string,
    similar: { id: string; content: string }[],
  ): Promise<MemoryVerdict>
  // P-D 主动触达（2026-10-03，必需方法）：开屏问候——以伙伴人格写一句主动问候
  // （≤40 字，最多一个问题），无可承接的具体线索返 null（调用方走模板兜底卡）。
  // 不编造 context 里没有的事。max_tokens ~80 / temperature 0.7。抛错 = 调用失败，
  // 调用方同样兜底模板卡 + console.warn。触发/频控/当日缓存全在调用方（home mount、
  // 6h、date+daypart），端口无状态。
  proactiveGreeting(context: ProactiveGreetingContext): Promise<string | null>
  // Connectivity probe：tiniest chat ping（max_tokens:1）。设置页连通性测试用。
  // opts 传入时直接用表单值（url/model/key），不读 Dexie/secrets——测未保存的新配置；
  // 省略时回落 settings + secrets（测已落库配置）。key 为空串视为省略（回落已存 key）。
  // 返回 ok + latencyMs；失败返 error（url/key 缺失 / HTTP 错 / 网络抛）。
  ping(opts?: { url?: string; model?: string; key?: string }): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
}

export interface SecretStorePort {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  // D8: 清空 BYOK key 时删 localStorage 行——否则旧 key 残留、UI 仍显「已配置」。
  delete(key: string): Promise<void>
}

// 应用自更新端口。PWA / Android 双实现：
// - checkForUpdate：fetch GitHub Releases API（公开仓带 CORS，WebView 直连）+ semver 比较。
//   latest = release tag_name 去 v 前缀；apkUrl = .apk 资产直链；releaseNotes = body。
// - downloadAndInstall：Android 走原生插件（HttpURLConnection 下载→FileProvider→系统安装器，
//   绕过 assets.githubusercontent.com 的 CORS）；PWA 回退 window.open(releaseUrl)。
//   onProgress 回调仅 Android 实现：原生插件 notifyListeners("downloadProgress") →
//   适配器转发；PWA 无下载概念（跳浏览器），onProgress 签名存在但被忽略以保持接口一致。
//   percent = -1 表示服务端未返回 Content-Length，UI 仅显示已下载字节数无百分比。
// current = 构建时烘焙的 __APP_VERSION__（package.json version 单一真源）。
export interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
  // Android: release 资产里 .apk 的 browser_download_url（原生插件用 HttpURLConnection 拉）。
  apkUrl?: string
  // PWA fallback: GitHub release 页（window.open）。
  releaseUrl?: string
  releaseNotes?: string
  // 最新 release 是否 prerelease（About sheet 可据此提示「预发布版，非正式」）。
  prerelease?: boolean
}

// 下载进度载荷。received=已下载字节；total=总字节（-1=未知）；percent=0-100（-1=未知）。
export interface DownloadProgress {
  received: number
  total: number
  percent: number
}

export interface AppUpdatePort {
  checkForUpdate(): Promise<UpdateInfo>
  downloadAndInstall(info: UpdateInfo, onProgress?: (p: DownloadProgress) => void): Promise<void>
}

// D4 · 本地提醒通知端口。替代旧 setTimeout-only 前台调度（app 后台/被杀即失效）。
// 原生走 @capacitor/local-notifications（系统级铃声+弹窗，后台/锁屏可触发）；
// web 走浏览器 Notification API（前台 only，best-effort）。
// schedule 预约未来通知；cancel 取消；notify 即时推（overdue 补推）。
// store 仍保留 setTimeout 做前台状态更新（标 fired/missed），本端口只负责通知展示。
export interface LocalNotificationsPort {
  requestPermission(): Promise<boolean>
  schedule(reminder: Reminder): Promise<void>
  cancel(id: string): Promise<void>
  // 即时通知（overdue 补推 / 前台即时确认）。tag 去重 id。
  notify(label: string, body: string, tag: string): void
}

// 使用反馈端口（settings → /feedback）。一次提交多条建议；适配器负责传图 +
// 建 GitHub Issue，返回 issue html_url 供 UI 展示。token/repo 内置在适配器
// （见 docs/superpowers/specs/2026-07-19-feedback-feature-design.md §2）。
export interface FeedbackPort {
  submit(items: FeedbackItem[]): Promise<{ issueUrl: string }>
}

// ── Slice B 端口 ──────────────────────────────────────────────
// 错误类：适配器抛、UI/store catch 按 name 分流。erasableSyntaxOnly 禁 class 参数属性，手写 constructor。
export class SessionExpiredError extends Error {
  // 默认消息会原样落到条目 processError（store.ts processEntry catch），须用户可读的中文。
  constructor(message = '登录已过期，请重新登录') {
    super(message)
    this.name = 'SessionExpiredError'
  }
}
export class NotNetworkError extends Error {
  constructor(message = 'builtin key requires network account') {
    super(message)
    this.name = 'NotNetworkError'
  }
}
export class QuotaExhaustedError extends Error {
  constructor(message = 'quota exhausted') {
    super(message)
    this.name = 'QuotaExhaustedError'
  }
}
export class StorageFullError extends Error {
  constructor(message = '云存储空间不足，请升级套餐') {
    super(message)
    this.name = 'StorageFullError'
  }
}

export interface AuthPort {
  register(email: string, password: string): Promise<{ account: Account; session: AuthSession }>
  login(email: string, password: string): Promise<{ account: Account; session: AuthSession }>
  refresh(): Promise<AuthSession>
  // 修改密码（网络账号）。成功后后端作废全部 refresh token → 前端清 session 重登。
  changePassword(oldPassword: string, newPassword: string): Promise<void>
  // 注销账号（二次确认密码）。成功后前端清本地全部数据。
  deleteAccount(password: string): Promise<void>
  logout(): Promise<void>
}

export interface QuotaPort {
  getQuota(): Promise<Quota>
}

export interface PlanPort {
  getPlans(): Promise<PlanTier[]>
  upgrade(planId: string): Promise<{
    orderId: string
    paidPlanId: string
    paidExpiresAt: string
    payUrl?: string
    // 后端现真落库并返 account（Phase 1 §2.4）；旧 stub 响应无此字段 → 前端回落手拼。
    account?: Account
  }>
  // 兑换码激活付费档。返更新后 account（含 plan/paidPlanId/paidExpiresAt），前端覆盖本地。
  redeem(code: string): Promise<{ account: Account }>
}
