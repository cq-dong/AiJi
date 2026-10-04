// W0（2026-10-04）orphan embeddings 惰性 GC store 层集成测试：
// embeddings 表无 delete 挂点（deleteEntry/trashEntry/hydrate purge 均不触），向量行永久残留。
// 修复：withSemanticArm 在 listEmbeddings 后按 entryIds 过滤时顺带发现残留行，fire-and-forget
// 调 deleteStaleEmbeddings 清掉（不阻塞召回主路径，失败静默）。本文件不 mock @/data/embeddings
// ——真实 helpers 落 fake-indexeddb，端到端断言残留行真的被清。
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { ChatAnswer, ChatCite, ChatQuery, Conversation, Entry, EntryAi } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  parseChatIntent: vi.fn(),
  answerChat: vi.fn(),
  extractMemory: vi.fn(),
  classify: vi.fn(),
  aggregate: vi.fn(),
  // null = di.llm 无 embed 方法（builtin 路径）——getter 透传，模拟方法缺席。
  embedFn: null as ((texts: string[]) => Promise<number[][] | null>) | null,
  getSettings: vi.fn(),
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
      getSettings: () => mocks.getSettings(),
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

// localRecall 受控：默认返 cite A；其余纯函数走真实实现。
const localRecallMock = vi.hoisted(() => vi.fn())
vi.mock('@/ui/screens/chat/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/screens/chat/helpers')>()
  return { ...actual, localRecall: (...a: unknown[]) => localRecallMock(...a) }
})

import { useUiStore } from '@/app/store'
import { db } from '@/data/db'
import { buildEmbeddingText, textHash } from '@/data/embeddings'
import { queryVectorCache } from '@/app/semanticRecall'
import { setCurrentOwner } from '@/app/currentOwner'

const KW_CITE: ChatCite = {
  id: 'A',
  createdAt: '2026-10-01T08:00:00+08:00',
  categorySlug: '',
  tags: [],
  textExcerpt: '关键词命中条目',
}

function mkEntry(id: string, content: string): Entry {
  return {
    id,
    createdAt: '2026-10-01T08:00:00+08:00',
    updatedAt: '2026-10-01T08:00:00+08:00',
    status: 'ready',
    parts: [{ type: 'text', content }],
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.conversations.length = 0
  mocks.embedFn = null
  queryVectorCache.clear()
  setCurrentOwner('local')
  db.close()
  await Dexie.delete('aiji')
  await db.open()
  useUiStore.setState({
    online: true,
    conversation: null,
    chatList: [],
    entries: [],
    aiByEntry: {} as Record<string, EntryAi>,
    memories: [],
    hydrated: true,
  })
  mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['咖啡'], categorySlugs: undefined } as ChatQuery)
  mocks.answerChat.mockResolvedValue({ answer: '好的', citedEntryIds: [] } as ChatAnswer)
  mocks.extractMemory.mockResolvedValue(null)
  localRecallMock.mockReturnValue([KW_CITE])
  mocks.getSettings.mockResolvedValue({})
})

afterEach(() => {
  db.close()
})

describe('withSemanticArm 惰性 GC（W0）', () => {
  it('entries 只含 A、embeddings 含 A+B 两行 → 语义召回后 B 残留行被清，召回主路径不受影响', async () => {
    const entryA = mkEntry('A', '关键词命中条目')
    // A 行 textHash+model 双键新鲜 → 惰性回填不动它（隔离 GC 断言，防回填写行干扰计数）。
    const freshText = buildEmbeddingText(entryA, undefined)
    await db.embeddings.bulkPut([
      { entryId: 'A', ownerId: 'local', vector: [1, 0], model: 'text-embedding-3-small', textHash: textHash(freshText), updatedAt: 't' },
      // B：条目已删/已清的残留向量行——应当被 GC 掉。
      { entryId: 'B', ownerId: 'local', vector: [1, 0], model: 'text-embedding-3-small', textHash: 'orphan', updatedAt: 't' },
    ])
    mocks.embedFn = vi.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])))
    useUiStore.setState({ entries: [entryA] })

    await useUiStore.getState().sendMessage('那家咖啡店叫什么-gc1')

    // 召回主路径正常完成（GC 是 fire-and-forget，不阻塞回答）。
    expect(mocks.answerChat).toHaveBeenCalled()
    // GC 完成后：B 行被清，A 行保留。
    await vi.waitFor(async () => {
      const ids = (await db.embeddings.toArray()).map((r) => r.entryId)
      expect(ids).toEqual(['A'])
    })
  })
})
