import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setCurrentLang } from '@/app/currentLang'
import { buildMemoryAdjudicationPrompt, parseAdjudicationJson, loadEnabledMemoryContents } from '@/adapters/llmShared'
import { openAiCompatLlm } from '@/adapters/openAiCompatLlm'
import { builtinLlm } from '@/adapters/builtinLlm'
import { localSession } from '@/app/session'
import type { Memory } from '@/domain/types'

// P-C（2026-10-03）记忆生命周期：buildMemoryAdjudicationPrompt（zh+en 单源）
// + parseAdjudicationJson（白名单：四 action + 非法丢弃 + oldId ∈ similar + merge 必带 merged）
// + openAiCompatLlm.adjudicateMemory（BYOK chat completions，max_tokens 200 / temperature 0）
// + builtinLlm.adjudicateMemory（/api/llm/chat + consume('llm', 1)）。
// oldId 校验放解析层（注释在实现里）：非法 oldId → 降级 { action: 'add' }；
// JSON 坏 → 抛错（调用方 store 兜底 ADD）。

const fixtures = vi.hoisted(() => ({
  settings: { llmUrl: 'https://api.deepseek.com/v1/chat/completions', llmModel: 'test-model' },
  apiKey: 'sk-test' as string | undefined,
  memories: [] as import('@/domain/types').Memory[],
}))
const { netState, consumeFn } = vi.hoisted(() => ({
  netState: () => ({ account: { id: 'u1', type: 'network', nickname: 'n', plan: 'free', createdAt: '' } }),
  consumeFn: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getSettings: vi.fn(async () => fixtures.settings),
      listMemories: vi.fn(async () => fixtures.memories),
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

const similar = [
  { id: 'm1', content: '用户住在上海' },
  { id: 'm2', content: '用户对花生过敏' },
]
const validIds = new Set(similar.map((s) => s.id))

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
  fixtures.memories = []
})

describe('buildMemoryAdjudicationPrompt（zh）', () => {
  it('system 含裁决身份 + 四 action 指令（add/replace/merge/skip）', () => {
    const system = buildMemoryAdjudicationPrompt('用户搬到了杭州', similar)[0].content as string
    expect(system).toContain('add')
    expect(system).toContain('replace')
    expect(system).toContain('merge')
    expect(system).toContain('skip')
    expect(system).toContain('新值')
    expect(system).toContain('互补')
    expect(system).toContain('覆盖')
  })

  it('只输出 JSON + 禁围栏约束存在', () => {
    const system = buildMemoryAdjudicationPrompt('用户搬到了杭州', similar)[0].content as string
    expect(system).toContain('JSON')
    expect(system).toContain('围栏')
  })

  it('user message 含新记忆原文 + similar 带 id 渲染', () => {
    const user = buildMemoryAdjudicationPrompt('用户搬到了杭州', similar)[1].content as string
    expect(user).toContain('用户搬到了杭州')
    expect(user).toContain('m1')
    expect(user).toContain('用户住在上海')
    expect(user).toContain('m2')
    expect(user).toContain('用户对花生过敏')
  })
})

describe('buildMemoryAdjudicationPrompt（en）', () => {
  it('system 含四 action + merge 输出语言约束', () => {
    setCurrentLang('en')
    const system = buildMemoryAdjudicationPrompt('The user moved to Hangzhou', similar)[0].content as string
    expect(system).toContain('add')
    expect(system).toContain('replace')
    expect(system).toContain('merge')
    expect(system).toContain('skip')
    expect(system).toContain('English')
    expect(system.toLowerCase()).toContain('json')
  })
})

describe('parseAdjudicationJson', () => {
  it('add → { action: add }', () => {
    expect(parseAdjudicationJson('{"action":"add"}', validIds)).toEqual({ action: 'add' })
  })

  it('replace + 合法 oldId → 保留', () => {
    expect(parseAdjudicationJson('{"action":"replace","oldId":"m1"}', validIds)).toEqual({ action: 'replace', oldId: 'm1' })
  })

  it('merge + 合法 oldId + merged → 保留', () => {
    expect(parseAdjudicationJson('{"action":"merge","oldId":"m1","merged":"用户住在上海，刚搬去杭州"}', validIds))
      .toEqual({ action: 'merge', oldId: 'm1', merged: '用户住在上海，刚搬去杭州' })
  })

  it('skip 带/不带 oldId 均合法', () => {
    expect(parseAdjudicationJson('{"action":"skip","oldId":"m2"}', validIds)).toEqual({ action: 'skip', oldId: 'm2' })
    expect(parseAdjudicationJson('{"action":"skip"}', validIds)).toEqual({ action: 'skip' })
  })

  it('非法 action → 降级 add', () => {
    expect(parseAdjudicationJson('{"action":"delete","oldId":"m1"}', validIds)).toEqual({ action: 'add' })
    expect(parseAdjudicationJson('{"action":42}', validIds)).toEqual({ action: 'add' })
  })

  it('oldId 不在 similar → 降级 add（replace/merge/skip 同则）', () => {
    expect(parseAdjudicationJson('{"action":"replace","oldId":"m9"}', validIds)).toEqual({ action: 'add' })
    expect(parseAdjudicationJson('{"action":"merge","oldId":"m9","merged":"x"}', validIds)).toEqual({ action: 'add' })
    expect(parseAdjudicationJson('{"action":"skip","oldId":"m9"}', validIds)).toEqual({ action: 'add' })
  })

  it('replace/merge 缺 oldId → 降级 add', () => {
    expect(parseAdjudicationJson('{"action":"replace"}', validIds)).toEqual({ action: 'add' })
    expect(parseAdjudicationJson('{"action":"merge","merged":"x"}', validIds)).toEqual({ action: 'add' })
  })

  it('merge 缺 merged / merged 非字符串 → 降级 add', () => {
    expect(parseAdjudicationJson('{"action":"merge","oldId":"m1"}', validIds)).toEqual({ action: 'add' })
    expect(parseAdjudicationJson('{"action":"merge","oldId":"m1","merged":42}', validIds)).toEqual({ action: 'add' })
    expect(parseAdjudicationJson('{"action":"merge","oldId":"m1","merged":"  "}', validIds)).toEqual({ action: 'add' })
  })

  it('markdown 围栏包裹 → 抽出 JSON 解析', () => {
    expect(parseAdjudicationJson('```json\n{"action":"replace","oldId":"m1"}\n```', validIds))
      .toEqual({ action: 'replace', oldId: 'm1' })
  })

  it('坏 JSON → 抛错（调用方兜底 ADD）', () => {
    expect(() => parseAdjudicationJson('这不是 JSON', validIds)).toThrow()
    expect(() => parseAdjudicationJson('{"action":"add"', validIds)).toThrow()
    expect(() => parseAdjudicationJson('[1,2]', validIds)).toThrow()
  })
})

describe('openAiCompatLlm.adjudicateMemory', () => {
  it('走 chat completions，max_tokens=200 / temperature=0，返回解析后 verdict', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"replace","oldId":"m1"}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as never
    const out = await openAiCompatLlm.adjudicateMemory('用户搬到了杭州', similar)
    expect(out).toEqual({ action: 'replace', oldId: 'm1' })
    const body = lastFetchBody()
    expect(body.max_tokens).toBe(200)
    expect(body.temperature).toBe(0)
  })

  it('缺 key → 抛错（与 extractMemory 失败语义一致，调用方兜底 ADD）', async () => {
    fixtures.apiKey = undefined
    await expect(openAiCompatLlm.adjudicateMemory('x', similar)).rejects.toThrow()
  })

  it('HTTP 非 2xx → 抛错', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('rate limited', { status: 429 })
    ) as never
    await expect(openAiCompatLlm.adjudicateMemory('x', similar)).rejects.toThrow(/429/)
  })

  it('LLM 返回坏 JSON → 抛错（parseAdjudicationJson 抛出，调用方兜底 ADD）', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '这不是 JSON' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as never
    await expect(openAiCompatLlm.adjudicateMemory('x', similar)).rejects.toThrow()
  })
})

describe('builtinLlm.adjudicateMemory', () => {
  it('走 /api/llm/chat + consume llm quota，返回解析后 verdict', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ reply: '{"action":"merge","oldId":"m1","merged":"用户住在上海，刚搬去杭州"}' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as never
    const out = await builtinLlm.adjudicateMemory('用户搬到了杭州', similar)
    expect(out).toEqual({ action: 'merge', oldId: 'm1', merged: '用户住在上海，刚搬去杭州' })
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(String(calls[0][0])).toContain('/api/llm/chat')
  })
})

// 注入过滤（P-C §4）：archivedAt 非空 = 过期自动归档，不进 prompt。classify/answerChat
// （含流式）记忆注入都走 loadEnabledMemoryContents 单点，此处过滤即全覆盖。
describe('loadEnabledMemoryContents 归档过滤', () => {
  const mem = (over: Partial<Memory>): Memory => ({
    id: crypto.randomUUID(),
    content: 'x',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  })

  it('archivedAt 非空的记忆被过滤；enabled && !archivedAt 的保留', async () => {
    fixtures.memories = [
      mem({ content: '正常记忆' }),
      mem({ content: '已归档记忆', archivedAt: '2026-09-01T00:00:00.000Z' }),
      mem({ content: '手动停用记忆', enabled: false }),
      mem({ content: '归档且停用', enabled: false, archivedAt: '2026-09-01T00:00:00.000Z' }),
    ]
    const out = await loadEnabledMemoryContents()
    expect(out).toEqual(['正常记忆'])
  })

  it('lastConfirmedAt 不影响过滤（仅 archivedAt 决定归档）', async () => {
    fixtures.memories = [
      mem({ content: '带确认时间', lastConfirmedAt: '2026-09-20T00:00:00.000Z' }),
    ]
    const out = await loadEnabledMemoryContents()
    expect(out).toEqual(['带确认时间'])
  })

  it('空库 → 空数组（prompt 不注入）', async () => {
    fixtures.memories = []
    expect(await loadEnabledMemoryContents()).toEqual([])
  })
})
