import { describe, it, expect, beforeEach, vi } from 'vitest'
import { builtinLlm } from '@/adapters/builtinLlm'
import { SessionExpiredError } from '@/ports'
import type { ChatStreamEvent } from '@/ports'
import { localSession } from '@/app/session'

// builtinLlm.answerChat 流式分支（2026-09-28 问 AI 流式输出）：
// onEvent 存在 → POST /api/llm/chat 带 stream:true + thinking:true，服务端透传上游 SSE；
// 逐帧分流 reasoning/content（与 BYOK answerChatStreaming 一致）；收口 parseAnswerJson
// → sanitizeInlineCites → validIds 过滤；断流有部分内容宽容返回、无内容抛错；
// 401 → di.auth.refresh → 重放（chatFetch 骨架复用，SSE 响应同样可能 401）；
// 非流式分支逐字节不变（回归）。

const { refreshFn, consumeFn } = vi.hoisted(() => ({
  refreshFn: vi.fn(async () => ({ jwt: 'newjwt', refreshToken: 'r', expiresAt: '2099' })),
  consumeFn: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      // AI 记忆注入：answerChat 调 listMemories → 默认空数组（不注入）
      listMemories: vi.fn(async () => []),
    },
    auth: { refresh: refreshFn },
  },
}))
vi.mock('@/app/accountStore', () => ({
  useAccountStore: {
    getState: () => ({ account: { id: 'u1', type: 'network', nickname: 'n', plan: 'free', createdAt: '' } }),
  },
}))
vi.mock('@/app/quotaStore', () => ({
  useQuotaStore: { getState: () => ({ consume: consumeFn }) },
}))

const delta = (obj: Record<string, unknown>) => JSON.stringify({ choices: [{ delta: obj }] })

// 把 SSE 帧序列编成响应 body；split 时按 7 字节切片喷，最大化跨 chunk / 多字节字符覆盖。
function sseBody(frames: string[], opts?: { split?: boolean }): ReadableStream<Uint8Array> {
  const text = frames.map((f) => `data: ${f}\n\n`).join('') + 'data: [DONE]\n\n'
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(c) {
      if (opts?.split) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7))
      } else {
        c.enqueue(bytes)
      }
      c.close()
    },
  })
}

function mockFetchOnce(body: BodyInit | null, init?: ResponseInit) {
  globalThis.fetch = vi.fn(async () => new Response(body, init)) as never
}

const fetchCalls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
const lastFetchInit = (): RequestInit => fetchCalls()[fetchCalls().length - 1][1] as RequestInit

const cites = [
  { id: 'e1', createdAt: '2026-07-17T10:00:00+08:00', categorySlug: 'idea', tags: [], textExcerpt: '跑步时想到的' },
]

beforeEach(() => {
  localStorage.clear()
  localSession.set({ jwt: 'oldjwt', refreshToken: 'r', expiresAt: '2099' })
  vi.clearAllMocks()
})

describe('builtinLlm.answerChat 流式分支', () => {
  it('reasoning+content 混合帧：事件序列正确 + 最终结果与非流式收口一致', async () => {
    const frames = [
      delta({ reasoning_content: '用户在问跑步想法，' }),
      delta({ reasoning_content: '先看召回。' }),
      delta({}), // finish/空 delta 帧 → 无事件
      delta({ content: '{"answer": "你在跑步时' }),
      delta({ content: '想到产品形态（见 e1）", "citedEntryIds": ["e1", "bogus"]}' }),
    ]
    mockFetchOnce(sseBody(frames, { split: true }), { status: 200 })
    const events: ChatStreamEvent[] = []
    const ans = await builtinLlm.answerChat(
      { question: '我关于跑步的想法？', cites, conversation: [] },
      (ev) => events.push(ev),
    )
    expect(events).toEqual([
      { type: 'reasoning', delta: '用户在问跑步想法，' },
      { type: 'reasoning', delta: '先看召回。' },
      { type: 'content', delta: '{"answer": "你在跑步时' },
      { type: 'content', delta: '想到产品形态（见 e1）", "citedEntryIds": ["e1", "bogus"]}' },
    ])
    // 收口：parseAnswerJson + sanitizeInlineCites + validIds 过滤（bogus 剔除）
    expect(ans).toEqual({ answer: '你在跑步时想到产品形态（见 e1）', citedEntryIds: ['e1'] })
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
  })

  it('流式分支请求体带 stream:true + thinking:true，走 /api/llm/chat', async () => {
    mockFetchOnce(sseBody([delta({ content: '{"answer": "x", "citedEntryIds": []}' })]), { status: 200 })
    await builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {})
    expect(String(fetchCalls()[0][0])).toContain('/api/llm/chat')
    const body = JSON.parse(String(lastFetchInit().body)) as Record<string, unknown>
    expect(body.stream).toBe(true)
    expect(body.thinking).toBe(true)
  })

  it('401 → refresh → 重放成功（第二次请求带 newjwt）', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) return new Response('', { status: 401 })
      return new Response(sseBody([delta({ content: '{"answer": "好", "citedEntryIds": []}' })]), { status: 200 })
    }) as never
    const ans = await builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {})
    expect(calls).toBe(2)
    expect(ans).toEqual({ answer: '好', citedEntryIds: [] })
    expect(localSession.get()?.jwt).toBe('newjwt')
    expect(refreshFn).toHaveBeenCalledOnce()
    const retryInit = lastFetchInit()
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer newjwt')
  })

  it('401 → refresh 失败 → SessionExpiredError + session 清除', async () => {
    refreshFn.mockRejectedValueOnce(new Error('AUTH_401'))
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as never
    await expect(
      builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toBeInstanceOf(SessionExpiredError)
    expect(localSession.get()).toBeNull()
  })

  it('断流有部分内容 → 宽容解析返回部分答案（不抛错，仍 consume）', async () => {
    const stream = new ReadableStream({
      // 异步间隙模拟真实断流：已到达的 chunk 先交付 reader，再抛网络错误
      async start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${delta({ content: '{"answer": "部分回答' })}\n\n`))
        await new Promise((r) => setTimeout(r, 10))
        c.error(new Error('network down'))
      },
    })
    mockFetchOnce(stream, { status: 200 })
    const ans = await builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {})
    expect(ans).toEqual({ answer: '部分回答', citedEntryIds: [] })
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
  })

  // m8（2026-09-28 流式验收）：服务端在响应头到达时已计费（含断流部分流）→ res.ok 确认
  // 立即 consume，不等流式收口——旧实现流结束才扣，断流/杀进程时客户端配额 desync。
  it('res.ok 后立即 consume（不等流式收口）', async () => {
    const stream = new ReadableStream({
      async start(c) {
        await new Promise((r) => setTimeout(r, 30))
        c.error(new Error('cut'))
      },
    })
    mockFetchOnce(stream, { status: 200 })
    const p = builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}).catch((e) => e)
    // 流尚未结束（30ms 才断）时 consume 已发生
    await new Promise((r) => setTimeout(r, 10))
    expect(consumeFn).toHaveBeenCalledTimes(1)
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
    await p // 收尾，避免悬挂
  })

  it('断流无任何内容 → 抛错走现有 error 路径（res.ok 已计费，consume 仍扣）', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.error(new Error('network down'))
      },
    })
    mockFetchOnce(stream, { status: 200 })
    await expect(
      builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toThrow('network down')
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
  })

  it('HTTP 错误 → 抛 builtinLlm HTTP <status>（未 OK 不计费不 consume）', async () => {
    mockFetchOnce('server error', { status: 500 })
    await expect(
      builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toThrow('builtinLlm HTTP 500')
    expect(consumeFn).not.toHaveBeenCalled()
  })

  it('流式空响应（仅 [DONE]）→ 抛「缺 content」', async () => {
    mockFetchOnce(sseBody([]), { status: 200 })
    await expect(
      builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toThrow('builtinLlm 响应缺 content')
  })

  // rc9 实锤（2026-09-29）：老服务端未升级流式、忽略 stream:true，照 JSON {reply} 返回
  // （content-type: application/json）——前端按 SSE 解析一无所获报「缺 content」。
  // 修复：content-type 显式 application/json → 按旧格式一次性解析（新服务端 SSE 路径不变）。
  it('老服务端 JSON 回落：忽略 stream:true 返回 {reply} → 一次性解析成功（事件只发一次完整 content）', async () => {
    const reply = '{"answer":"老服务端回答（见 e1）","citedEntryIds":["e1","bogus"]}'
    mockFetchOnce(JSON.stringify({ reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const events: ChatStreamEvent[] = []
    const ans = await builtinLlm.answerChat(
      { question: 'q', cites, conversation: [] },
      (ev) => events.push(ev),
    )
    expect(ans).toEqual({ answer: '老服务端回答（见 e1）', citedEntryIds: ['e1'] })
    expect(events).toEqual([{ type: 'content', delta: reply }])
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
  })

  it('JSON 回落但 reply 缺失/非字符串 → 仍抛「缺 content」', async () => {
    mockFetchOnce(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
    await expect(
      builtinLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toThrow('builtinLlm 响应缺 content')
  })
})

describe('builtinLlm.answerChat 非流式分支（回归）', () => {
  it('不传 onEvent → 请求体无 stream 字段 + 旧 JSON reply 路径', async () => {
    mockFetchOnce(
      JSON.stringify({ reply: '{"answer":"旧路径回答","citedEntryIds":["e1"]}' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
    const ans = await builtinLlm.answerChat({ question: 'q', cites, conversation: [] })
    expect(ans).toEqual({ answer: '旧路径回答', citedEntryIds: ['e1'] })
    const body = JSON.parse(String(lastFetchInit().body)) as Record<string, unknown>
    expect(body.stream).toBeUndefined()
    expect(body.thinking).toBeUndefined()
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
  })
})
