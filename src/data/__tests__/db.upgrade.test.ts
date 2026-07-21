import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { db } from '@/data/db'

// v6 schema 快照（db.ts v6 声明逐字抄录）——用于在 v7 upgrade 前种入无 ownerId 的存量行。
const V6_STORES = {
  entries: 'id, createdAt, updatedAt, status, deletedAt',
  entryAi: 'id, entryId, version',
  categories: 'slug, usageCount',
  tags: 'slug, usageCount',
  aggregates: 'id, scope.type, scope.range, stale',
  settings: '++id',
  reminders: 'id, dueAt, status, entryId',
  drafts: 'id, updatedAt',
  conversations: 'id, updatedAt',
}

beforeEach(async () => {
  db.close()
  await Dexie.delete('aiji')
})

describe('db v6→v7 upgrade — ownerId backfill', () => {
  it('existing rows without ownerId get backfilled to "local"', async () => {
    // 1. 用纯 v6 schema 种存量数据（无 ownerId 字段，模拟升级前旧库）
    const v6 = new Dexie('aiji')
    v6.version(6).stores(V6_STORES)
    await v6.open()
    await v6.entries.put({
      id: 'e1', createdAt: '2026-07-15T08:00:00+08:00', updatedAt: '2026-07-15T08:00:00+08:00',
      status: 'ready', parts: [],
    })
    await v6.categories.put({ slug: 'idea', label: '想法', aliases: [], usageCount: 1, createdAt: '2026-07-01' })
    await v6.tags.put({ slug: 'aiji', label: 'AiJi', usageCount: 1, createdAt: '2026-07-04' })
    await v6.aggregates.put({
      id: 'ag1', scope: { type: 'day', range: '2026-07-15' }, summary: 's', entryIds: [],
      modelUsed: 'm', createdAt: '2026-07-15', stale: false,
    })
    await v6.reminders.put({
      id: 'r1', entryId: 'e1', dueAt: '2026-07-16T10:00:00+08:00', label: 'x',
      status: 'pending', createdAt: '2026-07-15',
    })
    await v6.conversations.put({ id: 'c1', messages: [], updatedAt: '2026-07-15' })
    v6.close()

    // 2. 用真实 db（声明到 v7）打开 → 触发 v7 upgrade 回填 ownerId='local'
    await db.open()

    expect((await db.entries.get('e1'))?.ownerId).toBe('local')
    expect((await db.categories.get('idea'))?.ownerId).toBe('local')
    expect((await db.tags.get('aiji'))?.ownerId).toBe('local')
    expect((await db.aggregates.get('ag1'))?.ownerId).toBe('local')
    expect((await db.reminders.get('r1'))?.ownerId).toBe('local')
    expect((await db.conversations.get('c1'))?.ownerId).toBe('local')

    db.close()
  })

  it('v7 adds ownerId index (queryable)', async () => {
    // 直接以真实 db 打开空库 → v7 schema 生效 → ownerId 索引可查。
    await db.open()
    await db.entries.put({
      id: 'e1', ownerId: 'local', createdAt: '2026-07-15T08:00:00+08:00',
      updatedAt: '2026-07-15T08:00:00+08:00', status: 'ready', parts: [],
    })
    const localRows = await db.entries.where('ownerId').equals('local').toArray()
    expect(localRows).toHaveLength(1)
    db.close()
  })
})
