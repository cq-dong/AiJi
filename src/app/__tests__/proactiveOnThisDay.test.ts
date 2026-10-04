import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildContext, maybeGreeting, type ProactiveDeps } from '@/app/proactive'
import type { EntryPart } from '@/domain/types'

// P-F ① 往日回响（onThisDay，docs/acceptance/pf-companion-pack.md §①）：
// buildContext —— 同月日（本地时区 getMonth/getDate）且年份 < now 年的候选按 createdAt 降序，
// 取第一条 excerpt 非空者 → { yearsAgo, excerpt }；excerpt 三级回退 = aiById 标题 →
// 首个 text part 首个非空行 → 首个 audio/video part transcript 首个非空行，统一 trim + 截 60 字；
// 无候选 / 全部候选 excerpt 空 → undefined（不瞎编）。
// maybeGreeting —— 新可选 dep getAiById 透传进 buildContext；缺省不崩。

const now = new Date(2026, 9, 5, 12, 0, 0) // 2026-10-05 12:00 本地

// 本地时刻 → ISO（与 buildContext 内 new Date(createdAt) 的本地解析闭环）。
function iso(y: number, m: number, d: number, h = 8): string {
  return new Date(y, m - 1, d, h, 0, 0).toISOString()
}

const textPart = (content: string): EntryPart => ({ type: 'text', content })
const audioPart = (transcript?: string): EntryPart => ({ type: 'audio', ref: 'r1', durationSec: 3, transcript })

describe('buildContext · onThisDay', () => {
  const base = { now, memories: [], reminders: [] }

  it('跨年命中：去年同月日 → { yearsAgo: 1, excerpt }（excerpt 取 aiById 标题）', () => {
    const ctx = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [textPart('正文首行')] }],
      aiById: new Map([['e1', { titleSuggestion: '去年今日喝咖啡' }]]),
    })
    expect(ctx.onThisDay).toEqual({ yearsAgo: 1, excerpt: '去年今日喝咖啡' })
  })

  it('同年同月日条目排除（年份必须 < now 年）', () => {
    const ctx = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2026, 10, 5, 6), parts: [textPart('今早记的')] }],
      aiById: new Map([['e1', { titleSuggestion: '今年的标题' }]]),
    })
    expect(ctx.onThisDay).toBeUndefined()
  })

  it('不同月日 / 空 entries → undefined', () => {
    const ctx = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 4), parts: [textPart('差一天')] }],
    })
    expect(ctx.onThisDay).toBeUndefined()
    expect(buildContext({ ...base, entries: [] }).onThisDay).toBeUndefined()
  })

  it('多年候选取 createdAt 最新；yearsAgo = now 年 − 候选年', () => {
    const ctx = buildContext({
      ...base,
      entries: [
        { id: 'old', createdAt: iso(2020, 10, 5), parts: [textPart('六年前')] },
        { id: 'new', createdAt: iso(2025, 10, 5), parts: [textPart('一年前')] },
      ],
    })
    expect(ctx.onThisDay).toEqual({ yearsAgo: 1, excerpt: '一年前' })
    const only2020 = buildContext({
      ...base,
      entries: [{ id: 'old', createdAt: iso(2020, 10, 5), parts: [textPart('六年前')] }],
    })
    expect(only2020.onThisDay).toEqual({ yearsAgo: 6, excerpt: '六年前' })
  })

  it('excerpt 三级回退顺序：aiById 标题 > 文本首行 > transcript 首行', () => {
    // ① 标题赢
    const t1 = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [textPart('文本首行'), audioPart('转写首行')] }],
      aiById: new Map([['e1', { titleSuggestion: '标题建议' }]]),
    })
    expect(t1.onThisDay?.excerpt).toBe('标题建议')
    // ② 无标题 → 文本首行赢（取第一行，忽略后续行）
    const t2 = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [textPart('文本首行\n第二行'), audioPart('转写首行')] }],
    })
    expect(t2.onThisDay?.excerpt).toBe('文本首行')
    // ③ 无 text part → transcript 首行
    const t3 = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [audioPart('转写首行\n转写第二行')] }],
    })
    expect(t3.onThisDay?.excerpt).toBe('转写首行')
  })

  it('空白跳过该级：标题纯空白 → 回退文本首行；文本前导空行取首个非空行', () => {
    const ctx = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [textPart('\n  \n真正首行')] }],
      aiById: new Map([['e1', { titleSuggestion: '   ' }]]),
    })
    expect(ctx.onThisDay?.excerpt).toBe('真正首行')
  })

  it('excerpt 截 60 字', () => {
    const ctx = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [textPart('长'.repeat(80))] }],
    })
    expect(ctx.onThisDay?.excerpt).toBe('长'.repeat(60))
  })

  it('首候选 excerpt 空 → 看下一候选；全部候选空 → undefined（不瞎编）', () => {
    const ctx = buildContext({
      ...base,
      entries: [
        { id: 'empty', createdAt: iso(2025, 10, 5), parts: [textPart('   ')] },
        { id: 'full', createdAt: iso(2024, 10, 5), parts: [textPart('前年有内容')] },
      ],
    })
    expect(ctx.onThisDay).toEqual({ yearsAgo: 2, excerpt: '前年有内容' })
    const none = buildContext({
      ...base,
      entries: [{ id: 'empty', createdAt: iso(2025, 10, 5), parts: [textPart('')] }],
    })
    expect(none.onThisDay).toBeUndefined()
  })

  it('entries 无 id → 静默跳过标题级（回退文本首行）；无 parts → 跳过文本/转写级（标题仍可用）', () => {
    const noId = buildContext({
      ...base,
      entries: [{ createdAt: iso(2025, 10, 5), parts: [textPart('无 id 的文本')] }],
      aiById: new Map([['eX', { titleSuggestion: '查不到' }]]),
    })
    expect(noId.onThisDay?.excerpt).toBe('无 id 的文本')
    const noParts = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 5) }],
      aiById: new Map([['e1', { titleSuggestion: '仅标题' }]]),
    })
    expect(noParts.onThisDay?.excerpt).toBe('仅标题')
    // 无 id 且无 parts → 三级皆空 → undefined
    const nothing = buildContext({ ...base, entries: [{ createdAt: iso(2025, 10, 5) }] })
    expect(nothing.onThisDay).toBeUndefined()
  })

  it('aiById 缺省 → 跳过标题级，回退文本首行', () => {
    const ctx = buildContext({
      ...base,
      entries: [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [textPart('正文首行')] }],
    })
    expect(ctx.onThisDay).toEqual({ yearsAgo: 1, excerpt: '正文首行' })
  })
})

describe('maybeGreeting · getAiById 透传', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  function makeDeps(overrides?: Partial<ProactiveDeps>) {
    const greet = vi.fn<ProactiveDeps['greet']>().mockResolvedValue('问候原文')
    const deps: ProactiveDeps = {
      now,
      listEntries: async () => [],
      listMemories: async () => [],
      listReminders: async () => [],
      getConversation: async () => undefined,
      greet,
      fallbackText: () => '兜底',
      ...overrides,
    }
    return { deps, greet }
  }

  it('getAiById 返回值透传进 buildContext（onThisDay 标题级生效）', async () => {
    const { deps, greet } = makeDeps({
      listEntries: async () => [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [textPart('正文首行')] }],
      getAiById: () => new Map([['e1', { titleSuggestion: '去年今日的标题' }]]),
    })
    const r = await maybeGreeting(deps)
    expect(r?.source).toBe('llm')
    expect(greet).toHaveBeenCalledWith(
      expect.objectContaining({ onThisDay: { yearsAgo: 1, excerpt: '去年今日的标题' } }),
    )
  })

  it('getAiById 缺省 → 不崩，onThisDay 回退文本首行', async () => {
    const { deps, greet } = makeDeps({
      listEntries: async () => [{ id: 'e1', createdAt: iso(2025, 10, 5), parts: [textPart('正文首行')] }],
    })
    const r = await maybeGreeting(deps)
    expect(r?.source).toBe('llm')
    expect(greet).toHaveBeenCalledWith(
      expect.objectContaining({ onThisDay: { yearsAgo: 1, excerpt: '正文首行' } }),
    )
  })
})
