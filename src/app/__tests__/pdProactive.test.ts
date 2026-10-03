import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildContext,
  daypartOf,
  dismissGreeting,
  localDayKey,
  maybeGreeting,
  GREETING_INTERVAL_MS,
  PD_KEYS,
  type ProactiveDeps,
} from '@/app/proactive'

// P-D 主动触达编排（spec: docs/superpowers/specs/2026-10-03-proactive-companion.md §3/§6）。
// 覆盖：daypart 边界 / buildContext 各字段 / 6h 频控 / 当日缓存键 date+daypart /
// dismiss 当日 / LLM null→模板 / LLM 抛错→模板+warn / lastGreetingAt 写入。

function at(h: number, min = 0): Date {
  const d = new Date(2026, 9, 3) // 2026-10-03 本地
  d.setHours(h, min, 0, 0)
  return d
}

describe('daypartOf（早 5-11 / 下午 11-18 / 晚 18-23 / 深夜 23-5）', () => {
  it.each([
    [4, 'night'], [5, 'morning'], [10, 'morning'],
    [11, 'afternoon'], [17, 'afternoon'],
    [18, 'evening'], [22, 'evening'],
    [23, 'night'], [0, 'night'],
  ] as const)('%i 点 → %s', (h, want) => {
    expect(daypartOf(at(h)) as string).toBe(want)
  })

  it('分钟级边界：10:59 morning / 11:00 afternoon / 22:59 evening / 23:00 night', () => {
    expect(daypartOf(at(10, 59))).toBe('morning')
    expect(daypartOf(at(11, 0))).toBe('afternoon')
    expect(daypartOf(at(22, 59))).toBe('evening')
    expect(daypartOf(at(23, 0))).toBe('night')
  })
})

describe('buildContext', () => {
  const now = at(12) // 2026-10-03 12:00 本地

  it('recentEntryCount7d：7 天内计入，8 天前/未来不计', () => {
    const ctx = buildContext({
      now,
      entries: [
        { createdAt: new Date(now.getTime() - 6 * 86_400_000).toISOString() },
        { createdAt: now.toISOString() },
        { createdAt: new Date(now.getTime() - 8 * 86_400_000).toISOString() },
        { createdAt: new Date(now.getTime() + 86_400_000).toISOString() },
      ],
      memories: [],
      reminders: [],
    })
    expect(ctx.recentEntryCount7d).toBe(2)
  })

  it('daysSinceLastEntry：无条目 → null；今天 → 0；3 天前 → 3', () => {
    expect(buildContext({ now, entries: [], memories: [], reminders: [] }).daysSinceLastEntry).toBeNull()
    expect(
      buildContext({ now, entries: [{ createdAt: now.toISOString() }], memories: [], reminders: [] }).daysSinceLastEntry,
    ).toBe(0)
    const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000)
    expect(
      buildContext({ now, entries: [{ createdAt: threeDaysAgo.toISOString() }], memories: [], reminders: [] })
        .daysSinceLastEntry,
    ).toBe(3)
  })

  it('openLoops：过滤 enabled=false 与已归档，>5 截断到 5 条', () => {
    const mem = (i: number) => ({ content: `记忆 ${i}`, enabled: true })
    const ctx = buildContext({
      now,
      entries: [],
      memories: [
        ...Array.from({ length: 7 }, (_, i) => mem(i)),
        { content: '已停用', enabled: false },
        { content: '已归档', enabled: true, archivedAt: now.toISOString() },
      ],
      reminders: [],
    })
    expect(ctx.openLoops).toHaveLength(5)
    expect(ctx.openLoops).toEqual(['记忆 0', '记忆 1', '记忆 2', '记忆 3', '记忆 4'])
    expect(ctx.openLoops).not.toContain('已停用')
    expect(ctx.openLoops).not.toContain('已归档')
  })

  it('rollingSummary：会话有摘要则带；无会话/空摘要 → undefined', () => {
    const withSummary = buildContext({
      now, entries: [], memories: [], reminders: [],
      conversation: { rollingSummary: '上次聊到方案进展' },
    })
    expect(withSummary.rollingSummary).toBe('上次聊到方案进展')
    expect(buildContext({ now, entries: [], memories: [], reminders: [] }).rollingSummary).toBeUndefined()
    expect(
      buildContext({ now, entries: [], memories: [], reminders: [], conversation: { rollingSummary: '  ' } })
        .rollingSummary,
    ).toBeUndefined()
  })

  it('dueReminderCount：今天到期+已逾期的 pending/snoozed 计入；明天到期/fired/missed 不计', () => {
    const today15 = new Date(now); today15.setHours(15, 0, 0, 0)
    const yesterday = new Date(now.getTime() - 86_400_000)
    const tomorrow = new Date(now.getTime() + 86_400_000)
    const ctx = buildContext({
      now,
      entries: [],
      memories: [],
      reminders: [
        { dueAt: today15.toISOString(), status: 'pending' }, // 今天到期 ✓
        { dueAt: yesterday.toISOString(), status: 'pending' }, // 已逾期 ✓
        { dueAt: yesterday.toISOString(), status: 'snoozed' }, // snoozed 过新到点 ✓
        { dueAt: tomorrow.toISOString(), status: 'pending' }, // 明天 ✗
        { dueAt: yesterday.toISOString(), status: 'fired' }, // 已响 ✗
        { dueAt: yesterday.toISOString(), status: 'missed' }, // 已错过 ✗
      ],
    })
    expect(ctx.dueReminderCount).toBe(3)
  })

  it('daypart 取自 now', () => {
    expect(buildContext({ now: at(8), entries: [], memories: [], reminders: [] }).daypart).toBe('morning')
    expect(buildContext({ now: at(20), entries: [], memories: [], reminders: [] }).daypart).toBe('evening')
  })
})

// ── maybeGreeting 编排 ─────────────────────────────────────────────

function makeDeps(now: Date, overrides?: Partial<ProactiveDeps>) {
  const greet = vi.fn<ProactiveDeps['greet']>().mockResolvedValue('三天没记了，方案后来怎样了？')
  const warn = vi.fn()
  const deps: ProactiveDeps = {
    now,
    listEntries: async () => [],
    listMemories: async () => [],
    listReminders: async () => [],
    getConversation: async () => undefined,
    greet,
    fallbackText: () => '今天有什么想记的？',
    warn,
    ...overrides,
  }
  return { deps, greet, warn }
}

describe('maybeGreeting', () => {
  const now = at(12)
  const todayKey = localDayKey(now)
  const cacheKey = `${todayKey}:afternoon`

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('6h 频控：距上次 <6h → null，不调 LLM（模板卡也不出）', async () => {
    window.localStorage.setItem(PD_KEYS.lastGreetingAt, new Date(now.getTime() - (GREETING_INTERVAL_MS - 1)).toISOString())
    const { deps, greet } = makeDeps(now)
    expect(await maybeGreeting(deps)).toBeNull()
    expect(greet).not.toHaveBeenCalled()
  })

  it('6h 边界：恰好 6h → 放行（≥ 6h 触发）', async () => {
    window.localStorage.setItem(PD_KEYS.lastGreetingAt, new Date(now.getTime() - GREETING_INTERVAL_MS).toISOString())
    const { deps, greet } = makeDeps(now)
    const r = await maybeGreeting(deps)
    expect(r?.source).toBe('llm')
    expect(greet).toHaveBeenCalledTimes(1)
  })

  it('当日缓存命中（date+daypart 键）→ 直接用，不调 LLM', async () => {
    window.localStorage.setItem(PD_KEYS.cache, JSON.stringify({ key: cacheKey, text: '缓存的问候' }))
    const { deps, greet } = makeDeps(now)
    const r = await maybeGreeting(deps)
    expect(r).toEqual({ text: '缓存的问候', source: 'cache' })
    expect(greet).not.toHaveBeenCalled()
  })

  it('缓存键 daypart 不同 → 不命中，正常调 LLM', async () => {
    window.localStorage.setItem(PD_KEYS.cache, JSON.stringify({ key: `${todayKey}:morning`, text: '早上的缓存' }))
    const { deps, greet } = makeDeps(now)
    const r = await maybeGreeting(deps)
    expect(r?.source).toBe('llm')
    expect(greet).toHaveBeenCalledTimes(1)
  })

  it('dismiss 当日 → null；昨天 dismiss 不影响今天', async () => {
    dismissGreeting(now)
    const { deps, greet } = makeDeps(now)
    expect(await maybeGreeting(deps)).toBeNull()
    expect(greet).not.toHaveBeenCalled()

    window.localStorage.setItem(PD_KEYS.dismissedDate, '2026-10-02')
    const { deps: deps2, greet: greet2 } = makeDeps(now)
    expect((await maybeGreeting(deps2))?.source).toBe('llm')
    expect(greet2).toHaveBeenCalledTimes(1)
  })

  it('LLM 返 null → 模板兜底（不调 fallbackText 以外文案），仍写 lastGreetingAt', async () => {
    const greetNull = vi.fn<ProactiveDeps['greet']>().mockResolvedValue(null)
    const { deps } = makeDeps(now, { greet: greetNull })
    const r = await maybeGreeting(deps)
    expect(r).toEqual({ text: '今天有什么想记的？', source: 'template' })
    expect(greetNull).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(PD_KEYS.lastGreetingAt)).toBe(now.toISOString())
  })

  it('LLM 抛错（契约桩）→ 模板兜底 + console.warn', async () => {
    const boom = new Error('stub: not implemented')
    const { deps, warn } = makeDeps(now, {
      greet: async () => {
        throw boom
      },
    })
    const r = await maybeGreeting(deps)
    expect(r).toEqual({ text: '今天有什么想记的？', source: 'template' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![1]).toBe(boom)
  })

  it('LLM 成功 → 返问候文本 + 写当日缓存（date+daypart）+ 写 lastGreetingAt', async () => {
    const { deps } = makeDeps(now)
    const r = await maybeGreeting(deps)
    expect(r).toEqual({ text: '三天没记了，方案后来怎样了？', source: 'llm' })
    expect(JSON.parse(window.localStorage.getItem(PD_KEYS.cache)!)).toEqual({
      key: cacheKey,
      text: '三天没记了，方案后来怎样了？',
    })
    expect(window.localStorage.getItem(PD_KEYS.lastGreetingAt)).toBe(now.toISOString())
  })

  it('LLM 返空白串 → 视同 null 走模板', async () => {
    const { deps } = makeDeps(now, { greet: async () => '   ' })
    expect((await maybeGreeting(deps))?.source).toBe('template')
  })

  it('模板兜底不写当日缓存（6h 后同时段允许重试 LLM）', async () => {
    const { deps } = makeDeps(now, { greet: async () => null })
    await maybeGreeting(deps)
    expect(window.localStorage.getItem(PD_KEYS.cache)).toBeNull()
  })

  it('context 透传：greet 收到的就是 buildContext 产物', async () => {
    const entry = { createdAt: now.toISOString() }
    const { deps, greet } = makeDeps(now, {
      listEntries: async () => [entry],
      listMemories: async () => [{ content: '方案进行中', enabled: true }],
      getConversation: async () => ({ rollingSummary: '上次聊方案' }),
    })
    await maybeGreeting(deps)
    expect(greet).toHaveBeenCalledWith({
      daypart: 'afternoon',
      recentEntryCount7d: 1,
      daysSinceLastEntry: 0,
      openLoops: ['方案进行中'],
      rollingSummary: '上次聊方案',
      dueReminderCount: 0,
    })
  })
})
