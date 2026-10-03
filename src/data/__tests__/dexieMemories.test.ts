// P-C（2026-10-03 spec §4）注入过滤数据层：dexieStorage.listMemories 可选 activeOnly 参数。
// 默认返回全部（设置页展示归档组）；activeOnly=true 只返 prompt 注入集（enabled && 未归档）。
import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { Memory } from '@/domain/types'

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

// 端口签名同步前（lead 契约一行之差），经具体实现的可选参数调用——类型断言绕开 StoragePort 窄签名。
const listMemories = dexieStorage.listMemories as unknown as (opts?: {
  activeOnly?: boolean
}) => Promise<Memory[]>

function mkMemory(id: string, over: Partial<Memory> = {}): Memory {
  return {
    id,
    content: `记忆 ${id}`,
    enabled: true,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...over,
  }
}

beforeEach(async () => {
  setCurrentOwner('local')
  db.close()
  await Dexie.delete('aiji')
  await db.open()
})

describe('listMemories activeOnly 注入过滤', () => {
  it('默认返回全部（含停用/归档），updatedAt 倒序', async () => {
    await dexieStorage.saveMemory(mkMemory('m1', { updatedAt: '2026-10-01T08:00:00.000Z' }))
    await dexieStorage.saveMemory(mkMemory('m2', { enabled: false, updatedAt: '2026-10-02T08:00:00.000Z' }))
    await dexieStorage.saveMemory(mkMemory('m3', { archivedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T08:00:00.000Z' }))
    const all = await listMemories()
    expect(all.map((m) => m.id)).toEqual(['m3', 'm2', 'm1'])
  })

  it('activeOnly=true：只返 enabled && 未归档（prompt 注入集）', async () => {
    await dexieStorage.saveMemory(mkMemory('m1'))
    await dexieStorage.saveMemory(mkMemory('m2', { enabled: false }))
    await dexieStorage.saveMemory(mkMemory('m3', { archivedAt: '2026-10-03T00:00:00.000Z' }))
    const active = await listMemories({ activeOnly: true })
    expect(active.map((m) => m.id)).toEqual(['m1'])
  })

  it('owner 分区两种模式都生效（他人记忆不可见）', async () => {
    await dexieStorage.saveMemory(mkMemory('mine'))
    setCurrentOwner('other')
    await dexieStorage.saveMemory(mkMemory('theirs'))
    setCurrentOwner('local')
    expect((await listMemories()).map((m) => m.id)).toEqual(['mine'])
    expect((await listMemories({ activeOnly: true })).map((m) => m.id)).toEqual(['mine'])
  })
})
