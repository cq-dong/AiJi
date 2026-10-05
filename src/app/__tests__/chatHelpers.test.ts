// E2（2026-10-05 store 拆分一阶）新模块单测：chatHelpers 纯函数直测。
// withSemanticArm / maybeRollSummary 已由 storeRollingSummary / storeEmbeddingGc 集成覆盖，
// 本文件只钉纯函数契约（cacheKey/ensure/append/strip/date/chatHistory/seq 访问器）。
import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage, Conversation, Entry } from '@/domain/types'
import { dateKey } from '@/ui/screens/chat/helpers'

// chatHelpers 对 di 的运行时引用只存在于 withSemanticArm/backfillEmbeddings/embedEntryNow/
// maybeRollSummary（本文件不调）；mock 掉避免加载真实适配器图。
vi.mock('@/app/di', () => ({ di: {} }))

import {
  CHAT_HISTORY_WINDOW,
  chatCacheKey,
  formatDueShort,
  ensureConversation,
  appendMessage,
  stripLeadingDatePrefix,
  stripStreamingFlags,
  chatHistory,
  nextChatSendSeq,
  currentChatSendSeq,
} from '@/app/chatHelpers'

function msg(id: string, createdAt = '2026-10-05T10:00:00.000Z', patch?: Partial<ChatMessage>): ChatMessage {
  return { id, role: 'user', content: `c-${id}`, createdAt, ...patch }
}

describe('chatCacheKey', () => {
  it('问题 trim + 小写归一；空条目集签名 0:', () => {
    expect(chatCacheKey('  Hello World  ', [])).toBe('hello world::0:')
    expect(chatCacheKey('hello world', [])).toBe(chatCacheKey(' HELLO WORLD ', []))
  })

  it('条目签名 = 数量 + 首条 updatedAt', () => {
    const e = { updatedAt: '2026-10-01T00:00:00.000Z' } as unknown as Entry
    expect(chatCacheKey('q', [e])).toBe('q::1:2026-10-01T00:00:00.000Z')
  })
})

describe('formatDueShort', () => {
  it('输出 M/D HH:MM（时分零填充）', () => {
    // 本地时区构造 2026-01-05 07:09，经 ISO 往返仍还原本地墙钟。
    const iso = new Date(2026, 0, 5, 7, 9).toISOString()
    expect(formatDueShort(iso)).toBe('1/5 07:09')
  })
})

describe('ensureConversation', () => {
  it('null → 新空会话（uuid/空 messages/ISO updatedAt）；非 null 原样透传', () => {
    const c = ensureConversation(null)
    expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(c.messages).toEqual([])
    expect(Number.isNaN(Date.parse(c.updatedAt))).toBe(false)
    const existing: Conversation = { id: 'c1', messages: [], updatedAt: '2026-01-01T00:00:00.000Z' }
    expect(ensureConversation(existing)).toBe(existing)
  })
})

describe('appendMessage', () => {
  it('追加消息 + updatedAt 取消息 createdAt；不改原会话', () => {
    const base: Conversation = { id: 'c1', messages: [msg('m1')], updatedAt: 't0' }
    const m2 = msg('m2', '2026-10-05T12:00:00.000Z')
    const next = appendMessage(base, m2)
    expect(next.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(next.updatedAt).toBe(m2.createdAt)
    expect(base.messages).toHaveLength(1)
    expect(base.updatedAt).toBe('t0')
  })
})

describe('stripLeadingDatePrefix', () => {
  it('只 strip 开头一处 [YYYY-MM-DD]（含前导空白），正文中间引用不动', () => {
    expect(stripLeadingDatePrefix('[2026-09-29] 正文')).toBe('正文')
    expect(stripLeadingDatePrefix('  [2026-09-29]  正文')).toBe('正文')
    expect(stripLeadingDatePrefix('正文 [2026-09-29] 引用')).toBe('正文 [2026-09-29] 引用')
    expect(stripLeadingDatePrefix('正文')).toBe('正文')
  })
})

describe('stripStreamingFlags', () => {
  it('无 streaming → 原引用返回（零分配）', () => {
    const conv: Conversation = { id: 'c', messages: [msg('a')], updatedAt: 't' }
    expect(stripStreamingFlags(conv)).toBe(conv)
  })

  it('有 streaming → 抹 false；非 streaming 消息对象不动；原会话不改', () => {
    const conv: Conversation = {
      id: 'c',
      messages: [msg('a'), msg('b', '2026-10-05T10:01:00.000Z', { streaming: true })],
      updatedAt: 't',
    }
    const stripped = stripStreamingFlags(conv)
    expect(stripped).not.toBe(conv)
    expect(stripped.messages[1].streaming).toBe(false)
    expect(stripped.messages[0]).toBe(conv.messages[0])
    expect(conv.messages[1].streaming).toBe(true)
  })
})

describe('chatHistory', () => {
  const conv: Conversation = {
    id: 'c',
    messages: [
      msg('m1', '2026-10-01T08:00:00.000Z'),
      msg('m2', '2026-10-02T08:00:00.000Z', { error: true }),
      msg('m3', '2026-10-03T08:00:00.000Z', { role: 'assistant' }),
      msg('m4', '2026-10-04T08:00:00.000Z'),
    ],
    updatedAt: 't',
  }

  it('null → 空数组', () => {
    expect(chatHistory(null, CHAT_HISTORY_WINDOW)).toEqual([])
  })

  it('过滤 error 消息 + 每条带本地日键 date', () => {
    const h = chatHistory(conv, CHAT_HISTORY_WINDOW)
    expect(h.map((x) => x.content)).toEqual(['c-m1', 'c-m3', 'c-m4'])
    expect(h.map((x) => x.role)).toEqual(['user', 'assistant', 'user'])
    expect(h[0].date).toBe(dateKey('2026-10-01T08:00:00.000Z'))
  })

  it('窗口截断：只取最近 limit 条（在 error 过滤之后）', () => {
    const h = chatHistory(conv, 2)
    expect(h.map((x) => x.content)).toEqual(['c-m3', 'c-m4'])
  })

  it('CHAT_HISTORY_WINDOW = 6（滑动窗 token 预算契约）', () => {
    expect(CHAT_HISTORY_WINDOW).toBe(6)
  })
})

describe('chatSendSeq 访问器', () => {
  it('nextChatSendSeq 单调递增；currentChatSendSeq 读最新值', () => {
    const a = currentChatSendSeq()
    const b = nextChatSendSeq()
    expect(b).toBe(a + 1)
    expect(currentChatSendSeq()).toBe(b)
    expect(nextChatSendSeq()).toBe(b + 1)
    expect(currentChatSendSeq()).toBe(b + 1)
  })
})
