// P-B（2026-10-03 spec §1）store 语义召回集成测试：
// 语义臂合并进 cites / embed 缺席·抛错防回归（与纯关键词逐字节一致）/ 问句向量 LRU /
// 惰性回填每轮 ≤20 / processEntry 成功后增量嵌。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatAnswer, ChatCite, ChatQuery, Conversation, Entry, EntryAi, EntryEmbedding } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  parseChatIntent: vi.fn(),
  answerChat: vi.fn(),
  extractMemory: vi.fn(),
  classify: vi.fn(),
  aggregate: vi.fn(),
  // null = di.llm 无 embed 方法（builtin 路径）——getter 透传，模拟方法缺席。
  embedFn: null as ((texts: string[]) => Promise<number[][] | null>) | null,
  listEmbeddings: vi.fn(),
  saveEmbedding: vi.fn(),
  getEntry: vi.fn(),
  saveEntry: vi.fn(),
  saveEntryAi: vi.fn(),
  conversations: [] as Conversation[],
}))

vi.mock('@/app/di', () => ({
  di: {
    llm: {
      parseChatIntent: (...a: unknown[]) => mocks.parseChatIntent(...a),
      answerChat: (...a: unknown[]) => mocks.answerChat(...a),
      extractMemory: (t: string) => mocks.extractMemory(t),
      classify: (...a: unknown[]) => mocks.classify(...a),
      aggregate: (...a: unknown[]) => mocks.aggregate(...a),
      // embed 缺席语义：embedFn=null 时 di.llm.embed 为 undefined（同 builtin 不实现）。
      get embed() {
        return mocks.embedFn ?? undefined
      },
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
      getEntry: (id: string) => mocks.getEntry(id),
      saveEntry: (e: Entry) => mocks.saveEntry(e),
      saveEntryAi: (a: EntryAi) => mocks.saveEntryAi(a),
      getSettings: vi.fn().mockResolvedValue({}),
      getAggregate: vi.fn().mockResolvedValue(undefined),
      saveAggregate: vi.fn().mockResolvedValue(undefined),
      listCategories: vi.fn().mockResolvedValue([]),
      listTags: vi.fn().mockResolvedValue([]),
      listAggregates: vi.fn().mockResolvedValue([]),
      purgeExpired: vi.fn().mockResolvedValue(0),
      listEntries: vi.fn().mockResolvedValue([]),
      listReminders: vi.fn().mockResolvedValue([]),
      listDrafts: vi.fn().mockResolvedValue([]),
      listTrashed: vi.fn().mockResolvedValue([]),
      listMemories: vi.fn().mockResolvedValue([]),
      getEntryAi: vi.fn().mockResolvedValue(undefined),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      getDraft: vi.fn().mockResolvedValue(undefined),
    },
    secrets: { get: vi.fn().mockResolvedValue(undefined) },
    stt: { transcribe: vi.fn().mockResolvedValue('') },
  },
}))

// localRecall 受控：默认返 cite e1；其余纯函数走真实实现（toCite 语义臂补造 cite 要用）。
const localRecallMock = vi.hoisted(() => vi.fn())
vi.mock('@/ui/screens/chat/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/screens/chat/helpers')>()
  return { ...actual, localRecall: (...a: unknown[]) => localRecallMock(...a) }
})

// embeddings 持久化：buildEmbeddingText/textHash 走真实实现，list/save 受控（不碰 IndexedDB）。
vi.mock('@/data/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/embeddings')>()
  return {
    ...actual,
    listEmbeddings: (...a: unknown[]) => mocks.listEmbeddings(...a),
    saveEmbedding: (...a: unknown[]) => mocks.saveEmbedding(...a),
  }
})

import { useUiStore } from '@/app/store'
import { queryVectorCache } from '@/app/semanticRecall'
import { buildEmbeddingText, textHash } from '@/data/embeddings'

const KW_CITE: ChatCite = {
  id: 'e1',
  createdAt: '2026-10-01T08:00:00+08:00',
  categorySlug: '',
  tags: [],
  textExcerpt: '关键词命中条目',
}

function mkEntry(id: string, content: string, updatedAt = '2026-10-01T08:00:00+08:00'): Entry {
  return {
    id,
    createdAt: '2026-10-01T08:00:00+08:00',
    updatedAt,
    status: 'ready',
    parts: [{ type: 'text', content }],
  }
}

function lastAnswerCites(): ChatCite[] {
  const calls = mocks.answerChat.mock.calls
  return (calls.at(-1)![0] as { cites: ChatCite[] }).cites
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.conversations.length = 0
  mocks.embedFn = null
  queryVectorCache.clear()
  useUiStore.setState({
    online: true,
    conversation: null,
    chatList: [],
    entries: [],
    aiByEntry: {},
    memories: [],
    hydrated: true,
  })
  mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['咖啡'], categorySlugs: undefined } as ChatQuery)
  mocks.answerChat.mockResolvedValue({ answer: '好的', citedEntryIds: [] } as ChatAnswer)
  mocks.extractMemory.mockResolvedValue(null)
  localRecallMock.mockReturnValue([KW_CITE])
  mocks.listEmbeddings.mockResolvedValue([])
  mocks.saveEmbedding.mockResolvedValue(undefined)
})

describe('防回归：embed 缺席/失败 → 与纯关键词召回逐字节一致', () => {
  it('di.llm 无 embed 方法 → cites 原样 = localRecall 结果，不查向量库', async () => {
    useUiStore.setState({ entries: [mkEntry('e1', '关键词命中条目')] })
    await useUiStore.getState().sendMessage('那家咖啡店叫什么-rr1')
    expect(lastAnswerCites()).toEqual([KW_CITE])
    expect(mocks.listEmbeddings).not.toHaveBeenCalled()
  })

  it('embed 抛错 → cites 原样，主流程不受影响', async () => {
    mocks.embedFn = vi.fn().mockRejectedValue(new Error('network down'))
    useUiStore.setState({ entries: [mkEntry('e1', '关键词命中条目')] })
    await useUiStore.getState().sendMessage('那家咖啡店叫什么-rr2')
    expect(lastAnswerCites()).toEqual([KW_CITE])
  })

  it('embed 返 null → cites 原样', async () => {
    mocks.embedFn = vi.fn().mockResolvedValue(null)
    useUiStore.setState({ entries: [mkEntry('e1', '关键词命中条目')] })
    await useUiStore.getState().sendMessage('那家咖啡店叫什么-rr3')
    expect(lastAnswerCites()).toEqual([KW_CITE])
  })
})

describe('语义臂合并', () => {
  it('语义新命中追加在关键词 cites 后（保序），trace.recalled 记录合并后列表', async () => {
    // 问句向量 [1,0]：e1 正交（sim=0 出局），e2 同向（sim=1 命中追加）。
    mocks.embedFn = vi.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])))
    mocks.listEmbeddings.mockResolvedValue([
      { entryId: 'e1', ownerId: 'local', vector: [0, 1], model: 'm', textHash: 'x', updatedAt: 't' },
      { entryId: 'e2', ownerId: 'local', vector: [1, 0], model: 'm', textHash: 'x', updatedAt: 't' },
    ] as EntryEmbedding[])
    useUiStore.setState({
      entries: [mkEntry('e1', '关键词命中条目'), mkEntry('e2', '街角那家手冲咖啡店')],
    })
    await useUiStore.getState().sendMessage('我记过的那家咖啡店-sa1')
    const cites = lastAnswerCites()
    expect(cites.map((c) => c.id)).toEqual(['e1', 'e2'])
    // 语义臂补造的 cite 走 toCite 同一压缩逻辑（excerpt 来自正文）。
    expect(cites[1].textExcerpt).toContain('街角那家手冲咖啡店')
    // trace.recalled 记录合并后列表
    const conv = mocks.conversations[0]
    const lastMsg = conv.messages.at(-1)!
    expect(lastMsg.trace?.recalled?.map((r) => r.id)).toEqual(['e1', 'e2'])
  })

  it('问句向量 LRU：同问（entries 签名变了绕过答案缓存）不再调 embed 问句', async () => {
    mocks.embedFn = vi.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])))
    useUiStore.setState({ entries: [mkEntry('e1', '关键词命中条目', '2026-10-01T08:00:00+08:00')] })
    await useUiStore.getState().sendMessage('同一句问题-lru1')
    // 改 entries 签名（updatedAt）→ chatAnswerCache 失效 → 召回重跑；问句向量应命中 LRU。
    useUiStore.setState({ entries: [mkEntry('e1', '关键词命中条目', '2026-10-02T08:00:00+08:00')] })
    await useUiStore.getState().sendMessage('同一句问题-lru1')
    const questionCalls = (mocks.embedFn as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[0] as string[]).length === 1 && (c[0] as string[])[0] === '同一句问题-lru1',
    )
    expect(questionCalls).toHaveLength(1)
  })
})

describe('惰性回填', () => {
  it('每轮最多 20 条，本轮不等（saveEmbedding ≤20 次）', async () => {
    mocks.embedFn = vi.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.5, 0.5])))
    const entries = Array.from({ length: 25 }, (_, i) => mkEntry(`b${i}`, `条目内容 ${i}`))
    useUiStore.setState({ entries })
    await useUiStore.getState().sendMessage('触发回填-bf1')
    await vi.waitFor(() => expect(mocks.saveEmbedding).toHaveBeenCalled())
    const embedCalls = (mocks.embedFn as ReturnType<typeof vi.fn>).mock.calls
    const batchCall = embedCalls.find((c) => (c[0] as string[]).length > 1)
    expect(batchCall).toBeTruthy()
    expect((batchCall![0] as string[]).length).toBeLessThanOrEqual(20)
    expect(mocks.saveEmbedding.mock.calls.length).toBeLessThanOrEqual(20)
  })

  it('已有新鲜向量（textHash+model 双键一致）的条目不重嵌', async () => {
    const e1 = mkEntry('e1', '关键词命中条目')
    const freshText = buildEmbeddingText(e1, undefined)
    mocks.embedFn = vi.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.5, 0.5])))
    mocks.listEmbeddings.mockResolvedValue([
      { entryId: 'e1', ownerId: 'local', vector: [1, 0], model: 'text-embedding-3-small', textHash: textHash(freshText), updatedAt: 't' },
    ] as EntryEmbedding[])
    useUiStore.setState({ entries: [e1] })
    await useUiStore.getState().sendMessage('不触发重嵌-bf2')
    // 等一拍让可能误发的回填暴露
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.saveEmbedding).not.toHaveBeenCalled()
  })
})

describe('processEntry 增量嵌', () => {
  it('classify 成功后 fire-and-forget 嵌该条目（embed 缺席则不嵌）', async () => {
    const e1 = mkEntry('e1', '今天跑了五公里')
    const ai1: EntryAi = {
      id: 'ai1', entryId: 'e1', version: 1, category: 'life', tags: ['run'], facets: {},
      summary: '跑步记录', modelUsed: 'm', createdAt: '2026-10-01',
    }
    mocks.getEntry.mockResolvedValue(e1)
    mocks.saveEntry.mockResolvedValue(undefined)
    mocks.saveEntryAi.mockResolvedValue(undefined)
    mocks.classify.mockResolvedValue(ai1)
    mocks.aggregate.mockResolvedValue({ id: 'ag1', scope: { type: 'day', range: '2026-10-01' }, summary: 's', entryIds: [], modelUsed: 'm', createdAt: 't', stale: false })
    mocks.embedFn = vi.fn().mockResolvedValue([[0.3, 0.4]])
    useUiStore.setState({ entries: [e1] })

    await useUiStore.getState().processEntry('e1', false)
    await vi.waitFor(() => expect(mocks.saveEmbedding).toHaveBeenCalled())
    const row = mocks.saveEmbedding.mock.calls[0][0] as EntryEmbedding
    expect(row.entryId).toBe('e1')
    expect(row.vector).toEqual([0.3, 0.4])
    // 被嵌文本含正文 + summary + tags（buildEmbeddingText 同一组装逻辑）
    const embedCalls = (mocks.embedFn as ReturnType<typeof vi.fn>).mock.calls
    expect((embedCalls[0][0] as string[])[0]).toContain('今天跑了五公里')
    expect((embedCalls[0][0] as string[])[0]).toContain('跑步记录')
  })

  it('embed 缺席 → processEntry 正常完成不嵌', async () => {
    const e1 = mkEntry('e1', '今天跑了五公里')
    mocks.getEntry.mockResolvedValue(e1)
    mocks.saveEntry.mockResolvedValue(undefined)
    mocks.saveEntryAi.mockResolvedValue(undefined)
    mocks.classify.mockResolvedValue({
      id: 'ai1', entryId: 'e1', version: 1, category: '', tags: [], facets: {}, modelUsed: 'm', createdAt: '2026-10-01',
    } as EntryAi)
    mocks.aggregate.mockResolvedValue({ id: 'ag1', scope: { type: 'day', range: '2026-10-01' }, summary: 's', entryIds: [], modelUsed: 'm', createdAt: 't', stale: false })
    useUiStore.setState({ entries: [e1] })
    await useUiStore.getState().processEntry('e1', false)
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.saveEmbedding).not.toHaveBeenCalled()
    expect(useUiStore.getState().entries[0].status).toBe('ready')
  })
})
