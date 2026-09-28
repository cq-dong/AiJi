import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { env } from '../env.js'
import { consumeQuota } from '../lib/quota.js'
import { errorJson } from '../lib/http.js'

const llm = new Hono<AppEnv>()

interface ChatMessage {
  role: string
  content: unknown
}

// content normalize：DeepSeek 只接受 string，不接受 image_url 数组。
// 前端 builtinLlm 的 content 可能是 string 或 [{type:'text',text}] 结构 → 抽 text 段拼接。
function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p
        if (p && typeof p === 'object' && 'text' in p) return String((p as { text: unknown }).text)
        return ''
      })
      .join('')
  }
  return ''
}

// SSE 字节透传（2026-09-28 问 AI 流式输出）：逐 chunk 原样转发上游字节。
// 中途断流：console.warn 记日志后优雅截尾（客户端走断流宽容路径，部分答案保留）；
// quota 已在响应头到达时计费，不回滚——服务端无法度量断流前实际消耗，按「次」计费语义。
function passthroughSse(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
        controller.close()
      } catch (e) {
        console.warn('[llm/chat] 流式上游中途断流（quota 不回滚，客户端获部分流）', e)
        controller.close()
      } finally {
        reader.releaseLock()
      }
    },
  })
}

// POST /api/llm/chat — 代理 DeepSeek，注入 key，扣 quota。
// body: {messages: ChatMessage[], opts?: {kind?: 'llm'|'agg'}, stream?: boolean, thinking?: boolean}
// kind='agg' 时双扣 llm+agg 各 1；否则只扣 llm 1。
// stream:true（默认 false，缺省行为逐字节不变）→ 上游 stream:true + SSE 原样透传；
// thinking:true（默认 false）→ 不带 thinking:{type:'disabled'}，用上游默认推理行为（答案轮思考模型）。
llm.post('/chat', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as {
    messages?: ChatMessage[]
    opts?: { kind?: string }
    stream?: boolean
    thinking?: boolean
  } | null
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return errorJson(c, 400, 'AUTH_400', 'messages 必填')
  }

  const kind = body?.opts?.kind === 'agg' ? 'agg' : 'llm'
  // 预扣 llm（原子事务，超限 429）
  if (!consumeQuota(userId, 'llm', 1)) {
    return errorJson(c, 429, 'AUTH_429', '今日 LLM 额度已用完')
  }
  if (kind === 'agg') {
    if (!consumeQuota(userId, 'agg', 1)) {
      // 回滚已扣的 llm
      consumeQuota(userId, 'llm', -1)
      return errorJson(c, 429, 'AUTH_429', '今日聚合额度已用完')
    }
  }

  const messages = body.messages.map((m) => ({ role: m.role, content: normalizeContent(m.content) }))
  const wantStream = body.stream === true
  const wantThinking = body.thinking === true
  try {
    const upstream = await fetch(`${env.deepseekBase}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.deepseekKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.deepseekModel,
        messages,
        // thinking 默认 disabled 跳推理模式（历史行为，与前端 openAiCompatLlm 一致）；
        // 客户端显式 thinking:true（流式答案轮）时不带此字段，用上游默认推理行为。
        ...(wantThinking ? {} : { thinking: { type: 'disabled' } }),
        stream: wantStream,
      }),
    })
    if (!upstream.ok) {
      // 回滚 quota
      consumeQuota(userId, 'llm', -1)
      if (kind === 'agg') consumeQuota(userId, 'agg', -1)
      // 不透传上游错误体（防泄露 key 上下文）
      return errorJson(c, 502, 'AUTH_502', 'LLM 上游服务异常')
    }
    if (wantStream) {
      if (!upstream.body) {
        consumeQuota(userId, 'llm', -1)
        if (kind === 'agg') consumeQuota(userId, 'agg', -1)
        return errorJson(c, 502, 'AUTH_502', 'LLM 返回格式异常')
      }
      // 流式透传：上游 SSE 字节原样转发。quota 语义——响应头到达即视为已计费
      // （上方预扣不回滚），中途断流不退费（见 passthroughSse 注释）。
      // X-Accel-Buffering: no 关 nginx 代理缓冲（不改 nginx 配置）。
      return c.body(passthroughSse(upstream.body), 200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
    }
    const data = await upstream.json() as { choices?: { message?: { content?: string } }[] }
    const reply = data?.choices?.[0]?.message?.content
    if (typeof reply !== 'string') {
      consumeQuota(userId, 'llm', -1)
      if (kind === 'agg') consumeQuota(userId, 'agg', -1)
      return errorJson(c, 502, 'AUTH_502', 'LLM 返回格式异常')
    }
    return c.json({ reply })
  } catch {
    consumeQuota(userId, 'llm', -1)
    if (kind === 'agg') consumeQuota(userId, 'agg', -1)
    return errorJson(c, 502, 'AUTH_502', 'LLM 上游网络异常')
  }
})

export default llm
