import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ChatAnswer, ChatQuery, Conversation } from '@/domain/types'
import type { ChatStreamEvent } from '@/ports'

// ── Mocks（骨架照抄 storeChatHistory.test.ts）─────────────────────────────
// backing conversations[] 模拟 Dexie conversations 表。localRecall 返一条受控 cite
// （cites.length>0 → 走流式 answerChat 路径，不走空 cites 裸答）。

const mocks = vi.hoisted(() => ({
  parseChatIntent: vi.fn(),
  answerChat: vi.fn(),
  extractMemory: vi.fn(),
  saveConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
  localRecall: vi.fn(),
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

vi.mock('@/ui/screens/chat/helpers', async (importOriginal) => {
  // 部分 mock（2026-09-29 能力大补）：localRecall 受控，dateKey/currentTimeLine/resolveActionCategory
  // 等新纯函数走真实实现（chatHistory 每条历史带 date 会调 dateKey）。
  const actual = await importOriginal<typeof import('@/ui/screens/chat/helpers')>()
  return { ...actual, localRecall: (...a: unknown[]) => mocks.localRecall(...a) }
})

import { useUiStore } from '@/app/store'

// fake timers 冻结期间，promise 微任务链仍走原生 microtask queue——多次 yield 把
// sendMessage 的 await 链（parseChatIntent → answerChat 调用点）推到目标位置。
async function flushMicro(ticks = 20): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.conversations.length = 0 // 原地清空，mock 闭包仍引用同一数组
  useUiStore.setState({
    online: true,
    conversation: null,
    chatList: [],
    chatLoading: 'idle',
    entries: [],
    memories: [],
    hydrated: true,
  })
  mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: [], categorySlugs: undefined } as ChatQuery)
  mocks.answerChat.mockResolvedValue({ answer: '好的', citedEntryIds: [] } as ChatAnswer)
  mocks.extractMemory.mockResolvedValue(null)
  // 默认一条受控 cite（cites.length>0 → 走流式 answerChat 路径）；个别用例改返空走裸答路径。
  mocks.localRecall.mockReturnValue([
    { id: 'e1', createdAt: '2026-09-28', categorySlug: 'idea', tags: [], textExcerpt: '原文' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

// chatAnswerCache 是 store.ts 模块级 Map，跨用例持久。各用例用不同问题串避免缓存命中。

describe('updateChatMessage（流式 flush 原语）', () => {
  it('map-replace：目标消息替换、其余消息引用不变；不存在 id / 无会话 → noop', () => {
    useUiStore.setState({
      conversation: {
        id: 'c1',
        messages: [
          { id: 'm1', role: 'user', content: '问', createdAt: '2026-09-28T00:00:00.000Z' },
          { id: 'm2', role: 'assistant', content: '答', createdAt: '2026-09-28T00:00:01.000Z' },
        ],
        updatedAt: '2026-09-28T00:00:01.000Z',
      },
    })
    const before = useUiStore.getState().conversation!
    useUiStore.getState().updateChatMessage('m2', { content: '答-改' })
    const after = useUiStore.getState().conversation!
    expect(after).not.toBe(before)
    expect(after.messages[0]).toBe(before.messages[0]) // 其余消息引用稳定（配合气泡 memo）
    expect(after.messages[1]).not.toBe(before.messages[1])
    expect(after.messages[1].content).toBe('答-改')

    useUiStore.getState().updateChatMessage('不存在', { content: 'x' })
    expect(useUiStore.getState().conversation).toBe(after)

    useUiStore.setState({ conversation: null })
    useUiStore.getState().updateChatMessage('m2', { content: 'y' })
    expect(useUiStore.getState().conversation).toBeNull()
  })
})

describe('sendMessage 流式编排', () => {
  it('全链路：占位 streaming → 节流 flush（content+reasoning）→ finalize 原位替换 → 落库', async () => {
    let resolveAnswer!: (a: ChatAnswer) => void
    mocks.answerChat.mockImplementation((_o: unknown, onEvent: (ev: ChatStreamEvent) => void) => {
      onEvent({ type: 'reasoning', delta: '先想一步' })
      onEvent({ type: 'reasoning', delta: '，再想一步' })
      onEvent({ type: 'content', delta: '{"answer": "你好' })
      onEvent({ type: 'content', delta: '呀' })
      return new Promise<ChatAnswer>((res) => {
        resolveAnswer = res
      })
    })

    const p = useUiStore.getState().sendMessage('流式问题-s1')
    await flushMicro()
    expect(mocks.answerChat).toHaveBeenCalledTimes(1)
    // answerChat 第二参是 onEvent 回调（流式契约）
    expect(typeof mocks.answerChat.mock.calls[0][1]).toBe('function')

    // 占位消息已 append：streaming:true、content 空；onEvent 已发但 80ms 节流窗口内未 flush
    const placeholder = useUiStore.getState().conversation!.messages.at(-1)!
    expect(placeholder.role).toBe('assistant')
    expect(placeholder.streaming).toBe(true)
    expect(placeholder.content).toBe('')
    expect(useUiStore.getState().chatLoading).toBe('answer')

    // 推进过节流窗口 → 一次 flush：content=可见文本（extractPartialAnswer 提封包内文本）、
    // trace.reasoning 累积全文；其余消息引用不变
    const userMsgRef = useUiStore.getState().conversation!.messages[0]
    await vi.advanceTimersByTimeAsync(100)
    const mid = useUiStore.getState().conversation!.messages.at(-1)!
    expect(mid.streaming).toBe(true)
    expect(mid.content).toBe('你好呀')
    expect(mid.trace?.reasoning).toBe('先想一步，再想一步')
    expect(useUiStore.getState().conversation!.messages[0]).toBe(userMsgRef)

    // finalize：原位替换（同 id/createdAt），content=最终全文 + citedEntryIds + streaming:false，
    // reasoning 留 trace 可回看；chatLoading 归 idle
    resolveAnswer({ answer: '你好呀！', citedEntryIds: ['e1'] })
    await p
    const done = useUiStore.getState().conversation!.messages.at(-1)!
    expect(done.id).toBe(placeholder.id)
    expect(done.content).toBe('你好呀！')
    expect(done.citedEntryIds).toEqual(['e1'])
    expect(done.streaming).toBe(false)
    expect(done.trace?.reasoning).toBe('先想一步，再想一步')
    expect(useUiStore.getState().chatLoading).toBe('idle')

    // 落库收口：末次 saveConversation 含最终消息（占位创建 + finalize 各一次，流式期间无落库）
    const saved = mocks.saveConversation.mock.calls.at(-1)![0] as Conversation
    expect(saved.messages.at(-1)!.content).toBe('你好呀！')
    expect(saved.messages.at(-1)!.streaming).toBe(false)
    // saveConversation 次数：user 消息 1 + 占位 1 + finalize 1 = 3（流式 flush 不落库）
    expect(mocks.saveConversation).toHaveBeenCalledTimes(3)
  })

  it('缓存写入：流式完成后同问句第二次 sendMessage 命中缓存，answerChat/parseChatIntent 不再调用', async () => {
    mocks.answerChat.mockResolvedValue({ answer: '答-s2', citedEntryIds: ['e1'] } as ChatAnswer)
    await useUiStore.getState().sendMessage('缓存问题-s2')
    expect(mocks.answerChat).toHaveBeenCalledTimes(1)
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(1)

    await useUiStore.getState().sendMessage('缓存问题-s2')
    expect(mocks.answerChat).toHaveBeenCalledTimes(1) // 缓存命中，跳两轮 LLM
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(1)
    const last = useUiStore.getState().conversation!.messages.at(-1)!
    expect(last.content).toBe('答-s2')
    expect(last.streaming).toBeUndefined() // 缓存路径不走流式占位
  })

  it('断流有部分可见文本 → finalize 部分答案（不报错、不进缓存）', async () => {
    mocks.answerChat.mockImplementation((_o: unknown, onEvent: (ev: ChatStreamEvent) => void) => {
      onEvent({ type: 'content', delta: '{"answer": "半截回答' })
      return Promise.reject(new Error('network cut'))
    })
    await useUiStore.getState().sendMessage('断流问题-s3')

    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.length).toBe(2) // user + 部分答案（无错误消息）
    const ai = msgs.at(-1)!
    expect(ai.error).toBeUndefined()
    expect(ai.content).toBe('半截回答')
    expect(ai.streaming).toBe(false)
    expect(ai.citedEntryIds).toEqual([])
    expect(useUiStore.getState().chatLoading).toBe('idle')

    // 降级答案不完整 → 不进缓存：再问同句 answerChat 再次调用
    mocks.answerChat.mockResolvedValue({ answer: '完整回答-s3', citedEntryIds: [] } as ChatAnswer)
    await useUiStore.getState().sendMessage('断流问题-s3')
    expect(mocks.answerChat).toHaveBeenCalledTimes(2)
  })

  it('无任何部分内容失败 → 占位原位转错误消息（不追加新气泡）', async () => {
    mocks.answerChat.mockRejectedValue(new Error('boom-s4'))
    await useUiStore.getState().sendMessage('失败问题-s4')

    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.length).toBe(2) // user + 原位转化的错误消息
    const ai = msgs.at(-1)!
    expect(ai.error).toBe(true)
    expect(ai.streaming).not.toBe(true)
    expect(ai.content).toContain('boom-s4')
    expect(useUiStore.getState().chatLoading).toBe('idle')
  })

  it('竞态防护：流式期间切会话 → finalize 只落库原会话，不回写当前 conversation/chatLoading', async () => {
    let resolveAnswer!: (a: ChatAnswer) => void
    mocks.answerChat.mockImplementation(
      () =>
        new Promise<ChatAnswer>((res) => {
          resolveAnswer = res
        }),
    )
    const p = useUiStore.getState().sendMessage('竞态问题-s5')
    await flushMicro()
    expect(mocks.answerChat).toHaveBeenCalledTimes(1)
    const convId = useUiStore.getState().conversation!.id

    // 流式窗口中用户开新会话
    useUiStore.getState().newConversation()
    expect(useUiStore.getState().conversation).toBeNull()

    resolveAnswer({ answer: '竞态答案-s5', citedEntryIds: [] })
    await p

    // 当前 conversation 不被回写；chatLoading 不归本流程管（newConversation 已置 idle）
    expect(useUiStore.getState().conversation).toBeNull()
    expect(useUiStore.getState().chatLoading).toBe('idle')
    // 但 finalize 仍 saveConversation 收口到原会话（含最终消息）
    const saved = mocks.saveConversation.mock.calls.at(-1)![0] as Conversation
    expect(saved.id).toBe(convId)
    expect(saved.messages.at(-1)!.content).toBe('竞态答案-s5')
    expect(saved.messages.at(-1)!.streaming).toBe(false)
  })

  // M2（2026-09-28 流式验收）：A 发问（cites 空 → 裸答无占位分支）→ intent 轮中
  // loadConversation(B)（复位 idle）→ A intent 返回后无条件推 recall/answer →
  // finalize guard 跳过 set → chatLoading 永留 'answer'，所有会话输入框永久禁用（软锁）。
  it('M2 竞态：intent 轮中切会话 + cites 空 → chatLoading 不永卡 answer', async () => {
    mocks.localRecall.mockReturnValue([]) // cites 空 → 裸答路径（不调 answerChat、无流式占位）
    let resolveIntent!: (q: ChatQuery) => void
    mocks.parseChatIntent.mockImplementationOnce(
      () => new Promise<ChatQuery>((res) => { resolveIntent = res }),
    )
    const convB: Conversation = {
      id: 'conv-b-m2',
      messages: [{ id: 'mb', role: 'user', content: 'B 历史', createdAt: '2026-09-27T00:00:00.000Z' }],
      updatedAt: '2026-09-27T00:00:00.000Z',
    }
    mocks.conversations.push(convB)

    const p = useUiStore.getState().sendMessage('竞态裸答-m2')
    await flushMicro()
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(1)
    const convA = useUiStore.getState().conversation!.id

    // intent 轮中切到会话 B（loadConversation 复位 idle）
    await useUiStore.getState().loadConversation('conv-b-m2')
    expect(useUiStore.getState().chatLoading).toBe('idle')

    resolveIntent({ scope: null, keywords: [] } as ChatQuery)
    await p

    // 修复前：chatLoading 永留 'answer'（全局输入软锁）
    expect(useUiStore.getState().chatLoading).toBe('idle')
    // A 的裸答不回写 B 视图，但仍落库到 A 的会话
    expect(useUiStore.getState().conversation!.id).toBe('conv-b-m2')
    const savedA = mocks.saveConversation.mock.calls
      .map((c) => c[0] as Conversation)
      .filter((c) => c.id === convA)
      .at(-1)!
    expect(savedA.messages.length).toBe(2)
    expect(savedA.messages[0].content).toBe('竞态裸答-m2')
  })

  // sendSeq：旧轮（seq 小）继续跑不得覆盖新轮的 chatLoading 相位，finalize 也不复位新轮。
  it('sendSeq：旧轮迟归不覆盖/复位新轮管理的 chatLoading', async () => {
    let resolveAIntent!: (q: ChatQuery) => void
    mocks.parseChatIntent.mockImplementationOnce(
      () => new Promise<ChatQuery>((res) => { resolveAIntent = res }),
    )
    const pA = useUiStore.getState().sendMessage('旧轮-seq-a')
    await flushMicro()
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(1)
    const convA = useUiStore.getState().conversation!.id

    // 切到已存会话 B 并发新问（B intent 挂起 → B 相位 'intent'）
    const convB: Conversation = {
      id: 'conv-b-seq',
      messages: [{ id: 'mb', role: 'user', content: 'B 历史', createdAt: '2026-09-27T00:00:00.000Z' }],
      updatedAt: '2026-09-27T00:00:00.000Z',
    }
    mocks.conversations.push(convB)
    await useUiStore.getState().loadConversation('conv-b-seq')
    let resolveBIntent!: (q: ChatQuery) => void
    mocks.parseChatIntent.mockImplementationOnce(
      () => new Promise<ChatQuery>((res) => { resolveBIntent = res }),
    )
    const pB = useUiStore.getState().sendMessage('新轮-seq-b')
    await flushMicro()
    expect(useUiStore.getState().chatLoading).toBe('intent')

    // A intent 迟归：A 继续跑 recall/answer（默认 mock 立即 resolve）并 finalize
    resolveAIntent({ scope: null, keywords: [] } as ChatQuery)
    await pA
    // 修复前：A 的无条件推入把 B 的 'intent' 覆盖成 'answer'
    expect(useUiStore.getState().chatLoading).toBe('intent')
    // A 的答案仍落库到 A 的会话
    const savedA = mocks.saveConversation.mock.calls
      .map((c) => c[0] as Conversation)
      .filter((c) => c.id === convA)
      .at(-1)!
    expect(savedA.messages.at(-1)!.content).toBe('好的')

    // B 走完：正常复位 idle
    resolveBIntent({ scope: null, keywords: [] } as ChatQuery)
    await pB
    expect(useUiStore.getState().chatLoading).toBe('idle')
    expect(useUiStore.getState().conversation!.messages.at(-1)!.content).toBe('好的')
  })

  // M3：A 发问 → intent 轮中切 B → answer 轮起点占位 append 无条件 set({conversation: conv})
  // 把 B 视图掰回 A。修复：加与 finalize 相同的 guard，只 saveConversation 到原会话。
  it('M3 竞态：intent 轮中切会话 → answer 占位 append 不掰回当前视图', async () => {
    let resolveIntent!: (q: ChatQuery) => void
    mocks.parseChatIntent.mockImplementationOnce(
      () => new Promise<ChatQuery>((res) => { resolveIntent = res }),
    )
    let resolveAnswer!: (a: ChatAnswer) => void
    mocks.answerChat.mockImplementationOnce(
      () => new Promise<ChatAnswer>((res) => { resolveAnswer = res }),
    )
    const convB: Conversation = {
      id: 'conv-b-m3',
      messages: [{ id: 'mb', role: 'user', content: 'B 历史', createdAt: '2026-09-27T00:00:00.000Z' }],
      updatedAt: '2026-09-27T00:00:00.000Z',
    }
    mocks.conversations.push(convB)

    const p = useUiStore.getState().sendMessage('占位竞态-m3')
    await flushMicro()
    const convA = useUiStore.getState().conversation!.id

    await useUiStore.getState().loadConversation('conv-b-m3')

    // intent 返回 → 进入 answer 轮：占位 append（修复前无条件 set 把视图掰回 A）
    resolveIntent({ scope: null, keywords: [] } as ChatQuery)
    await flushMicro()
    expect(mocks.answerChat).toHaveBeenCalledTimes(1)
    expect(useUiStore.getState().conversation!.id).toBe('conv-b-m3') // 修复前被掰回 convA
    // 旧轮不得把 chatLoading 重新推成 answer（loadConversation 已复位 idle）
    expect(useUiStore.getState().chatLoading).toBe('idle')

    resolveAnswer({ answer: 'A 的最终答案-m3', citedEntryIds: [] })
    await p
    expect(useUiStore.getState().conversation!.id).toBe('conv-b-m3')
    expect(useUiStore.getState().chatLoading).toBe('idle')
    // A 会话落库含最终答案（占位 → finalize 收口都是 A 的 id）
    const savesA = mocks.saveConversation.mock.calls
      .map((c) => c[0] as Conversation)
      .filter((c) => c.id === convA)
    expect(savesA.at(-1)!.messages.at(-1)!.content).toBe('A 的最终答案-m3')
    expect(savesA.at(-1)!.messages.at(-1)!.streaming).toBe(false)
  })

  // m9：流式失败（无部分内容）时错误消息 trace 带上已累积 reasoning（便于排查思考模型断点）。
  it('m9: 流式失败错误消息 trace 带已累积 reasoning', async () => {
    mocks.answerChat.mockImplementation((_o: unknown, onEvent: (ev: ChatStreamEvent) => void) => {
      onEvent({ type: 'reasoning', delta: '已想了一半' })
      onEvent({ type: 'content', delta: '{"ans' }) // 信封未齐 → 无可见部分
      return Promise.reject(new Error('boom-m9'))
    })
    await useUiStore.getState().sendMessage('失败带推理-m9')
    const ai = useUiStore.getState().conversation!.messages.at(-1)!
    expect(ai.error).toBe(true)
    expect(ai.trace?.error).toContain('boom-m9')
    // 修复前 trace 只有 error，丢已累积 reasoning
    expect(ai.trace?.reasoning).toBe('已想了一半')
  })
})

describe('M4: streaming 尸体抹除（内存态不信持久层）', () => {
  // 流式中途进程被杀 → Dexie 里残留 streaming:true 的占位气泡（空气泡+光标+压 LoadingBubble）。
  const corpse = (): Conversation => ({
    id: 'conv-dead',
    messages: [
      { id: 'u1', role: 'user', content: '问', createdAt: '2026-09-28T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '半截', createdAt: '2026-09-28T00:00:01.000Z', streaming: true },
    ],
    updatedAt: '2026-09-28T00:00:01.000Z',
  })

  it('loadConversation 读出时抹掉残留 streaming 标记', async () => {
    mocks.conversations.push(corpse())
    await useUiStore.getState().loadConversation('conv-dead')
    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.length).toBe(2)
    expect(msgs[1].streaming).toBe(false)
    expect(msgs[1].content).toBe('半截')
    expect(useUiStore.getState().chatLoading).toBe('idle')
  })

  it('hydrate 续聊最近会话同样抹 streaming', async () => {
    mocks.conversations.push(corpse())
    useUiStore.setState({ hydrated: false, conversation: null, chatList: [] })
    await useUiStore.getState().hydrate()
    expect(useUiStore.getState().conversation!.id).toBe('conv-dead')
    expect(useUiStore.getState().conversation!.messages[1].streaming).toBe(false)
  })
})
