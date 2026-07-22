import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { Entry } from '@/domain/types'

// 把 seed 模块 mock 成空——ensureSeeded 在 DEV 下会跑，空数组 bulkPut 是 no-op，
// 不污染分区测试。seedSettings 给最小合法形状（getSettings 兜底用，本测试不触）。
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

function mkEntry(id: string): Entry {
  return {
    id,
    createdAt: '2026-07-15T08:00:00+08:00',
    updatedAt: '2026-07-15T08:00:00+08:00',
    status: 'ready',
    parts: [],
  }
}

beforeEach(async () => {
  db.close()
  await Dexie.delete('aiji')
  // 显式 close 后 Dexie 不会自动重开——需 db.open() 才能被 dexieStorage 使用。
  await db.open()
  setCurrentOwner('local')
})

describe('account partition — listEntries isolation', () => {
  it('two owners cannot see each other entries', async () => {
    setCurrentOwner('A')
    await dexieStorage.saveEntry(mkEntry('a1'))
    setCurrentOwner('B')
    await dexieStorage.saveEntry(mkEntry('b1'))

    setCurrentOwner('A')
    expect((await dexieStorage.listEntries()).map((e) => e.id)).toEqual(['a1'])

    setCurrentOwner('B')
    expect((await dexieStorage.listEntries()).map((e) => e.id)).toEqual(['b1'])
  })

  it('getEntry returns undefined for cross-owner id read', async () => {
    setCurrentOwner('A')
    await dexieStorage.saveEntry(mkEntry('a1'))
    setCurrentOwner('B')
    expect(await dexieStorage.getEntry('a1')).toBeUndefined()
    // 同 owner 仍可读
    setCurrentOwner('A')
    expect((await dexieStorage.getEntry('a1'))?.id).toBe('a1')
  })

  it('saveEntry stamps current owner even if caller passes a foreign ownerId', async () => {
    setCurrentOwner('A')
    // 调用方试图写入 B 的 ownerId——save 必须盖章成当前 owner A
    await dexieStorage.saveEntry({ ...mkEntry('x1'), ownerId: 'B' })
    setCurrentOwner('B')
    expect(await dexieStorage.getEntry('x1')).toBeUndefined()
    setCurrentOwner('A')
    expect((await dexieStorage.getEntry('x1'))?.ownerId).toBe('A')
  })

  it('categories/tags partitioned per owner', async () => {
    // 注：categories/tags 的 keyPath 是 slug（非复合键），两 owner 用相同 slug 会 put 覆盖——
    // 这是「索引分区」相对「复合键分区」的已知限制，单用户手机模型下可接受（adoptLocal 后只剩一份 owner）。
    // 本测试用不同 slug 验证隔离语义。
    setCurrentOwner('A')
    await dexieStorage.saveCategory({ slug: 'idea', label: '想法', aliases: [], usageCount: 1, createdAt: '2026-07-01' })
    setCurrentOwner('B')
    await dexieStorage.saveCategory({ slug: 'work', label: '工作', aliases: [], usageCount: 1, createdAt: '2026-07-01' })

    setCurrentOwner('A')
    const aCats = await dexieStorage.listCategories()
    expect(aCats.map((c) => c.slug)).toEqual(['idea'])
    setCurrentOwner('B')
    const bCats = await dexieStorage.listCategories()
    expect(bCats.map((c) => c.slug)).toEqual(['work'])
  })
})

describe('account partition — adoptLocal', () => {
  it('local rows re-stamped to accountId, invisible under local afterwards', async () => {
    setCurrentOwner('local')
    await dexieStorage.saveEntry(mkEntry('l1'))
    await dexieStorage.saveCategory({ slug: 'idea', label: '想法', aliases: [], usageCount: 1, createdAt: '2026-07-01' })

    await dexieStorage.adoptLocal('net-1')

    // adopt 后 local 视角查不到（数据已归 net-1）
    setCurrentOwner('local')
    expect(await dexieStorage.listEntries()).toEqual([])
    expect(await dexieStorage.listCategories()).toEqual([])

    // 切到 net-1 可见
    setCurrentOwner('net-1')
    expect((await dexieStorage.listEntries()).map((e) => e.id)).toEqual(['l1'])
    expect((await dexieStorage.listCategories()).map((c) => c.slug)).toEqual(['idea'])
  })

  it('adoptLocal only moves local rows; other owners untouched', async () => {
    setCurrentOwner('A')
    await dexieStorage.saveEntry(mkEntry('a1'))
    setCurrentOwner('local')
    await dexieStorage.saveEntry(mkEntry('l1'))

    await dexieStorage.adoptLocal('net-1')

    // A 的数据不受影响
    setCurrentOwner('A')
    expect((await dexieStorage.listEntries()).map((e) => e.id)).toEqual(['a1'])
    // local 已被收养到 net-1
    setCurrentOwner('local')
    expect(await dexieStorage.listEntries()).toEqual([])
    setCurrentOwner('net-1')
    expect((await dexieStorage.listEntries()).map((e) => e.id)).toEqual(['l1'])
  })
})
