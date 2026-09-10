import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatAnswer, ChatQuery } from '@/domain/types'

// ── Mocks ───────────────────────────────────────────────────────────────────
// di.llm.{parseChatIntent, answerChat, extractMemory} + di.storage.{saveConversation, saveMemory}
// 全部可控。localRecall mock 成一条受控 cite（让 answerChat 被调，不走空 cites 裸答分支）。

const mocks = vi.hoisted(() => ({
  parseChatIntent: vi.fn(),
  answerChat: vi.fn(),
  extractMemory: vi.fn(),
  saveConversation: vi.fn(),
  saveMemory: vi.fn(),
  listConversations: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    llm: {
      parseChatIntent: (...a: unknown[]) => mocks.parseChatIntent(...a),
      answerChat: (...a: unknown[]) => mocks.answerChat(...a),
      extractMemory: (t: string, k?: string[]) => mocks.extractMemory(t, k),
    },
    storage: {
      saveConversation: (c: unknown) => mocks.saveConversation(c),
      saveMemory: (m: unknown) => mocks.saveMemory(m),
      // 多会话（2026-07-22）：sendMessage 落库后 refreshChatList 读列表；空数组即够，本文件不测历史。
      listConversations: () => mocks.listConversations(),
    },
  },
}))

// localRecall：返一条受控 cite（cites.length>0 → answerChat 被调）。
vi.mock('@/ui/screens/chat/helpers', () => ({
  localRecall: () => [
    { id: 'e1', createdAt: '2026-07-17', categorySlug: 'idea', tags: [], textExcerpt: '原文' },
  ],
}))

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import { seedSettings } from '@/data/seed'

beforeEach(() => {
  vi.clearAllMocks()
  // 断言中文确认文案，固定 zh（jsdom navigator.language=en-US，detect 会得 en）。
  setCurrentLang('zh')
  mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: [], categorySlugs: undefined } as ChatQuery)
  mocks.answerChat.mockResolvedValue({ answer: '好的', citedEntryIds: [] } as ChatAnswer)
  mocks.extractMemory.mockResolvedValue(null)
  mocks.saveConversation.mockResolvedValue(undefined)
  mocks.saveMemory.mockResolvedValue(undefined)
  mocks.listConversations.mockResolvedValue([])
  // online=true（避免离线早返）；conversation=null（lazy-create）；entries=[]（cache key 稳定）。
  // settings 重置为 seed（autoMemory=undefined 视同开）——Zustand setState 浅合并，
  // 单测里改过 settings.autoMemory 会泄漏到后续用例。
  useUiStore.setState({ online: true, conversation: null, chatList: [], entries: [], memories: [], settings: { ...seedSettings }, hydrated: true })
})

// 注意：chatAnswerCache 是 store.ts 模块级 Map，跨用例持久。各用例用不同问题串避免缓存命中
// （命中会早返、不走 answerChat/extractMemory 路径）。entries=[] → sig='0:'，问题串唯一即 key 唯一。

describe('store.sendMessage — 自动记忆提取', () => {
  it('记住意图 + extractMemory 返回非 null → saveMemory 被调 + 追加「已记住」确认消息', async () => {
    mocks.extractMemory.mockResolvedValue('我对花生过敏')
    // 独特问题串（避免与其他用例缓存键碰撞）
    await useUiStore.getState().sendMessage('记住我对花生过敏-用例1')

    // answerChat 被调（answer 先落）
    expect(mocks.answerChat).toHaveBeenCalledOnce()
    // extractMemory 被调（regex 命中），传入用户原话 + 已知记忆数组（本用例为空）
    expect(mocks.extractMemory).toHaveBeenCalledWith('记住我对花生过敏-用例1', [])
    // saveMemory 被调，content=提取的记忆、enabled=true
    await vi.waitFor(() =>
      expect(mocks.saveMemory).toHaveBeenCalledWith(expect.objectContaining({ content: '我对花生过敏', enabled: true })),
    )
    // 确认消息追加到 conversation 末尾
    await vi.waitFor(() => {
      const conv = useUiStore.getState().conversation
      expect(conv).not.toBeNull()
      const last = conv!.messages[conv!.messages.length - 1]
      expect(last.role).toBe('assistant')
      expect(last.content).toContain('已记住：我对花生过敏')
      expect(last.content).toContain('设置→AI 记忆')
    })
  })

  it('陪伴化（2026-09-10）：无记住意图的普通提问 → extractMemory 也被调（每轮自动提取）', async () => {
    await useUiStore.getState().sendMessage('今天天气怎么样-用例2')

    expect(mocks.answerChat).toHaveBeenCalledOnce()
    // 每轮自动提取：普通提问也走提取器（返回 null → 不落记忆、无确认）
    expect(mocks.extractMemory).toHaveBeenCalledWith('今天天气怎么样-用例2', [])
    expect(mocks.saveMemory).not.toHaveBeenCalled()
    const conv = useUiStore.getState().conversation!
    const last = conv.messages[conv.messages.length - 1]
    // 末条是 answer（「好的」），无「已记住」确认
    expect(last.content).toBe('好的')
  })

  it('隐式提取返回非 null → 静默 saveMemory，不追加确认消息（免打扰）', async () => {
    mocks.extractMemory.mockResolvedValue('用户在准备考研')
    await useUiStore.getState().sendMessage('我最近在准备考研，压力大-用例2b')

    await vi.waitFor(() =>
      expect(mocks.saveMemory).toHaveBeenCalledWith(expect.objectContaining({ content: '用户在准备考研', enabled: true })),
    )
    // 静默落：聊天流末条仍是 answer，无「已记住」
    const conv = useUiStore.getState().conversation!
    const last = conv.messages[conv.messages.length - 1]
    expect(last.content).toBe('好的')
    expect(last.content).not.toContain('已记住')
  })

  it('autoMemory=false + 非记住意图 → extractMemory 不被调', async () => {
    useUiStore.setState({ settings: { ...useUiStore.getState().settings, autoMemory: false } })
    await useUiStore.getState().sendMessage('今天天气怎么样-用例2c')

    expect(mocks.answerChat).toHaveBeenCalledOnce()
    expect(mocks.extractMemory).not.toHaveBeenCalled()
    expect(mocks.saveMemory).not.toHaveBeenCalled()
  })

  it('autoMemory=false + 显式记住意图 → 仍提取（用户明示永远生效）+ 确认消息', async () => {
    useUiStore.setState({ settings: { ...useUiStore.getState().settings, autoMemory: false } })
    mocks.extractMemory.mockResolvedValue('我对花生过敏')
    await useUiStore.getState().sendMessage('记住我对花生过敏-用例2d')

    await vi.waitFor(() => expect(mocks.saveMemory).toHaveBeenCalled())
    await vi.waitFor(() => {
      const conv = useUiStore.getState().conversation!
      expect(conv.messages[conv.messages.length - 1].content).toContain('已记住')
    })
  })

  it('已有 enabled 记忆 → 作为 knownMemories 传给提取器判重', async () => {
    useUiStore.setState({
      memories: [
        { id: 'm1', content: '我对花生过敏', enabled: true, createdAt: '', updatedAt: '' },
        { id: 'm2', content: '已停用不进 prompt', enabled: false, createdAt: '', updatedAt: '' },
      ],
    })
    await useUiStore.getState().sendMessage('我每天都跑步-用例2e')

    expect(mocks.extractMemory).toHaveBeenCalledWith('我每天都跑步-用例2e', ['我对花生过敏'])
  })

  it('记住意图但 extractMemory 返回 null → 不落记忆，无确认消息（answer 正常显）', async () => {
    mocks.extractMemory.mockResolvedValue(null)
    await useUiStore.getState().sendMessage('给我记一下某个偏好-用例3')

    expect(mocks.extractMemory).toHaveBeenCalledWith('给我记一下某个偏好-用例3', [])
    expect(mocks.saveMemory).not.toHaveBeenCalled()
    const conv = useUiStore.getState().conversation!
    const last = conv.messages[conv.messages.length - 1]
    expect(last.content).toBe('好的')
    expect(last.content).not.toContain('已记住')
  })

  it('记住意图但 extractMemory 抛错 → 静默不影响主问答（answer 已显）', async () => {
    mocks.extractMemory.mockRejectedValue(new Error('LLM HTTP 500'))
    await useUiStore.getState().sendMessage('别忘了我的习惯-用例4')

    expect(mocks.extractMemory).toHaveBeenCalled()
    expect(mocks.saveMemory).not.toHaveBeenCalled()
    const conv = useUiStore.getState().conversation!
    const last = conv.messages[conv.messages.length - 1]
    // 末条仍是 answer（错误被 IIFE 自闭环 catch，不追加 error 消息）
    expect(last.content).toBe('好的')
    expect(last.error).toBeFalsy()
  })
})
