import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'

// /api/llm/chat 流式透传（2026-09-28 问 AI 流式输出）：
// - 缺省（无 stream 字段）行为逐字节不变（回归）；
// - stream:true → 上游 body stream:true + SSE 原样透传 + X-Accel-Buffering:no；
// - thinking:true → 上游 body 不带 thinking:{type:'disabled'}；
// - quota 语义：响应头到达即计费，中途断流不回滚；上游非 OK 仍回滚。
// env/quota 走 mock（不碰真实密钥/DB）；上游 DeepSeek 用全局 fetch mock。

const { consumeQuotaFn } = vi.hoisted(() => ({ consumeQuotaFn: vi.fn(() => true) }))

vi.mock('../env.js', () => ({
  env: {
    deepseekBase: 'https://ds.example/v1',
    deepseekKey: 'sk-test',
    deepseekModel: 'test-model',
  },
}))
vi.mock('../lib/quota.js', () => ({ consumeQuota: consumeQuotaFn }))

import llm from './llm.js'

function makeApp() {
  const app = new Hono<AppEnv>()
  // 模拟 authMiddleware：注入 userId
  app.use('*', async (c, next) => {
    c.set('userId', 'u1')
    await next()
  })
  app.route('/api/llm', llm)
  return app
}

function post(body: unknown) {
  return makeApp().request('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const chatBody = { messages: [{ role: 'user', content: 'hi' }] }

function mockUpstream(res: Response) {
  globalThis.fetch = vi.fn(async () => res) as never
}

function upstreamBody(): Record<string, unknown> {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  return JSON.parse(String(calls[calls.length - 1][1]?.body)) as Record<string, unknown>
}

function jsonUpstream(reply: string, status = 200) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: reply } }] }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

function sseUpstream(text: string, status = 200) {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(bytes)
        c.close()
      },
    }),
    { status },
  )
}

const SSE_TEXT =
  'data: {"choices":[{"delta":{"content":"{\\"answer\\": \\"你"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"好\\", \\"citedEntryIds\\": []}"}}]}\n\n' +
  'data: [DONE]\n\n'

beforeEach(() => {
  vi.clearAllMocks()
  consumeQuotaFn.mockReturnValue(true)
})

describe('POST /api/llm/chat 非流式（回归：缺省行为不变）', () => {
  it('缺省 body → 上游 stream:false + thinking disabled；响应 {reply}；quota 扣 1 不回滚', async () => {
    mockUpstream(jsonUpstream('你好'))
    const res = await post(chatBody)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: '你好' })
    const up = upstreamBody()
    expect(up.stream).toBe(false)
    expect(up.thinking).toEqual({ type: 'disabled' })
    expect(consumeQuotaFn).toHaveBeenCalledWith('u1', 'llm', 1)
    expect(consumeQuotaFn).not.toHaveBeenCalledWith('u1', 'llm', -1)
  })

  it('显式 stream:false → 仍走非流式 JSON 路径', async () => {
    mockUpstream(jsonUpstream('旧路径'))
    const res = await post({ ...chatBody, stream: false, thinking: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: '旧路径' })
    const up = upstreamBody()
    expect(up.stream).toBe(false)
    // thinking:true 生效与 stream 无关：不带 disabled
    expect('thinking' in up).toBe(false)
  })

  it('quota 耗尽 → 429（不调上游）', async () => {
    consumeQuotaFn.mockReturnValue(false)
    mockUpstream(jsonUpstream('x'))
    const res = await post(chatBody)
    expect(res.status).toBe(429)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('上游非 OK → 502 + quota 回滚', async () => {
    mockUpstream(new Response('boom', { status: 500 }))
    const res = await post(chatBody)
    expect(res.status).toBe(502)
    expect(consumeQuotaFn).toHaveBeenCalledWith('u1', 'llm', -1)
  })
})

describe('POST /api/llm/chat 流式透传（stream:true）', () => {
  it('上游收到 stream:true；响应头 SSE + X-Accel-Buffering:no；字节原样透传', async () => {
    mockUpstream(sseUpstream(SSE_TEXT))
    const res = await post({ ...chatBody, stream: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')
    expect(upstreamBody().stream).toBe(true)
    // 原样透传：响应体与上游 SSE 字节逐字节一致
    expect(await res.text()).toBe(SSE_TEXT)
  })

  it('stream:true 缺省 thinking → 上游仍带 thinking disabled（默认禁推理）', async () => {
    mockUpstream(sseUpstream(SSE_TEXT))
    await post({ ...chatBody, stream: true })
    expect(upstreamBody().thinking).toEqual({ type: 'disabled' })
  })

  it('stream:true + thinking:true → 上游 body 不带 thinking 字段（用上游默认推理）', async () => {
    mockUpstream(sseUpstream(SSE_TEXT))
    await post({ ...chatBody, stream: true, thinking: true })
    const up = upstreamBody()
    expect('thinking' in up).toBe(false)
    expect(up.stream).toBe(true)
  })

  it('上游非 OK → 502 + quota 回滚（流式分支同非流式）', async () => {
    mockUpstream(new Response('upstream boom', { status: 502 }))
    const res = await post({ ...chatBody, stream: true })
    expect(res.status).toBe(502)
    expect(consumeQuotaFn).toHaveBeenCalledWith('u1', 'llm', -1)
  })

  it('中途断流 → 已收字节保留 + 优雅截尾；quota 不回滚（响应头到达即计费）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const partial = 'data: {"choices":[{"delta":{"content":"{\\"answer\\": \\"部分"}}]}\n\n'
    const stream = new ReadableStream({
      // 异步间隙模拟真实断流：已到达 chunk 先交付，再抛网络错误
      async start(c) {
        c.enqueue(new TextEncoder().encode(partial))
        await new Promise((r) => setTimeout(r, 10))
        c.error(new Error('network down'))
      },
    })
    mockUpstream(new Response(stream, { status: 200 }))
    const res = await post({ ...chatBody, stream: true })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(partial)
    expect(consumeQuotaFn).not.toHaveBeenCalledWith('u1', 'llm', -1)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
