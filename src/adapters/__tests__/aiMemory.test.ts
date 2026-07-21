import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { Category, ChatCite, Tag } from '@/domain/types'

// buildPrompt/buildAnswerPrompt 是纯函数，无需 mock。用真实签名构造最小入参。
import { buildPrompt, buildAnswerPrompt } from '@/adapters/openAiCompatLlm'

// ── Prompt builder：记忆注入字节级回归 ──────────────────────────────────────
// 无记忆（undefined / []）必须与历史输出逐字节一致；有记忆追加设计 §3 段落。

const cats: Category[] = [
  { slug: 'idea', label: '想法', aliases: [], usageCount: 0, createdAt: '2026-07-01' },
]
const tags: Tag[] = [
  { slug: 'x', label: 'x', aliases: [], usageCount: 0, createdAt: '2026-07-01' },
]
const CONTENT = '测试内容'
const CREATED = '2026-07-17T10:00:00+08:00'

describe('buildPrompt — memory injection', () => {
  it('undefined memories → 与无记忆基线逐字节一致', () => {
    const baseline = buildPrompt(CONTENT, CREATED, cats, tags, false)
    const withUndef = buildPrompt(CONTENT, CREATED, cats, tags, false, undefined, undefined)
    expect(withUndef).toEqual(baseline)
  })

  it('empty memories array → 与无记忆基线逐字节一致', () => {
    const baseline = buildPrompt(CONTENT, CREATED, cats, tags, false)
    const withEmpty = buildPrompt(CONTENT, CREATED, cats, tags, false, undefined, [])
    expect(withEmpty).toEqual(baseline)
  })

  it('有记忆 → system 追加 §3 段落，含每条 content', () => {
    const msgs = buildPrompt(CONTENT, CREATED, cats, tags, false, undefined, ['螺蛳粉相关条目都归到 food 类', '我对花生过敏'])
    const system = msgs[0].content as string
    expect(system).toContain('用户明确记忆与偏好（必须遵循，优先级高于你的默认判断）：')
    expect(system).toContain('- 螺蛳粉相关条目都归到 food 类')
    expect(system).toContain('- 我对花生过敏')
    expect(system).toContain('若记忆与本条目分类/标签相关（如「X 都归到 Y 类」），严格按记忆执行。')
  })

  it('有记忆时 user message 不变', () => {
    const noMem = buildPrompt(CONTENT, CREATED, cats, tags, false)
    const withMem = buildPrompt(CONTENT, CREATED, cats, tags, false, undefined, ['m1'])
    // user message（最后一条）逐字节一致——记忆只进 system
    expect(withMem[withMem.length - 1]).toEqual(noMem[noMem.length - 1])
  })
})

describe('buildAnswerPrompt — memory injection', () => {
  const cites: ChatCite[] = [
    { id: 'e1', createdAt: '2026-07-17', categorySlug: 'idea', tags: [], textExcerpt: '原文' },
  ]
  const conv = [{ role: 'user' as const, content: 'hi' }]

  it('undefined memories → 与无记忆基线逐字节一致', () => {
    const baseline = buildAnswerPrompt('问', cites, conv)
    const withUndef = buildAnswerPrompt('问', cites, conv, undefined)
    expect(withUndef).toEqual(baseline)
  })

  it('empty memories → 与无记忆基线逐字节一致', () => {
    const baseline = buildAnswerPrompt('问', cites, conv)
    const withEmpty = buildAnswerPrompt('问', cites, conv, [])
    expect(withEmpty).toEqual(baseline)
  })

  it('有记忆 → system 追加问答措辞段落', () => {
    const msgs = buildAnswerPrompt('问', cites, conv, ['我对花生过敏'])
    const system = msgs[0].content as string
    expect(system).toContain('用户明确记忆与偏好（必须遵循，优先级高于你的默认判断）：')
    expect(system).toContain('- 我对花生过敏')
    expect(system).toContain('回答时参考这些用户明确记忆；与记忆冲突时以记忆为准。')
  })
})

// ── dexieStorage memories 分区隔离 ─────────────────────────────────────────
// 镜像 dexieStorage.partition.test.ts 模式：mock seed 为空，直接读写 memories 表。

vi.mock('@/data/seed', () => ({
  seedEntries: [],
  seedEntryAi: [],
  seedCategories: [],
  seedTags: [],
  seedAggregates: [],
  seedReminders: [],
  seedSettings: {
    llmProvider: '', sttProvider: '', recordLocation: false, dailyReminder: false,
    theme: 'light', aggregateDetailLevel: 3, sttMode: 'stream', videoVisionEnabled: true,
    videoFrameIntervalSec: 10, vlmProvider: '', keySource: 'byok',
  },
}))

import { db } from '@/data/db'
import { dexieStorage } from '@/adapters/dexieStorage'
import { setCurrentOwner } from '@/app/currentOwner'

beforeEach(async () => {
  db.close()
  await Dexie.delete('aiji')
  await db.open()
  setCurrentOwner('local')
})

describe('dexieStorage memories — partition isolation', () => {
  it('two owners cannot see each other memories', async () => {
    setCurrentOwner('A')
    await dexieStorage.saveMemory({ id: 'a1', content: 'A 的记忆', enabled: true, createdAt: '2026-07-01', updatedAt: '2026-07-01' })
    setCurrentOwner('B')
    await dexieStorage.saveMemory({ id: 'b1', content: 'B 的记忆', enabled: true, createdAt: '2026-07-01', updatedAt: '2026-07-01' })

    setCurrentOwner('A')
    expect((await dexieStorage.listMemories()).map((m) => m.id)).toEqual(['a1'])
    setCurrentOwner('B')
    expect((await dexieStorage.listMemories()).map((m) => m.id)).toEqual(['b1'])
  })

  it('saveMemory stamps current owner even if caller passes foreign ownerId', async () => {
    setCurrentOwner('A')
    await dexieStorage.saveMemory({ id: 'x1', ownerId: 'B', content: '试图写 B', enabled: true, createdAt: '2026-07-01', updatedAt: '2026-07-01' })
    // B 视角看不到
    setCurrentOwner('B')
    expect(await dexieStorage.listMemories()).toEqual([])
    // A 视角可见且 ownerId 被盖成 A
    setCurrentOwner('A')
    const list = await dexieStorage.listMemories()
    expect(list[0].ownerId).toBe('A')
  })

  it('deleteMemory only deletes current owner row', async () => {
    setCurrentOwner('A')
    await dexieStorage.saveMemory({ id: 'a1', content: 'A', enabled: true, createdAt: '2026-07-01', updatedAt: '2026-07-01' })
    // B 试图删 A 的记忆 → no-op
    setCurrentOwner('B')
    await dexieStorage.deleteMemory('a1')
    setCurrentOwner('A')
    expect((await dexieStorage.listMemories()).map((m) => m.id)).toEqual(['a1'])
    // A 自己删 → 生效
    await dexieStorage.deleteMemory('a1')
    expect(await dexieStorage.listMemories()).toEqual([])
  })

  it('listMemories sorts by updatedAt desc', async () => {
    setCurrentOwner('A')
    await dexieStorage.saveMemory({ id: 'old', content: '旧', enabled: true, createdAt: '2026-07-01', updatedAt: '2026-07-01T00:00:00Z' })
    await dexieStorage.saveMemory({ id: 'new', content: '新', enabled: true, createdAt: '2026-07-02', updatedAt: '2026-07-02T00:00:00Z' })
    const list = await dexieStorage.listMemories()
    expect(list.map((m) => m.id)).toEqual(['new', 'old'])
  })
})

// ── store action：落库 + 内存态一致 ──────────────────────────────────────────

const storeMocks = vi.hoisted(() => ({
  listMemories: vi.fn(),
  saveMemory: vi.fn(),
  deleteMemory: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      listMemories: () => storeMocks.listMemories(),
      saveMemory: (m: unknown) => storeMocks.saveMemory(m),
      deleteMemory: (id: string) => storeMocks.deleteMemory(id),
    },
  },
}))

import { useUiStore } from '@/app/store'

describe('store memory actions', () => {
  beforeEach(() => {
    // 重置 store 内存态（memories 空）
    useUiStore.setState({ memories: [] })
    storeMocks.listMemories.mockReset()
    storeMocks.saveMemory.mockReset()
    storeMocks.deleteMemory.mockReset()
    storeMocks.saveMemory.mockResolvedValue(undefined)
    storeMocks.deleteMemory.mockResolvedValue(undefined)
  })

  it('saveMemory 落库 + 内存态追加 enabled 记忆', async () => {
    await useUiStore.getState().saveMemory('我对花生过敏')
    expect(storeMocks.saveMemory).toHaveBeenCalledTimes(1)
    const saved = storeMocks.saveMemory.mock.calls[0][0] as { content: string; enabled: boolean; id: string }
    expect(saved.content).toBe('我对花生过敏')
    expect(saved.enabled).toBe(true)
    expect(typeof saved.id).toBe('string')
    // 内存态追加
    expect(useUiStore.getState().memories).toHaveLength(1)
    expect(useUiStore.getState().memories[0].content).toBe('我对花生过敏')
  })

  it('saveMemory 空串 no-op', async () => {
    await useUiStore.getState().saveMemory('   ')
    expect(storeMocks.saveMemory).not.toHaveBeenCalled()
    expect(useUiStore.getState().memories).toHaveLength(0)
  })

  it('toggleMemory 翻转 enabled + 落库 + 内存态更新', async () => {
    useUiStore.setState({ memories: [{ id: 'm1', content: 'c', enabled: true, createdAt: '2026-07-01', updatedAt: '2026-07-01' }] })
    await useUiStore.getState().toggleMemory('m1')
    expect(storeMocks.saveMemory).toHaveBeenCalledTimes(1)
    const saved = storeMocks.saveMemory.mock.calls[0][0] as { id: string; enabled: boolean }
    expect(saved.id).toBe('m1')
    expect(saved.enabled).toBe(false)
    expect(useUiStore.getState().memories[0].enabled).toBe(false)
  })

  it('deleteMemory 落库 + 内存态过滤', async () => {
    useUiStore.setState({ memories: [
      { id: 'm1', content: 'a', enabled: true, createdAt: '2026-07-01', updatedAt: '2026-07-01' },
      { id: 'm2', content: 'b', enabled: true, createdAt: '2026-07-01', updatedAt: '2026-07-01' },
    ] })
    await useUiStore.getState().deleteMemory('m1')
    expect(storeMocks.deleteMemory).toHaveBeenCalledWith('m1')
    expect(useUiStore.getState().memories.map((m) => m.id)).toEqual(['m2'])
  })
})
