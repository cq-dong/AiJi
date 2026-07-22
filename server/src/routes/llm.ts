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

// POST /api/llm/chat — 代理 DeepSeek，注入 key，扣 quota。
// body: {messages: ChatMessage[], opts?: {kind?: 'llm'|'agg'}}
// kind='agg' 时双扣 llm+agg 各 1；否则只扣 llm 1。
llm.post('/chat', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as { messages?: ChatMessage[]; opts?: { kind?: string } } | null
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
        // thinking disabled 跳推理模式（与前端 openAiCompatLlm 一致）
        thinking: { type: 'disabled' },
        stream: false,
      }),
    })
    if (!upstream.ok) {
      // 回滚 quota
      consumeQuota(userId, 'llm', -1)
      if (kind === 'agg') consumeQuota(userId, 'agg', -1)
      // 不透传上游错误体（防泄露 key 上下文）
      return errorJson(c, 502, 'AUTH_502', 'LLM 上游服务异常')
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
