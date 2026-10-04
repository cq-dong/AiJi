// W0（2026-10-04）saveMemory 并发串行化测试：
// 旧实现 candidates 取 T0 快照后经 embed/裁决两次 await 让出事件循环——两次并行
// saveMemory（sendMessage 记忆提取 fire-and-forget 与 MemorySheet 手动添加可并行）
// 各持 T0 快照裁决，merge/replace 后写覆盖先写，记忆静默丢失。
// 修复：模块级 promise 链串行化；链尾 catch 吞错防一次失败毒化后续排队任务。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Memory, Settings } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  adjudicateMemory: vi.fn(),
  extractMemory: vi.fn(),
  // null = di.llm 无 embed 方法（builtin 路径）——getter 透传，模拟方法缺席。
  embedFn: null as ((texts: string[]) => Promise<number[][] | null>) | null,
  savedMemories: [] as Memory[],
  // 落库故障注入：内容匹配即抛错（测「队列内一次失败不毒化后续任务」）。
  failOnContent: null as string | null,
  settings: { keySource: 'byok' } as unknown as Settings,
}))

vi.mock('@/app/di', () => ({
  di: {
    llm: {
      adjudicateMemory: (...a: unknown[]) => mocks.adjudicateMemory(...a),
      extractMemory: (...a: unknown[]) => mocks.extractMemory(...a),
      classify: vi.fn(),
      aggregate: vi.fn(),
      parseChatIntent: vi.fn(),
      answerChat: vi.fn(),
      summarizeConversation: vi.fn(),
      get embed() {
        return mocks.embedFn ?? undefined
      },
    },
    storage: {
      saveMemory: async (m: Memory) => {
        if (mocks.failOnContent && m.content === mocks.failOnContent) {
          throw new Error('idb down')
        }
        const i = mocks.savedMemories.findIndex((x) => x.id === m.id)
        if (i >= 0) mocks.savedMemories[i] = m
        else mocks.savedMemories.push(m)
      },
      deleteMemory: vi.fn().mockResolvedValue(undefined),
      listMemories: vi.fn().mockResolvedValue([]),
      getSettings: async () => mocks.settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      listEntries: vi.fn().mockResolvedValue([]),
      listCategories: vi.fn().mockResolvedValue([]),
      listTags: vi.fn().mockResolvedValue([]),
      listAggregates: vi.fn().mockResolvedValue([]),
      listReminders: vi.fn().mockResolvedValue([]),
      listDrafts: vi.fn().mockResolvedValue([]),
      listTrashed: vi.fn().mockResolvedValue([]),
      listConversations: vi.fn().mockResolvedValue([]),
      getConversation: vi.fn().mockResolvedValue(undefined),
      saveConversation: vi.fn().mockResolvedValue(undefined),
      deleteConversation: vi.fn().mockResolvedValue(undefined),
      getEntryAi: vi.fn().mockResolvedValue(undefined),
      purgeExpired: vi.fn().mockResolvedValue(0),
    },
    secrets: { get: vi.fn().mockResolvedValue(undefined) },
    stt: { transcribe: vi.fn().mockResolvedValue('') },
  },
}))

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'

function mkMemory(id: string, content: string, over: Partial<Memory> = {}): Memory {
  return {
    id,
    content,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.embedFn = null
  mocks.savedMemories = []
  mocks.failOnContent = null
  setCurrentLang('zh')
  useUiStore.setState({ memories: [], hydrated: true, settings: mocks.settings })
})

describe('saveMemory 并发串行化（W0 静默丢失修复）', () => {
  it('并行两次 saveMemory：第二次的初筛候选包含第一次的产出（无 T0 快照竞态），两条都在', async () => {
    useUiStore.setState({ memories: [mkMemory('m1', '喜欢美式')] })
    // 记录每次 embed 收到的候选列表（texts[0]=新记忆，其余=候选）；第一次 embed 挂起等手动放行。
    const seenCandidates: string[][] = []
    let firstResolve!: (v: number[][]) => void
    mocks.embedFn = vi.fn().mockImplementation((texts: string[]) => {
      seenCandidates.push(texts.slice(1))
      if (seenCandidates.length === 1) return new Promise((r) => { firstResolve = r })
      // 全部低相似（0.8 < 0.85）→ 走 ADD，不进裁决。
      return Promise.resolve([[1, 0], ...texts.slice(1).map(() => [4, 3])])
    })

    const p1 = useUiStore.getState().saveMemory('对猫过敏')
    const p2 = useUiStore.getState().saveMemory('不吃辣')
    // 给第二次调用足够事件循环跑到它的 embed 点——串行化下它必须还在排队，不得调 embed。
    await new Promise((r) => setTimeout(r, 20))
    expect(seenCandidates).toHaveLength(1)

    // 放行第一次：低相似 → ADD 落库 + 内存态 prepend。
    firstResolve([[1, 0], [4, 3]])
    await Promise.all([p1, p2])

    // 第二次的候选快照 = 第一次完成后的 memories——含新加的「对猫过敏」。
    expect(seenCandidates).toHaveLength(2)
    expect(seenCandidates[1]).toContain('对猫过敏')
    // 两条新记忆都在，无互相覆盖。
    const contents = useUiStore.getState().memories.map((m) => m.content)
    expect(contents).toContain('对猫过敏')
    expect(contents).toContain('不吃辣')
    expect(mocks.savedMemories.map((m) => m.content)).toEqual(
      expect.arrayContaining(['对猫过敏', '不吃辣']),
    )
  })

  it('队列内一次失败不毒化后续任务：第一次落库抛错，第二次仍正常落库', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.failOnContent = '对猫过敏' // 第一次 saveMemory 落库必抛
    // embed 缺席（null）→ 两次都走 ADD 直落路径。
    const p1 = useUiStore.getState().saveMemory('对猫过敏')
    const p2 = useUiStore.getState().saveMemory('不吃辣')

    // 调用方仍能观察到本次失败（与串行 await 旧行为一致）。
    await expect(p1).rejects.toThrow('idb down')
    await p2

    const contents = useUiStore.getState().memories.map((m) => m.content)
    expect(contents).toContain('不吃辣')
    expect(contents).not.toContain('对猫过敏')
    expect(mocks.savedMemories.map((m) => m.content)).toEqual(['不吃辣'])
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
