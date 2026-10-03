// db v10（2026-10-03 P-B）：v9→v10 迁移（v9 数据保留 + embeddings 新表可读写）
// + data/embeddings 持久化 helpers（owner 分区过滤 + save 盖章）。
import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '@/data/db'

// 把 seed 模块 mock 成空——ensureSeeded 在 DEV 下会跑，空数组 bulkPut 是 no-op，不污染 schema 测试。
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

import { getEmbedding, saveEmbedding, listEmbeddings } from '@/data/embeddings'
import { setCurrentOwner } from '@/app/currentOwner'

// v9 schema 快照（db.ts v9 声明逐字抄录）——种入 v9 存量数据后触发 v10 升级。
const V9_STORES = {
  entries: 'id, createdAt, updatedAt, status, deletedAt, ownerId',
  entryAi: 'id, entryId, version',
  categories: 'slug, usageCount, ownerId',
  tags: 'slug, usageCount, ownerId',
  aggregates: 'id, scope.type, scope.range, stale, ownerId',
  settings: '++id',
  reminders: 'id, dueAt, status, entryId, ownerId',
  drafts: 'id, updatedAt',
  conversations: 'id, updatedAt, ownerId',
  memories: 'id, ownerId, updatedAt',
  syncOutbox: '++seq, &[ownerId+kind+id], ownerId',
  syncMedia: 'ref',
  syncState: 'key',
}

beforeEach(async () => {
  setCurrentOwner('local')
  db.close()
  await Dexie.delete('aiji')
})

describe('db v9→v10 迁移', () => {
  it('v9 存量数据保留 + embeddings 新表可读写', async () => {
    // 1. 用纯 v9 schema 种存量数据（无 embeddings 表，模拟升级前旧库）
    const v9 = new Dexie('aiji')
    v9.version(9).stores(V9_STORES)
    await v9.open()
    await v9.entries.put({
      id: 'e1', ownerId: 'local', createdAt: '2026-10-01T08:00:00+08:00',
      updatedAt: '2026-10-01T08:00:00+08:00', status: 'ready', parts: [],
    })
    await v9.conversations.put({ id: 'c1', ownerId: 'local', messages: [], updatedAt: '2026-10-01' })
    await v9.memories.put({ id: 'm1', ownerId: 'local', content: 'x', enabled: true, createdAt: 't', updatedAt: 't' })
    v9.close()

    // 2. 用真实 db（声明到 v10）打开 → 升级，v9 数据应原样保留
    await db.open()
    expect((await db.entries.get('e1'))?.status).toBe('ready')
    expect((await db.conversations.get('c1'))?.ownerId).toBe('local')
    expect((await db.memories.get('m1'))?.content).toBe('x')

    // 3. 新表可读写 + 索引生效（ownerId 过滤）
    await db.embeddings.put({
      entryId: 'e1', ownerId: 'local', vector: [0.1, 0.2], model: 'm', textHash: 'h', updatedAt: 't',
    })
    expect((await db.embeddings.get('e1'))?.textHash).toBe('h')
    expect(await db.embeddings.where('ownerId').equals('local').count()).toBe(1)
    db.close()
  })
})

describe('data/embeddings helpers', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('save/get/list 往返；save 强制盖章当前 owner', async () => {
    setCurrentOwner('u-net')
    // 调用方传错 owner 也会被盖章成当前 owner（分区安全，同 dexieStorage 约定）。
    await saveEmbedding({ entryId: 'e1', ownerId: 'wrong', vector: [1, 0], model: 'm', textHash: 'h1', updatedAt: 't' })
    expect((await getEmbedding('e1'))?.ownerId).toBe('u-net')
    expect(await listEmbeddings()).toHaveLength(1)
    expect(await listEmbeddings('other')).toHaveLength(0)
  })

  it('同 entryId 覆盖写（put upsert）', async () => {
    await saveEmbedding({ entryId: 'e1', ownerId: 'local', vector: [1], model: 'm', textHash: 'old', updatedAt: 't' })
    await saveEmbedding({ entryId: 'e1', ownerId: 'local', vector: [2], model: 'm', textHash: 'new', updatedAt: 't2' })
    expect(await db.embeddings.count()).toBe(1)
    expect((await getEmbedding('e1'))?.textHash).toBe('new')
  })

  it('listEmbeddings 默认按当前 owner 过滤', async () => {
    setCurrentOwner('local')
    await db.embeddings.bulkPut([
      { entryId: 'e1', ownerId: 'local', vector: [1], model: 'm', textHash: 'h', updatedAt: 't' },
      { entryId: 'e2', ownerId: 'u2', vector: [1], model: 'm', textHash: 'h', updatedAt: 't' },
    ])
    const rows = await listEmbeddings()
    expect(rows.map((r) => r.entryId)).toEqual(['e1'])
    expect(await listEmbeddings('u2')).toHaveLength(1)
  })
})
