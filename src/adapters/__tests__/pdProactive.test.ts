import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setCurrentLang } from '@/app/currentLang'
import {
  buildProactiveGreetingPrompt,
  parseProactiveGreetingReply,
  openAiCompatLlm,
} from '@/adapters/openAiCompatLlm'
import { builtinLlm } from '@/adapters/builtinLlm'
import { localSession } from '@/app/session'
import type { ProactiveGreetingContext } from '@/ports'

// P-D（2026-10-03）主动触达：buildProactiveGreetingPrompt（zh+en 单源）
// + parseProactiveGreetingReply（NULL/空/引号包裹 → null，否则原文）
// + openAiCompatLlm.proactiveGreeting（BYOK chat completions，max_tokens 80 / temperature 0.7）
// + builtinLlm.proactiveGreeting（/api/llm/chat + consume('llm', 1)）。
// null = 无特别可说 → 调用方走模板兜底卡；抛错 → 调用方同样兜底模板 + console.warn。

const fixtures = vi.hoisted(() => ({
  settings: { llmUrl: 'https://api.deepseek.com/v1/chat/completions', llmModel: 'test-model' },
  apiKey: 'sk-test' as string | undefined,
}))
const { netState, consumeFn } = vi.hoisted(() => ({
  netState: () => ({ account: { id: 'u1', type: 'network', nickname: 'n', plan: 'free', createdAt: '' } }),
  consumeFn: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getSettings: vi.fn(async () => fixtures.settings),
      listMemories: vi.fn(async () => []),
    },
    secrets: { get: vi.fn(async () => fixtures.apiKey) },
    auth: { refresh: vi.fn() },
  },
}))
vi.mock('@/app/accountStore', () => ({
  useAccountStore: { getState: netState },
}))
vi.mock('@/app/quotaStore', () => ({
  useQuotaStore: { getState: () => ({ consume: consumeFn }) },
}))

const ctx: ProactiveGreetingContext = {
  daypart: 'morning',
  recentEntryCount7d: 3,
  daysSinceLastEntry: 2,
  openLoops: ['用户在准备考研', '用户的项目下个月交付'],
  rollingSummary: '上次聊到方案进展与搬家的事',
  dueReminderCount: 1,
}

const ctxEmpty: ProactiveGreetingContext = {
  daypart: 'night',
  recentEntryCount7d: 0,
  daysSinceLastEntry: null,
  openLoops: [],
  dueReminderCount: 0,
}

const lastFetchBody = (): Record<string, unknown> => {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  return JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string)
}

beforeEach(() => {
  setCurrentLang('zh')
  vi.clearAllMocks()
  localStorage.clear()
  localSession.set({ jwt: 'oldjwt', refreshToken: 'r', expiresAt: '2099' })
  fixtures.settings = { llmUrl: 'https://api.deepseek.com/v1/chat/completions', llmModel: 'test-model' }
  fixtures.apiKey = 'sk-test'
})

describe('buildProactiveGreetingPrompt（zh）', () => {
  it('system 含伙伴人格 + ≤40 字 + NULL + 不编造 + 最多一问指令', () => {
    const system = buildProactiveGreetingPrompt(ctx)[0].content as string
    expect(system).toContain('40')
    expect(system).toContain('NULL')
    expect(system).toContain('编造')
    expect(system).toContain('一个问题')
  })

  it('user 渲染 daypart 中文时段 + 计数 + openLoops + rollingSummary + dueReminderCount', () => {
    const user = buildProactiveGreetingPrompt(ctx)[1].content as string
    expect(user).toContain('早上')
    expect(user).toContain('最近 7 天条目数：3')
    expect(user).toContain('距上次记录：2 天')
    expect(user).toContain('用户在准备考研')
    expect(user).toContain('用户的项目下个月交付')
    expect(user).toContain('上次聊到方案进展与搬家的事')
    expect(user).toContain('提醒：1 条')
  })

  it('边界渲染：daysSinceLastEntry null → 从未记过；openLoops 空 → （无）；rollingSummary 缺席 → 该行省略', () => {
    const user = buildProactiveGreetingPrompt(ctxEmpty)[1].content as string
    expect(user).toContain('深夜')
    expect(user).toContain('从未记过')
    expect(user).toContain('（无）')
    expect(user).not.toContain('上次聊天摘要')
  })

  it('daypart 四时段中文映射', () => {
    const parts: [ProactiveGreetingContext['daypart'], string][] = [
      ['morning', '早上'],
      ['afternoon', '下午'],
      ['evening', '晚上'],
      ['night', '深夜'],
    ]
    for (const [daypart, label] of parts) {
      const user = buildProactiveGreetingPrompt({ ...ctxEmpty, daypart })[1].content as string
      expect(user).toContain(label)
    }
  })
})

describe('buildProactiveGreetingPrompt（en）', () => {
  beforeEach(() => setCurrentLang('en'))

  it('system 含 ≤40 chars + NULL + no-invent + at most one question 指令', () => {
    const system = buildProactiveGreetingPrompt(ctx)[0].content as string
    expect(system).toContain('40')
    expect(system).toContain('NULL')
    expect(system.toLowerCase()).toContain('invent')
    expect(system.toLowerCase()).toContain('one question')
    expect(system).toContain('English')
  })

  it('user 渲染英文标签 + 数据原文不翻译', () => {
    const user = buildProactiveGreetingPrompt(ctx)[1].content as string
    expect(user).toContain('morning')
    expect(user).toContain('用户在准备考研') // 数据注入原文不翻译
    expect(user).toContain('上次聊到方案进展与搬家的事')
  })
})

describe('parseProactiveGreetingReply', () => {
  it('NULL（大小写不敏感）/ 空 → null', () => {
    expect(parseProactiveGreetingReply('NULL')).toBeNull()
    expect(parseProactiveGreetingReply('null')).toBeNull()
    expect(parseProactiveGreetingReply('  NULL  ')).toBeNull()
    expect(parseProactiveGreetingReply('')).toBeNull()
    expect(parseProactiveGreetingReply('   ')).toBeNull()
  })

  it('正常文本 → 原文（trim）；引号包裹 → 去引号', () => {
    expect(parseProactiveGreetingReply('  三天没记了，方案后来怎么样了？ ')).toBe('三天没记了，方案后来怎么样了？')
    expect(parseProactiveGreetingReply('"早，今天有什么想记的？"')).toBe('早，今天有什么想记的？')
  })

  it('引号包裹的 NULL → null', () => {
    expect(parseProactiveGreetingReply('"NULL"')).toBeNull()
  })
})

describe('openAiCompatLlm.proactiveGreeting', () => {
  const mockReply = (content: string) => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as never
  }

  it('走 chat completions，max_tokens=80 / temperature=0.7，正常文本原样返回', async () => {
    mockReply('三天没记了，上次的方案后来怎么样了？')
    const out = await openAiCompatLlm.proactiveGreeting(ctx)
    expect(out).toBe('三天没记了，上次的方案后来怎么样了？')
    const body = lastFetchBody()
    expect(body.max_tokens).toBe(80)
    expect(body.temperature).toBe(0.7)
  })

  it('LLM 返 NULL / 空 → null（调用方走模板兜底卡）', async () => {
    mockReply('NULL')
    expect(await openAiCompatLlm.proactiveGreeting(ctx)).toBeNull()
    mockReply('   ')
    expect(await openAiCompatLlm.proactiveGreeting(ctx)).toBeNull()
  })

  it('HTTP 非 2xx → 抛错', async () => {
    globalThis.fetch = vi.fn(async () => new Response('server error', { status: 500 })) as never
    await expect(openAiCompatLlm.proactiveGreeting(ctx)).rejects.toThrow(/500/)
  })

  it('缺 key → 抛错（调用方兜底模板卡）', async () => {
    fixtures.apiKey = undefined
    await expect(openAiCompatLlm.proactiveGreeting(ctx)).rejects.toThrow()
  })

  it('响应缺 content → 抛错', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as never
    await expect(openAiCompatLlm.proactiveGreeting(ctx)).rejects.toThrow()
  })
})

describe('builtinLlm.proactiveGreeting', () => {
  const mockBuiltinReply = (reply: string) => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ reply }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as never
  }

  it('走 /api/llm/chat + consume llm quota，正常文本原样返回', async () => {
    mockBuiltinReply('晚上好，考研准备得怎么样了？')
    const out = await builtinLlm.proactiveGreeting(ctx)
    expect(out).toBe('晚上好，考研准备得怎么样了？')
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(String(calls[0][0])).toContain('/api/llm/chat')
  })

  it('LLM 返 NULL → null', async () => {
    mockBuiltinReply('NULL')
    expect(await builtinLlm.proactiveGreeting(ctx)).toBeNull()
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
  })
})
