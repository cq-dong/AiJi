import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setCurrentLang } from '@/app/currentLang'
import { buildConversationSummaryPrompt, openAiCompatLlm } from '@/adapters/openAiCompatLlm'
import { builtinLlm } from '@/adapters/builtinLlm'
import { localSession } from '@/app/session'

// P-B（2026-10-03）滚动对话摘要：buildConversationSummaryPrompt（zh+en 单源）
// + openAiCompatLlm.summarizeConversation（BYOK chat completions 通道，max_tokens 300 / temperature 0）
// + builtinLlm.summarizeConversation（/api/llm/chat + consume('llm', 1)，不实现 embed）。
// 提示词双语化后默认 en（jsdom navigator.language=en-US）；zh 契约断言前锁 zh。

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

const chunk = [
  { role: 'user' as const, content: '我最近在准备考研', date: '2026-09-28' },
  { role: 'assistant' as const, content: '加油，需要我帮你规划吗' },
  { role: 'user' as const, content: '数学每天至少两小时' },
]

const okChatReply = (text: string) =>
  (globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as never)

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

describe('buildConversationSummaryPrompt（zh）', () => {
  it('system 含第三人称摘要指令 + 保留事实/约定/进行中事项 + 丢弃寒暄', () => {
    const system = buildConversationSummaryPrompt(null, chunk)[0].content as string
    expect(system).toContain('第三人称')
    expect(system).toContain('事实')
    expect(system).toContain('约定')
    expect(system).toContain('进行中事项')
    expect(system).toContain('偏好')
    expect(system).toContain('寒暄')
  })

  it('prior 非 null → 含已有摘要并入指令与 prior 原文', () => {
    const msgs = buildConversationSummaryPrompt('用户在备考考研，目标明年上岸。', chunk)
    const joined = msgs.map((m) => m.content as string).join('\n')
    expect(joined).toContain('已有摘要')
    expect(joined).toContain('用户在备考考研，目标明年上岸。')
  })

  it('prior=null → user message 无「已有摘要」数据段（system 条件规则除外）', () => {
    const user = buildConversationSummaryPrompt(null, chunk)[1].content as string
    expect(user).not.toContain('已有摘要')
  })

  it('chunk 带 date 的条目渲染 [YYYY-MM-DD] 前缀', () => {
    const user = buildConversationSummaryPrompt(null, chunk)[1].content as string
    expect(user).toContain('[2026-09-28]')
    expect(user).toContain('我最近在准备考研')
    expect(user).toContain('数学每天至少两小时')
  })

  it('输出只要摘要正文（不输出 JSON/引号约束存在）', () => {
    const system = buildConversationSummaryPrompt(null, chunk)[0].content as string
    expect(system).toMatch(/JSON|json/)
    expect(system).toContain('摘要')
  })
})

describe('buildConversationSummaryPrompt（en）', () => {
  it('system 含 third-person + merge prior 指令', () => {
    setCurrentLang('en')
    const system = buildConversationSummaryPrompt('The user is preparing for the grad-school exam.', chunk)[0].content as string
    expect(system.toLowerCase()).toContain('third-person')
    expect(system.toLowerCase()).toContain('existing summary')
    expect(system).toContain('English')
  })

  it('prior=null → user message 无 existing-summary 数据段（system 条件规则除外）', () => {
    setCurrentLang('en')
    const user = buildConversationSummaryPrompt(null, chunk)[1].content as string
    expect(user.toLowerCase()).not.toContain('existing summary')
  })
})

describe('openAiCompatLlm.summarizeConversation', () => {
  it('走 chat completions，max_tokens=300 / temperature=0，返回 trimmed 文本', async () => {
    okChatReply('  用户在备考考研，计划每天学数学两小时。  ')
    const out = await openAiCompatLlm.summarizeConversation(null, chunk)
    expect(out).toBe('用户在备考考研，计划每天学数学两小时。')
    const body = lastFetchBody()
    expect(body.max_tokens).toBe(300)
    expect(body.temperature).toBe(0)
  })

  it('缺 key → 抛错（与 extractMemory 失败语义一致，调用方吞掉）', async () => {
    fixtures.apiKey = undefined
    await expect(openAiCompatLlm.summarizeConversation(null, chunk)).rejects.toThrow()
  })
})

describe('builtinLlm.summarizeConversation', () => {
  it('走 /api/llm/chat + consume llm quota，返回 trimmed 文本', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ reply: '  用户在备考考研。  ' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as never
    const out = await builtinLlm.summarizeConversation(null, chunk)
    expect(out).toBe('用户在备考考研。')
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(String(calls[0][0])).toContain('/api/llm/chat')
  })

  it('不实现 embed（缺席 → 调用方 ?? null 降级）', () => {
    expect(builtinLlm.embed).toBeUndefined()
  })
})
