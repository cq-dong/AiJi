import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatAnswer, ChatQuery, Conversation } from '@/domain/types'

// ── Mocks ───────────────────────────────────────────────────────────────────
// backing conversations[] 模拟 Dexie conversations 表：saveConversation upsert、
// getConversation 查、deleteConversation 删、listConversations 按 updatedAt 倒序。
// store.refreshChatList 调 listConversations 后过滤 messages.length===0 → chatList。
// 其余 storage 方法给空默认（hydrate 路径不爆）。localRecall 返一条受控 cite。

const mocks = vi.hoisted(() => ({
  parseChatIntent: vi.fn(),
  answerChat: vi.fn(),
  extractMemory: vi.fn(),
  saveConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
  conversations: [] as Conversation[],
}))

function upsert(arr: Conversation[], c: Conversation): void {
  const i = arr.findIndex((x) => x.id === c.id)
  if (i >= 0) arr[i] = c
  else arr.unshift(c)
}

vi.mock('@/app/di', () => ({
  di: {
    llm: {
      parseChatIntent: (...a: unknown[]) => mocks.parseChatIntent(...a),
      answerChat: (...a: unknown[]) => mocks.answerChat(...a),
      extractMemory: (t: string) => mocks.extractMemory(t),
    },
    storage: {
      // conversation 族：受控，读写 backing 数组
      saveConversation: async (c: Conversation) => {
        mocks.saveConversation(c)
        upsert(mocks.conversations, c)
      },
      getConversation: async (id: string) => {
        mocks.getConversation(id)
        return mocks.conversations.find((c) => c.id === id)
      },
      listConversations: async () => {
        mocks.listConversations()
        return [...mocks.conversations].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
      },
      deleteConversation: async (id: string) => {
        mocks.deleteConversation(id)
        const i = mocks.conversations.findIndex((c) => c.id === id)
        if (i >= 0) mocks.conversations.splice(i, 1)
      },
      // 其余 storage 方法：空默认（hydrate 全量载入路径不爆）
      purgeExpired: vi.fn().mockResolvedValue(0),
      listEntries: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({}),
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
  },
}))

// localRecall：返一条受控 cite（cites.length>0 → answerChat 被调，不走空 cites 裸答）。
vi.mock('@/ui/screens/chat/helpers', () => ({
  localRecall: () => [
    { id: 'e1', createdAt: '2026-07-22', categorySlug: 'idea', tags: [], textExcerpt: '原文' },
  ],
}))

import { useUiStore } from '@/app/store'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.conversations.length = 0 // 原地清空，mock 闭包仍引用同一数组
  // online=true（避免离线早返）；conversation/chatList 清空；entries=[]（cache key 稳定）。
  useUiStore.setState({
    online: true,
    conversation: null,
    chatList: [],
    entries: [],
    memories: [],
    hydrated: true,
  })
  mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: [], categorySlugs: undefined } as ChatQuery)
  mocks.answerChat.mockResolvedValue({ answer: '好的', citedEntryIds: [] } as ChatAnswer)
  mocks.extractMemory.mockResolvedValue(null)
})

// chatAnswerCache 是 store.ts 模块级 Map，跨用例持久。各用例用不同问题串避免缓存命中。

describe('store chat history（多会话）', () => {
  it('sendMessage 首条 → saveConversation 收到 uuid id（非 "1"）且 chatList 含该会话', async () => {
    await useUiStore.getState().sendMessage('随便问点什么-h1')

    expect(mocks.saveConversation).toHaveBeenCalled()
    const saved = mocks.saveConversation.mock.calls.at(-1)![0] as Conversation
    expect(saved.id).not.toBe('1')
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // chatList 含该会话（refreshChatList 是 fire-and-forget，waitFor 轮询）
    await vi.waitFor(() => {
      expect(useUiStore.getState().chatList.some((c) => c.id === saved.id)).toBe(true)
    })
  })

  it('已有会话 A → newConversation() → conversation=null 且 A 仍在 chatList；再 sendMessage → 新 uuid 行 ≠ A.id', async () => {
    await useUiStore.getState().sendMessage('建立会话A-h2')
    const convA = useUiStore.getState().conversation!
    expect(convA.messages.length).toBeGreaterThan(0)
    await vi.waitFor(() => {
      expect(useUiStore.getState().chatList.some((c) => c.id === convA.id)).toBe(true)
    })

    // newConversation → conversation=null，A 仍在 chatList（newConversation 不刷列表）
    useUiStore.getState().newConversation()
    expect(useUiStore.getState().conversation).toBeNull()
    expect(useUiStore.getState().chatList.some((c) => c.id === convA.id)).toBe(true)

    // 再 sendMessage → 新 uuid 行 ≠ A.id
    await useUiStore.getState().sendMessage('新会话首条-h3')
    const convB = useUiStore.getState().conversation!
    expect(convB.id).not.toBe(convA.id)
    expect(convB.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('loadConversation(A.id) → conversation=A；loadConversation(不存在) → noop', async () => {
    await useUiStore.getState().sendMessage('建立会话A-h4')
    const convA = useUiStore.getState().conversation!
    // 腾空当前，再 loadConversation(A)
    useUiStore.getState().newConversation()
    expect(useUiStore.getState().conversation).toBeNull()

    await useUiStore.getState().loadConversation(convA.id)
    expect(useUiStore.getState().conversation?.id).toBe(convA.id)

    // loadConversation 不存在 → conversation 不变（静默 noop）
    await useUiStore.getState().loadConversation('不存在的id')
    expect(useUiStore.getState().conversation?.id).toBe(convA.id)
  })

  it('deleteChatConversation(当前 id) → conversation=null + 列表剔除；deleteChatConversation(非当前 id) → 当前不变 + 列表剔除', async () => {
    // 建两个会话 A、B
    await useUiStore.getState().sendMessage('会话A-h5')
    const convA = useUiStore.getState().conversation!
    useUiStore.getState().newConversation()
    await useUiStore.getState().sendMessage('会话B-h6')
    const convB = useUiStore.getState().conversation!
    await vi.waitFor(() => {
      expect(useUiStore.getState().chatList.length).toBe(2)
    })

    // 删非当前（A）：当前 B 不变，列表剔除 A
    await useUiStore.getState().deleteChatConversation(convA.id)
    expect(useUiStore.getState().conversation?.id).toBe(convB.id)
    expect(useUiStore.getState().chatList.some((c) => c.id === convA.id)).toBe(false)
    expect(useUiStore.getState().chatList.some((c) => c.id === convB.id)).toBe(true)

    // 删当前（B）：conversation=null，列表剔除 B
    await useUiStore.getState().deleteChatConversation(convB.id)
    expect(useUiStore.getState().conversation).toBeNull()
    expect(useUiStore.getState().chatList.some((c) => c.id === convB.id)).toBe(false)
  })

  it('空会话（messages=[]）不进 chatList（refreshChatList 过滤）', async () => {
    // 直接往 backing store 塞一个空会话 + 一个有消息的会话
    const empty: Conversation = { id: 'empty-1', messages: [], updatedAt: '2026-07-22T00:00:00.000Z' }
    const full: Conversation = {
      id: 'full-1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: '2026-07-22T00:00:00.000Z' }],
      updatedAt: '2026-07-22T00:00:01.000Z',
    }
    mocks.conversations.push(empty, full)

    await useUiStore.getState().refreshChatList()
    const list = useUiStore.getState().chatList
    expect(list.some((c) => c.id === 'empty-1')).toBe(false)
    expect(list.some((c) => c.id === 'full-1')).toBe(true)
  })

  it('hydrate → chatList 载入 + conversation=最近一条（updatedAt 最大）', async () => {
    // backing store 塞两条会话，newer updatedAt 更大 → chatList[0]
    const older: Conversation = {
      id: 'old-1',
      messages: [{ id: 'mo', role: 'user', content: 'old', createdAt: '2026-07-20T00:00:00.000Z' }],
      updatedAt: '2026-07-20T00:00:00.000Z',
    }
    const newer: Conversation = {
      id: 'new-1',
      messages: [{ id: 'mn', role: 'user', content: 'new', createdAt: '2026-07-22T00:00:00.000Z' }],
      updatedAt: '2026-07-22T00:00:00.000Z',
    }
    mocks.conversations.push(older, newer)

    // hydrate 守卫：重置 hydrated=false 让 hydrate 跑全量
    useUiStore.setState({ hydrated: false, conversation: null, chatList: [] })
    await useUiStore.getState().hydrate()

    const { chatList, conversation } = useUiStore.getState()
    expect(chatList.length).toBe(2)
    expect(chatList[0].id).toBe('new-1') // 倒序：最近在上
    expect(conversation?.id).toBe('new-1') // 续聊最近一条
  })
})
