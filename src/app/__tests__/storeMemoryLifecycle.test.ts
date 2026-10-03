// P-C（2026-10-03 spec §2/§3/§4/§5）store 记忆生命周期编排测试：
// saveMemory 向量初筛→裁决→四动作落库 / 降级矩阵全走 ADD / 归档扫描时机与边界 / 恢复。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Memory, MemoryVerdict, Settings } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  adjudicateMemory: vi.fn(),
  extractMemory: vi.fn(),
  // null = di.llm 无 embed 方法（builtin 路径）——getter 透传，模拟方法缺席。
  embedFn: null as ((texts: string[]) => Promise<number[][] | null>) | null,
  savedMemories: [] as Memory[],
  listMemoriesRows: [] as Memory[],
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
        const i = mocks.savedMemories.findIndex((x) => x.id === m.id)
        if (i >= 0) mocks.savedMemories[i] = m
        else mocks.savedMemories.push(m)
      },
      deleteMemory: vi.fn().mockResolvedValue(undefined),
      listMemories: async () => [...mocks.listMemoriesRows],
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

const DAY_MS = 24 * 3600 * 1000

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

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString()
}

// 构造与 newVec 相似度确定的候选向量（勾股数保证 FP 稳定）：
// cos([1,0],[4,3]) = 0.8（<0.85 落选）；cos([1,0],[24,7]) = 0.96（命中）。
const V_LOW = [4, 3]
const V_HIGH = [24, 7]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.embedFn = null
  mocks.savedMemories = []
  mocks.listMemoriesRows = []
  setCurrentLang('zh')
  useUiStore.setState({ memories: [], hydrated: true, settings: mocks.settings })
})

describe('saveMemory 降级矩阵（spec §5）——全部走 ADD 与旧行为一致', () => {
  it('embed 缺席（undefined）→ 直接 ADD：新行 prepend + 落库，不调裁决', async () => {
    useUiStore.setState({ memories: [mkMemory('m1', '喜欢美式')] })
    await useUiStore.getState().saveMemory('  对猫过敏  ')
    const mems = useUiStore.getState().memories
    expect(mems).toHaveLength(2)
    expect(mems[0]).toMatchObject({ content: '对猫过敏', enabled: true })
    expect(mems[0]!.lastConfirmedAt).toBeTruthy()
    expect(mocks.savedMemories).toHaveLength(1)
    expect(mocks.savedMemories[0]).toMatchObject({ content: '对猫过敏', enabled: true })
    expect(mocks.adjudicateMemory).not.toHaveBeenCalled()
  })

  it('embed 返 null → ADD；embed 抛错 → ADD（均不调裁决）', async () => {
    useUiStore.setState({ memories: [mkMemory('m1', '喜欢美式')] })
    mocks.embedFn = vi.fn().mockResolvedValue(null)
    await useUiStore.getState().saveMemory('对猫过敏')
    expect(useUiStore.getState().memories).toHaveLength(2)
    mocks.embedFn = vi.fn().mockRejectedValue(new Error('network'))
    await useUiStore.getState().saveMemory('不吃辣')
    expect(useUiStore.getState().memories).toHaveLength(3)
    expect(mocks.adjudicateMemory).not.toHaveBeenCalled()
  })

  it('无候选记忆（空库）→ 不调 embed 直接 ADD', async () => {
    mocks.embedFn = vi.fn().mockResolvedValue([[1, 0]])
    await useUiStore.getState().saveMemory('对猫过敏')
    expect(mocks.embedFn).not.toHaveBeenCalled()
    expect(useUiStore.getState().memories).toHaveLength(1)
  })

  it('相似度全低于 0.85 → 不调裁决直接 ADD', async () => {
    useUiStore.setState({ memories: [mkMemory('m1', '喜欢美式')] })
    mocks.embedFn = vi.fn().mockResolvedValue([[1, 0], V_LOW]) // 0.8 < 0.85
    await useUiStore.getState().saveMemory('对猫过敏')
    expect(mocks.adjudicateMemory).not.toHaveBeenCalled()
    expect(useUiStore.getState().memories).toHaveLength(2)
  })

  it('归档/停用记忆不参与初筛（候选 = enabled && 未归档）', async () => {
    useUiStore.setState({
      memories: [
        mkMemory('m1', '已归档记忆', { archivedAt: daysAgo(1) }),
        mkMemory('m2', '已停用记忆', { enabled: false }),
      ],
    })
    mocks.embedFn = vi.fn().mockResolvedValue([[1, 0]])
    await useUiStore.getState().saveMemory('对猫过敏')
    // 候选为空 → embed 批只有新记忆一条时仍调用（candidates 为空则不 embed）
    expect(mocks.embedFn).not.toHaveBeenCalled()
    expect(useUiStore.getState().memories[0]).toMatchObject({ content: '对猫过敏' })
  })
})

describe('saveMemory 裁决执行（spec §2/§3）', () => {
  beforeEach(() => {
    useUiStore.setState({
      memories: [mkMemory('m1', '住在上海'), mkMemory('m2', '喜欢美式')],
    })
    // 新记忆与 m1 0.96 相似、m2 0.8 落选
    mocks.embedFn = vi.fn().mockResolvedValue([[1, 0], V_HIGH, V_LOW])
  })

  it('初筛命中 → 裁决收到新记忆 + 相似候选（仅 id/content）', async () => {
    mocks.adjudicateMemory.mockResolvedValue({ action: 'add' } as MemoryVerdict)
    await useUiStore.getState().saveMemory('搬到杭州了')
    expect(mocks.adjudicateMemory).toHaveBeenCalledWith('搬到杭州了', [{ id: 'm1', content: '住在上海' }])
    expect(useUiStore.getState().memories[0]).toMatchObject({ content: '搬到杭州了', enabled: true })
  })

  it('replace：旧行 enabled=false 留痕 + 新行落库，双双持久化', async () => {
    mocks.adjudicateMemory.mockResolvedValue({ action: 'replace', oldId: 'm1' } as MemoryVerdict)
    await useUiStore.getState().saveMemory('搬到杭州了')
    const mems = useUiStore.getState().memories
    expect(mems.find((m) => m.id === 'm1')).toMatchObject({ enabled: false, content: '住在上海' })
    expect(mems[0]).toMatchObject({ content: '搬到杭州了', enabled: true })
    expect(mocks.savedMemories).toHaveLength(2)
    expect(mocks.savedMemories.find((m) => m.id === 'm1')).toMatchObject({ enabled: false })
  })

  it('merge：旧行 content=merged 刷新，不新增行', async () => {
    mocks.adjudicateMemory.mockResolvedValue({
      action: 'merge',
      oldId: 'm1',
      merged: '住在上海，刚搬去杭州',
    } as MemoryVerdict)
    await useUiStore.getState().saveMemory('搬到杭州了')
    const mems = useUiStore.getState().memories
    expect(mems).toHaveLength(2)
    expect(mems.find((m) => m.id === 'm1')).toMatchObject({ content: '住在上海，刚搬去杭州' })
    expect(mems.find((m) => m.id === 'm1')!.lastConfirmedAt).toBeTruthy()
    expect(mocks.savedMemories).toHaveLength(1)
  })

  it('skip：只刷旧行 lastConfirmedAt，updatedAt 不动，无新行', async () => {
    const before = useUiStore.getState().memories.find((m) => m.id === 'm1')!
    mocks.adjudicateMemory.mockResolvedValue({ action: 'skip', oldId: 'm1' } as MemoryVerdict)
    await useUiStore.getState().saveMemory('我住在上海')
    const mems = useUiStore.getState().memories
    expect(mems).toHaveLength(2)
    const after = mems.find((m) => m.id === 'm1')!
    expect(after.updatedAt).toBe(before.updatedAt)
    expect(after.lastConfirmedAt).toBeTruthy()
    expect(mocks.savedMemories).toHaveLength(1)
  })

  it('skip（无 oldId）：无操作——不落新行不刷行，仅 console.warn（lead 2026-10-03 约定）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = useUiStore.getState().memories
    mocks.adjudicateMemory.mockResolvedValue({ action: 'skip' } as MemoryVerdict)
    await useUiStore.getState().saveMemory('我住在上海')
    const mems = useUiStore.getState().memories
    // 无新行、旧行原样（lastConfirmedAt 也不刷）
    expect(mems).toHaveLength(2)
    expect(mems.find((m) => m.id === 'm1')).toEqual(before.find((m) => m.id === 'm1'))
    expect(mems.find((m) => m.id === 'm2')).toEqual(before.find((m) => m.id === 'm2'))
    expect(mocks.savedMemories).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('裁决抛错 → 默认 ADD + console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.adjudicateMemory.mockRejectedValue(new Error('LLM down'))
    await useUiStore.getState().saveMemory('搬到杭州了')
    expect(useUiStore.getState().memories).toHaveLength(3)
    expect(useUiStore.getState().memories[0]).toMatchObject({ content: '搬到杭州了', enabled: true })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('裁决 oldId 不在 similar → 默认 ADD + console.warn（双层防御）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.adjudicateMemory.mockResolvedValue({ action: 'replace', oldId: 'ghost' } as MemoryVerdict)
    await useUiStore.getState().saveMemory('搬到杭州了')
    expect(useUiStore.getState().memories).toHaveLength(3)
    expect(useUiStore.getState().memories.find((m) => m.id === 'm1')).toMatchObject({ enabled: true })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('archiveStaleMemories 过期归档（spec §4）', () => {
  it('89 天不归档、91 天归档；lastConfirmedAt 缺省回落 createdAt', async () => {
    const now = Date.now()
    useUiStore.setState({
      memories: [
        mkMemory('fresh', '新鲜', { createdAt: new Date(now - 89 * DAY_MS).toISOString() }),
        mkMemory('stale', '陈旧', { createdAt: new Date(now - 91 * DAY_MS).toISOString() }),
        mkMemory('confirmed', '旧但刚确认', {
          createdAt: new Date(now - 200 * DAY_MS).toISOString(),
          lastConfirmedAt: new Date(now - 10 * DAY_MS).toISOString(),
        }),
      ],
    })
    const count = await useUiStore.getState().archiveStaleMemories(new Date(now).toISOString())
    expect(count).toBe(1)
    const mems = useUiStore.getState().memories
    expect(mems.find((m) => m.id === 'stale')!.archivedAt).toBeTruthy()
    expect(mems.find((m) => m.id === 'fresh')!.archivedAt).toBeUndefined()
    expect(mems.find((m) => m.id === 'confirmed')!.archivedAt).toBeUndefined()
    // 归档行已持久化
    expect(mocks.savedMemories.find((m) => m.id === 'stale')!.archivedAt).toBeTruthy()
  })

  it('已归档/已停用行跳过；无过期返 0 不落库', async () => {
    useUiStore.setState({
      memories: [
        mkMemory('arch', '已归档', { createdAt: daysAgo(200), archivedAt: daysAgo(1) }),
        mkMemory('off', '已停用', { createdAt: daysAgo(200), enabled: false }),
      ],
    })
    const count = await useUiStore.getState().archiveStaleMemories()
    expect(count).toBe(0)
    expect(mocks.savedMemories).toHaveLength(0)
  })

  it('saveMemory 成功后自动扫一次（预置 91 天陈旧记忆 → 归档）', async () => {
    useUiStore.setState({ memories: [mkMemory('stale', '陈旧', { createdAt: daysAgo(91) })] })
    await useUiStore.getState().saveMemory('新事实')
    expect(useUiStore.getState().memories.find((m) => m.id === 'stale')!.archivedAt).toBeTruthy()
  })

  it('hydrate 完成后扫一次（listMemories 出陈旧记忆 → 归档落库）', async () => {
    mocks.listMemoriesRows = [mkMemory('stale', '陈旧', { createdAt: daysAgo(91) })]
    useUiStore.setState({ hydrated: false, memories: [] })
    await useUiStore.getState().hydrate()
    expect(useUiStore.getState().memories.find((m) => m.id === 'stale')!.archivedAt).toBeTruthy()
    expect(mocks.savedMemories.find((m) => m.id === 'stale')!.archivedAt).toBeTruthy()
  })
})

describe('restoreMemory 恢复（spec §4 UI）', () => {
  it('清 archivedAt + 刷 lastConfirmedAt + 保持 enabled + 持久化', async () => {
    useUiStore.setState({
      memories: [mkMemory('m1', '陈旧记忆', { createdAt: daysAgo(200), archivedAt: daysAgo(1) })],
    })
    await useUiStore.getState().restoreMemory('m1')
    const m = useUiStore.getState().memories.find((x) => x.id === 'm1')!
    expect(m.archivedAt).toBeUndefined()
    expect(m.enabled).toBe(true)
    expect(m.lastConfirmedAt).toBeTruthy()
    const persisted = mocks.savedMemories.find((x) => x.id === 'm1')!
    expect(persisted.archivedAt).toBeUndefined()
    expect(persisted.lastConfirmedAt).toBeTruthy()
  })
})
