// P-B（2026-10-03 spec §2）滚动对话摘要 store 集成测试：
// 触发阈值（≤10 不触发 / 11 触发）/ 压缩区间不重叠最近 6 条 / summarizedCount 推进 /
// prior 并入 / extraSystem 注入 / 新会话重置 / 越界按 0 重算 / 失败仅 warn。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatAnswer, ChatCite, ChatMessage, ChatQuery, Conversation } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  parseChatIntent: vi.fn(),
  answerChat: vi.fn(),
  extractMemory: vi.fn(),
  summarizeConversation: vi.fn(),
  conversations: [] as Conversation[],
}))

vi.mock('@/app/di', () => ({
  di: {
    llm: {
      parseChatIntent: (...a: unknown[]) => mocks.parseChatIntent(...a),
      answerChat: (...a: unknown[]) => mocks.answerChat(...a),
      extractMemory: (t: string) => mocks.extractMemory(t),
      summarizeConversation: (...a: unknown[]) => mocks.summarizeConversation(...a),
      // 无 embed —— 语义臂不激活，隔离摘要路径测试。
    },
    storage: {
      saveConversation: async (c: Conversation) => {
        const i = mocks.conversations.findIndex((x) => x.id === c.id)
        if (i >= 0) mocks.conversations[i] = c
        else mocks.conversations.unshift(c)
      },
      listConversations: async () => [...mocks.conversations],
      getConversation: async (id: string) => mocks.conversations.find((c) => c.id === id),
      deleteConversation: async () => undefined,
      getSettings: vi.fn().mockResolvedValue({}),
      purgeExpired: vi.fn().mockResolvedValue(0),
      listEntries: vi.fn().mockResolvedValue([]),
      listCategories: vi.fn().mockResolvedValue([]),
      listTags: vi.fn().mockResolvedValue([]),
      listAggregates: vi.fn().mockResolvedValue([]),
      listReminders: vi.fn().mockResolvedValue([]),
      listDrafts: vi.fn().mockResolvedValue([]),
      listTrashed: vi.fn().mockResolvedValue([]),
      listMemories: vi.fn().mockResolvedValue([]),
      getEntryAi: vi.fn().mockResolvedValue(undefined),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      getDraft: vi.fn().mockResolvedValue(undefined),
    },
    secrets: { get: vi.fn().mockResolvedValue(undefined) },
  },
}))

// localRecall 返一条受控 cite（cites 非空 → 走 answer 轮）。
vi.mock('@/ui/screens/chat/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/screens/chat/helpers')>()
  return {
    ...actual,
    localRecall: (): ChatCite[] => [
      { id: 'e1', createdAt: '2026-10-01', categorySlug: '', tags: [], textExcerpt: '原文' },
    ],
  }
})

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'

// 造 N 条历史消息的会话（user/assistant 交替，content 带序号便于断言区间）。
function mkConv(n: number, extra?: Partial<Conversation>): Conversation {
  const messages: ChatMessage[] = Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `第${i}条`,
    createdAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00+08:00`,
  }))
  return { id: 'conv-sum', messages, updatedAt: '2026-10-01T10:00:00+08:00', ...extra }
}

function lastSavedConv(): Conversation {
  return mocks.conversations.find((c) => c.id === useUiStore.getState().conversation?.id) ?? mocks.conversations[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.conversations.length = 0
  setCurrentLang('zh') // node 环境 detectLang 落 en；摘要注入断言中文模板，显式固定 zh。
  useUiStore.setState({
    online: true,
    conversation: null,
    chatList: [],
    entries: [],
    aiByEntry: {},
    memories: [],
    hydrated: true,
  })
  mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: [], categorySlugs: undefined } as ChatQuery)
  mocks.answerChat.mockResolvedValue({ answer: '好的', citedEntryIds: [] } as ChatAnswer)
  mocks.extractMemory.mockResolvedValue(null)
  mocks.summarizeConversation.mockResolvedValue('压缩后的摘要')
})

describe('触发阈值与压缩区间', () => {
  it('≤10 条未压缩不触发（8 历史 + 本轮 2 = 10）', async () => {
    useUiStore.setState({ conversation: mkConv(8) })
    await useUiStore.getState().sendMessage('短对话不触发-rs1')
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.summarizeConversation).not.toHaveBeenCalled()
  })

  it('11 条触发：区间 [0, len-6) 不重叠最近 6 条，summarizedCount 推进', async () => {
    // 9 历史 + 本轮 2 = 11 条 → 触发；区间 [0, 5) → 第0..4条；summarizedCount=5。
    useUiStore.setState({ conversation: mkConv(9) })
    await useUiStore.getState().sendMessage('触发摘要-rs2')
    await vi.waitFor(() => expect(mocks.summarizeConversation).toHaveBeenCalled())
    const [prior, chunk] = mocks.summarizeConversation.mock.calls[0] as [
      string | null,
      { role: string; content: string; date?: string }[],
    ]
    expect(prior).toBeNull()
    expect(chunk.map((m) => m.content)).toEqual(['第0条', '第1条', '第2条', '第3条', '第4条'])
    // chunk 带 date（YYYY-MM-DD），与 chatHistory 同算法
    for (const m of chunk) expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await vi.waitFor(() => {
      const saved = lastSavedConv()
      expect(saved.rollingSummary).toBe('压缩后的摘要')
      expect(saved.summarizedCount).toBe(5)
    })
    // 最近 6 条原文未动（messages 只增不改，总数 11）
    expect(lastSavedConv().messages).toHaveLength(11)
  })

  it('prior 并入：已有摘要 + summarizedCount 从既有位置续压', async () => {
    // 12 历史 + 本轮 2 = 14；summarizedCount=2 → 区间 [2, 8) → 第2..7条；新 summarizedCount=8。
    useUiStore.setState({ conversation: mkConv(12, { rollingSummary: '旧摘要', summarizedCount: 2 }) })
    await useUiStore.getState().sendMessage('续压-rs3')
    await vi.waitFor(() => expect(mocks.summarizeConversation).toHaveBeenCalled())
    const [prior, chunk] = mocks.summarizeConversation.mock.calls[0] as [
      string | null,
      { content: string }[],
    ]
    expect(prior).toBe('旧摘要')
    expect(chunk.map((m) => m.content)).toEqual(['第2条', '第3条', '第4条', '第5条', '第6条', '第7条'])
    await vi.waitFor(() => {
      expect(lastSavedConv().rollingSummary).toBe('压缩后的摘要')
      expect(lastSavedConv().summarizedCount).toBe(8)
    })
  })

  it('summarizedCount 越界（> messages.length）按 0 重算', async () => {
    // 12 历史 + 本轮 2 = 14；summarizedCount=99 越界 → start=0 → 区间 [0, 8)。
    useUiStore.setState({ conversation: mkConv(12, { summarizedCount: 99 }) })
    await useUiStore.getState().sendMessage('越界重算-rs4')
    await vi.waitFor(() => expect(mocks.summarizeConversation).toHaveBeenCalled())
    const chunk = mocks.summarizeConversation.mock.calls[0][1] as { content: string }[]
    expect(chunk).toHaveLength(8)
    expect(chunk[0].content).toBe('第0条')
  })

  it('摘要失败仅 console.warn，不影响问答主流程', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.summarizeConversation.mockRejectedValue(new Error('llm down'))
    useUiStore.setState({ conversation: mkConv(9) })
    await useUiStore.getState().sendMessage('摘要失败-rs5')
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    // 问答照常完成：答案已落库，rollingSummary 未置
    const saved = lastSavedConv()
    expect(saved.messages.at(-1)!.content).toBe('好的')
    expect(saved.rollingSummary).toBeUndefined()
    warn.mockRestore()
  })
})

describe('注入与新会话重置', () => {
  it('有 rollingSummary 时 extraSystem 注入「早前对话摘要：…」段', async () => {
    useUiStore.setState({ conversation: mkConv(2, { rollingSummary: '我们聊过跑步和咖啡' }) })
    await useUiStore.getState().sendMessage('摘要注入-rs6')
    const opts = mocks.answerChat.mock.calls.at(-1)![0] as { extraSystem?: string }
    expect(opts.extraSystem).toContain('早前对话摘要：我们聊过跑步和咖啡')
  })

  it('无 rollingSummary 时 extraSystem 不注入摘要段', async () => {
    useUiStore.setState({ conversation: mkConv(2) })
    await useUiStore.getState().sendMessage('无摘要-rs7')
    const opts = mocks.answerChat.mock.calls.at(-1)![0] as { extraSystem?: string }
    expect(opts.extraSystem ?? '').not.toContain('早前对话摘要')
  })

  it('newConversation 后新会话两字段清空（不带旧摘要）', async () => {
    useUiStore.setState({ conversation: mkConv(2, { rollingSummary: '旧摘要', summarizedCount: 3 }) })
    useUiStore.getState().newConversation()
    await useUiStore.getState().sendMessage('新会话-rs8')
    const saved = lastSavedConv()
    expect(saved.id).not.toBe('conv-sum')
    expect(saved.rollingSummary).toBeUndefined()
    expect(saved.summarizedCount).toBeUndefined()
    // 新会话本轮也不该调摘要（条数远不足）
    expect(mocks.summarizeConversation).not.toHaveBeenCalled()
  })
})
