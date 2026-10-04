// P-D 主动触达 · 开屏问候编排（2026-10-03，spec: docs/superpowers/specs/2026-10-03-proactive-companion.md）。
// 纯函数 + 依赖注入（deps 参数），零 React/零 di import——home/index.tsx 负责把 di/t 接进来。
// 职责：daypart 划分、context 拼装（不瞎编）、6h 频控、当日缓存（date+daypart）、当日 dismiss、
// LLM 失败/无料 → 模板兜底。localStorage 承载非关键状态（spec §3：不进 Dexie）。

import type { Conversation, Entry, EntryAi, Memory, Reminder } from '@/domain/types'
import type { ProactiveGreetingContext } from '@/ports'

export type Daypart = ProactiveGreetingContext['daypart']

// 时段划分：早 5-11 / 下午 11-18 / 晚 18-23 / 深夜 23-5（本地时区小时）。
export function daypartOf(date: Date): Daypart {
  const h = date.getHours()
  if (h >= 5 && h < 11) return 'morning'
  if (h >= 11 && h < 18) return 'afternoon'
  if (h >= 18 && h < 23) return 'evening'
  return 'night'
}

// ── localStorage keys（aiji.pd.* 前缀）─────────────────────────────
export const PD_KEYS = {
  // 上次问候展示时刻（ISO）——距现在 <6h 不渲染任何卡（模板卡也不出，避免常驻噪音）。
  lastGreetingAt: 'aiji.pd.lastGreetingAt',
  // 当日缓存：同日同时段重复进 home 不重复调 LLM。JSON {key:'YYYY-MM-DD:daypart', text}。
  cache: 'aiji.pd.cache',
  // 当日 dismiss：'YYYY-MM-DD'，等于今天则整日不再出现。
  dismissedDate: 'aiji.pd.dismissedDate',
} as const

// 频控窗口：6 小时（spec §1.1「距上次问候 ≥ 6 小时」）。
export const GREETING_INTERVAL_MS = 6 * 3_600_000

// 本地日期键 YYYY-MM-DD（与 home/helpers localDateKey 同语义：本地年月日，非 UTC slice）。
export function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 两个本地日期键相差天数（a - b，整天粒度，忽略时分）。
function dayDiff(a: Date, b: Date): number {
  const ka = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const kb = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((ka - kb) / 86_400_000)
}

const SEVEN_DAYS_MS = 7 * 86_400_000
const OPEN_LOOPS_MAX = 5

export interface BuildContextInput {
  now: Date
  // P-F ①（2026-10-05）：元素可选带 id/parts——onThisDay（往年今日）候选提取用。
  // 纯可选：旧调用方只给 createdAt 仍合法，onThisDay 自动静默（无 id 查不了 aiById、
  // 无 parts 取不了文本/transcript 首行）。
  entries: ReadonlyArray<Pick<Entry, 'createdAt'> & Partial<Pick<Entry, 'id' | 'parts'>>>
  memories: ReadonlyArray<Pick<Memory, 'content' | 'enabled' | 'archivedAt'>>
  reminders: ReadonlyArray<Pick<Reminder, 'dueAt' | 'status'>>
  conversation?: Pick<Conversation, 'rollingSummary'> | undefined
  // P-F ①：entryId → EntryAi 快照（供 titleSuggestion 进 onThisDay excerpt）。缺省时
  // excerpt 跳过标题级，仍回退文本首行 / transcript 首行。
  aiById?: ReadonlyMap<string, Pick<EntryAi, 'titleSuggestion'>>
}

// context 拼装（spec §1.1，按可得性、不瞎编）：
// - recentEntryCount7d：createdAt 落在 [now-7d, now] 的条目数。
// - daysSinceLastEntry：最近一条距今天数（本地日期整天差）；无条目 → null（从未记过）。
// - openLoops：enabled && 未归档（!archivedAt）记忆原文，≤5 截断，LLM 自判相关性。
// - rollingSummary：updatedAt 最新会话有摘要则带（承接上次聊天；W0 修复，原死读会话 '1'）。
// - dueReminderCount：「还没响过且到点」的待办条数——status pending/snoozed（fired/missed
//   已了结不计；snoozed 的 dueAt 已被推迟，过了新到点同样算到期）且 dueAt ≤ 今天本地 23:59:59.999
//   （今天到期 + 已逾期一并计入）。
// - onThisDay（P-F ① 契约，pf-adapters 实现）：同月日（本地时区 getMonth/getDate）且
//   年份 < now 年的候选按 createdAt 降序，取第一条 excerpt 非空者 → { yearsAgo, excerpt }。
//   excerpt 三级回退：① aiById.get(id)?.titleSuggestion.trim() ② 首个 text part 的首个
//   非空行 ③ 首个 audio/video part transcript 的首个非空行；统一截 60 字。三级皆空看下一
//   候选；无候选 / 全部候选 excerpt 空 → undefined（不瞎编）。yearsAgo = now 年 − 候选年（≥1）。
export function buildContext(input: BuildContextInput): ProactiveGreetingContext {
  const { now, entries, memories, reminders, conversation } = input

  const cutoff = now.getTime() - SEVEN_DAYS_MS
  let recentEntryCount7d = 0
  let latest: Date | null = null
  for (const e of entries) {
    const t = new Date(e.createdAt).getTime()
    if (Number.isNaN(t)) continue
    if (t >= cutoff && t <= now.getTime()) recentEntryCount7d += 1
    if (latest === null || t > latest.getTime()) latest = new Date(t)
  }

  const daysSinceLastEntry = latest === null ? null : dayDiff(now, latest)

  const openLoops = memories
    .filter((m) => m.enabled && !m.archivedAt)
    .map((m) => m.content)
    .slice(0, OPEN_LOOPS_MAX)

  // 明天本地 00:00 即「今天结束」边界；dueAt 严格小于它 = 今天到期或已逾期。
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  const dueReminderCount = reminders.filter((r) => {
    if (r.status !== 'pending' && r.status !== 'snoozed') return false
    const due = new Date(r.dueAt).getTime()
    return !Number.isNaN(due) && due < endOfToday
  }).length

  const rollingSummary = conversation?.rollingSummary?.trim() ? conversation.rollingSummary : undefined

  return {
    daypart: daypartOf(now),
    recentEntryCount7d,
    daysSinceLastEntry,
    openLoops,
    rollingSummary,
    dueReminderCount,
  }
}

// ── 编排 ───────────────────────────────────────────────────────────

export type GreetingSource = 'llm' | 'cache' | 'template'
export interface GreetingResult {
  text: string
  source: GreetingSource
}

export interface ProactiveDeps {
  now: Date
  // P-F ①：返回元素带 id/parts 时 onThisDay 生效（di.storage.listEntries() 全量 Entry 天然满足）。
  listEntries: () => Promise<ReadonlyArray<Pick<Entry, 'createdAt'> & Partial<Pick<Entry, 'id' | 'parts'>>>>
  listMemories: () => Promise<ReadonlyArray<Pick<Memory, 'content' | 'enabled' | 'archivedAt'>>>
  listReminders: () => Promise<ReadonlyArray<Pick<Reminder, 'dueAt' | 'status'>>>
  getConversation: () => Promise<Pick<Conversation, 'rollingSummary'> | undefined>
  // P-F ①（可选）：entryId → EntryAi 快照，供 onThisDay excerpt 标题级；缺省 = 跳过标题级。
  // 调用方须读 live store（useUiStore.getState()），别用 render 闭包旧值（hydrate 时序）。
  getAiById?: () => ReadonlyMap<string, Pick<EntryAi, 'titleSuggestion'>> | undefined
  // di.llm.proactiveGreeting；桩抛错 = 走模板兜底（console.warn）。
  greet: (ctx: ProactiveGreetingContext) => Promise<string | null>
  // 模板句（i18n 由调用方给，本模块不碰 i18n）。
  fallbackText: () => string
  // 可注入存储（测试 / 非 web 环境）；缺省 window.localStorage。
  store?: Pick<Storage, 'getItem' | 'setItem'>
  warn?: (msg: string, err: unknown) => void
}

function readLs(store: Pick<Storage, 'getItem'>, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null // private mode / 配额异常 —— 当作无状态，照常问候
  }
}

function writeLs(store: Pick<Storage, 'setItem'>, key: string, value: string): void {
  try {
    store.setItem(key, value)
  } catch {
    // 同上：写不进去只是失去频控/缓存，不影响本次渲染
  }
}

// dismiss：当日不再出现（spec §3 dismissedKey=date）。
export function dismissGreeting(now: Date, store?: Pick<Storage, 'setItem'>): void {
  const s = store ?? window.localStorage
  writeLs(s, PD_KEYS.dismissedDate, localDayKey(now))
}

// 开屏问候编排。返 null = 不渲染卡（频控中 / 当日已 dismiss）。
// 流程（spec §3）：dismiss 检查 → 6h 频控 → 当日缓存命中（不调 LLM）→
// buildContext → LLM → null/抛错 → 模板兜底。任何形态展示都刷新 lastGreetingAt
// （「距上次问候 ≥6h」的「问候」指每次实际展示的卡）。
export async function maybeGreeting(deps: ProactiveDeps): Promise<GreetingResult | null> {
  const { now } = deps
  const store = deps.store ?? window.localStorage
  const warn = deps.warn ?? ((msg: string, err: unknown) => console.warn(msg, err))

  // 当日 dismiss：整日静默
  if (readLs(store, PD_KEYS.dismissedDate) === localDayKey(now)) return null

  // 6h 频控
  const lastRaw = readLs(store, PD_KEYS.lastGreetingAt)
  if (lastRaw) {
    const last = new Date(lastRaw).getTime()
    if (!Number.isNaN(last) && now.getTime() - last < GREETING_INTERVAL_MS) return null
  }

  // 当日缓存：同日同时段直接命中，不重复调 LLM
  const cacheKey = `${localDayKey(now)}:${daypartOf(now)}`
  const cacheRaw = readLs(store, PD_KEYS.cache)
  if (cacheRaw) {
    try {
      const parsed = JSON.parse(cacheRaw) as { key?: unknown; text?: unknown }
      if (parsed.key === cacheKey && typeof parsed.text === 'string' && parsed.text.trim()) {
        writeLs(store, PD_KEYS.lastGreetingAt, now.toISOString())
        return { text: parsed.text, source: 'cache' }
      }
    } catch {
      // 缓存 JSON 坏 → 当作未命中
    }
  }

  // 拼 context + 调 LLM；任何失败（存储读挂 / 桩抛错 / 网络挂）→ 模板兜底 + warn。
  let text: string | null = null
  try {
    const [entries, memories, reminders, conversation] = await Promise.all([
      deps.listEntries(),
      deps.listMemories(),
      deps.listReminders(),
      deps.getConversation(),
    ])
    const ctx = buildContext({ now, entries, memories, reminders, conversation })
    text = await deps.greet(ctx)
    if (text && !text.trim()) text = null
  } catch (err) {
    warn('[proactive] greeting 失败，走模板兜底', err)
    text = null
  }

  writeLs(store, PD_KEYS.lastGreetingAt, now.toISOString())
  if (text) {
    writeLs(store, PD_KEYS.cache, JSON.stringify({ key: cacheKey, text }))
    return { text, source: 'llm' }
  }
  // 模板兜底不写缓存——6h 后同时段允许重试 LLM（缓存只省同日同时段的重复调用）。
  return { text: deps.fallbackText(), source: 'template' }
}
