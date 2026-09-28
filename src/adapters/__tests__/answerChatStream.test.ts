import { describe, it, expect, vi } from 'vitest'
import { openAiCompatLlm } from '@/adapters/openAiCompatLlm'
import type { ChatStreamEvent } from '@/ports'

// BYOK answerChat 流式分支（2026-09-28 问 AI 流式输出）：
// onEvent 存在 → stream:true + SSE 逐帧分流 reasoning_content/content；
// 收口与非流式一致（parseAnswerJson → sanitizeInlineCites → validIds 过滤）；
// 断流有部分内容宽容返回、无内容抛错；非流式分支逐字节不变（回归）。

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getSettings: vi.fn(async () => ({ llmUrl: 'https://example.com/v1/chat/completions', llmModel: 'test-model' })),
      listMemories: vi.fn(async () => []),
    },
    secrets: { get: vi.fn(async () => 'sk-test') },
  },
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

const lastFetchInit = (): RequestInit => {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1][1] as RequestInit
}

const cites = [
  { id: 'e1', createdAt: '2026-07-17T10:00:00+08:00', categorySlug: 'idea', tags: [], textExcerpt: '跑步时想到的' },
]

describe('openAiCompatLlm.answerChat 流式分支', () => {
  it('reasoning+content 混合帧：事件序列正确 + 最终结果与非流式一致', async () => {
    const frames = [
      delta({ reasoning_content: '用户在问跑步想法，' }),
      delta({ reasoning_content: '先看召回。' }),
      delta({}), // finish/空 delta 帧 → 无事件
      delta({ content: '{"answer": "你在跑步时' }),
      delta({ content: '想到产品形态（见 e1）", "citedEntryIds": ["e1", "bogus"]}' }),
    ]
    mockFetchOnce(sseBody(frames, { split: true }), { status: 200 })
    const events: ChatStreamEvent[] = []
    const ans = await openAiCompatLlm.answerChat(
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
  })

  it('流式分支请求体带 stream:true', async () => {
    mockFetchOnce(sseBody([delta({ content: '{"answer": "x", "citedEntryIds": []}' })]), { status: 200 })
    await openAiCompatLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {})
    const body = JSON.parse(String(lastFetchInit().body)) as Record<string, unknown>
    expect(body.stream).toBe(true)
  })

  it('坏 JSON 帧跳过，不毁整轮', async () => {
    const frames = [
      'not-json{{{',
      delta({ content: '{"answer": "好", "citedEntryIds": []}' }),
    ]
    mockFetchOnce(sseBody(frames), { status: 200 })
    const ans = await openAiCompatLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {})
    expect(ans).toEqual({ answer: '好', citedEntryIds: [] })
  })

  it('断流有部分内容 → 宽容解析返回部分答案（不抛错）', async () => {
    const stream = new ReadableStream({
      // 异步间隙模拟真实断流：已到达的 chunk 先交付 reader，再抛网络错误
      // （同步 enqueue+error 在 undici 下会丢已排队 chunk，是 mock 假象非真实行为）。
      async start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${delta({ content: '{"answer": "部分回答' })}\n\n`))
        await new Promise((r) => setTimeout(r, 10))
        c.error(new Error('network down'))
      },
    })
    mockFetchOnce(stream, { status: 200 })
    const ans = await openAiCompatLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {})
    expect(ans).toEqual({ answer: '部分回答', citedEntryIds: [] })
  })

  it('断流无任何内容 → 抛错走现有 error 路径', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.error(new Error('network down'))
      },
    })
    mockFetchOnce(stream, { status: 200 })
    await expect(
      openAiCompatLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toThrow('network down')
  })

  it('HTTP 错误 → 抛 LLM HTTP <status>', async () => {
    mockFetchOnce('server error', { status: 500 })
    await expect(
      openAiCompatLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toThrow('LLM HTTP 500')
  })

  it('响应无 body → 抛错', async () => {
    mockFetchOnce(null, { status: 200 })
    await expect(
      openAiCompatLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toThrow('body')
  })

  it('流式空响应（仅 [DONE]）→ 抛「缺 content」', async () => {
    mockFetchOnce(sseBody([]), { status: 200 })
    await expect(
      openAiCompatLlm.answerChat({ question: 'q', cites, conversation: [] }, () => {}),
    ).rejects.toThrow('LLM 响应缺 content')
  })
})

describe('openAiCompatLlm.answerChat 非流式分支（回归）', () => {
  it('不传 onEvent → 请求体无 stream 字段 + 旧 res.json 路径', async () => {
    mockFetchOnce(
      JSON.stringify({ choices: [{ message: { content: '{"answer":"旧路径回答","citedEntryIds":["e1"]}' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
    const ans = await openAiCompatLlm.answerChat({ question: 'q', cites, conversation: [] })
    expect(ans).toEqual({ answer: '旧路径回答', citedEntryIds: ['e1'] })
    const body = JSON.parse(String(lastFetchInit().body)) as Record<string, unknown>
    expect(body.stream).toBeUndefined()
  })
})
