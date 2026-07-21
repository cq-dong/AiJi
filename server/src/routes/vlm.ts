import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { env } from '../env.js'
import { consumeQuota } from '../lib/quota.js'
import { errorJson } from '../lib/http.js'

const vlm = new Hono<AppEnv>()

interface ChatMessage {
  role: string
  content: unknown
}

// DashScope compatible-mode 返回的 content 可能是 string 或
// [{type:'text',text:string}, ...] 数组形态 → 拼接其中 text 段。
function extractReply(content: unknown): string {
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

// POST /api/vlm/chat — 代理 DashScope 多模态（qwen-vl），注入 key，扣 llm quota。
// body: {messages: ChatMessage[]}（messages 原样透传，含 image_url 多模态 content 数组）
// 计入 LLM 额度（产品已定，与 builtinLlm.classify 附图调用一致）。
vlm.post('/chat', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as { messages?: ChatMessage[] } | null
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return errorJson(c, 400, 'AUTH_400', 'messages 必填')
  }

  // 预扣 llm（原子事务，超限 429；-1=无限）
  if (!consumeQuota(userId, 'llm', 1)) {
    return errorJson(c, 429, 'AUTH_429', '今日 LLM 额度已用完')
  }

  // messages 原样透传（含 image_url 多模态数组，DashScope compatible-mode 支持）
  const messages = body.messages.map((m) => ({ role: m.role, content: m.content }))
  try {
    const upstream = await fetch(`${env.dashscopeBase}/compatible-mode/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.dashscopeKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.vlmModel,
        messages,
        max_tokens: 1024,
        temperature: 0.3,
        stream: false,
      }),
    })
    if (!upstream.ok) {
      // 回滚 quota；不透传上游错误体（防 key 侧信息泄露）
      consumeQuota(userId, 'llm', -1)
      return errorJson(c, 502, `VLM_${upstream.status}`, 'VLM 上游服务异常')
    }
    const data = await upstream.json() as { choices?: { message?: { content?: unknown } }[] }
    const reply = extractReply(data?.choices?.[0]?.message?.content)
    if (!reply) {
      consumeQuota(userId, 'llm', -1)
      return errorJson(c, 502, 'VLM_502', 'VLM 返回格式异常')
    }
    return c.json({ reply })
  } catch {
    consumeQuota(userId, 'llm', -1)
    return errorJson(c, 502, 'VLM_502', 'VLM 上游网络异常')
  }
})

export default vlm
