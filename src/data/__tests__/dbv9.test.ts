// v9 schema：三张同步表可写读；syncOutbox 复合唯一约束生效（同 ownerId+kind+id add 两次 → ConstraintError）。
import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '@/data/db'

// 把 seed 模块 mock成空——ensureSeeded 在 DEV 下会跑，空数组 bulkPut 是 no-op，不污染 schema 测试。
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

beforeEach(async () => {
  db.close()
  await Dexie.delete('aiji')
  await db.open()
})

describe('db v9 sync tables', () => {
  it('syncOutbox/syncMedia/syncState writable and readable', async () => {
    await db.syncOutbox.add({
      ownerId: 'u1', kind: 'entry', id: 'e-readable', updatedAt: '2026-08-08T00:00:00.000Z', tombstone: false,
    })
    await db.syncMedia.put({ ref: 'r1', uploadedAt: '2026-08-08T00:00:00.000Z' })
    await db.syncState.put({ key: 'lastPullSeq:u1', value: 42 })

    expect(await db.syncOutbox.count()).toBe(1)
    const row = await db.syncOutbox.where('[ownerId+kind+id]').equals(['u1', 'entry', 'e-readable']).first()
    expect(row?.tombstone).toBe(false)
    expect(await db.syncMedia.get('r1')).toBeTruthy()
    expect((await db.syncState.get('lastPullSeq:u1'))?.value).toBe(42)
  })

  it('syncOutbox compound unique rejects duplicate ownerId+kind+id', async () => {
    // 独立干净库（beforeEach 已 delete+reopen），直接连续 add 同复合键第二次必须抛 ConstraintError。
    const first = {
      ownerId: 'u1', kind: 'entry', id: 'e1', updatedAt: '2026-08-08T01:00:00.000Z', tombstone: false,
    }
    await db.syncOutbox.add(first)
    // 第二次同 [ownerId+kind+id] 必须被唯一约束挡住——这才是复合唯一约束的真实断言。
    await expect(
      db.syncOutbox.add({
        ownerId: 'u1', kind: 'entry', id: 'e1', updatedAt: '2026-08-08T02:00:00.000Z', tombstone: true,
      }),
    ).rejects.toThrow()
    // 确认只有第一行存在（第二次没落）
    expect(await db.syncOutbox.count()).toBe(1)
    const rows = await db.syncOutbox.toArray()
    expect(rows[0].tombstone).toBe(false)
  })

  it('syncOutbox different ownerId or id coexist (compound key scopes correctly)', async () => {
    // 不同 owner 同 id 不冲突；同 owner 不同 id 也不冲突——证明约束是三元组复合。
    await db.syncOutbox.add({ ownerId: 'u1', kind: 'entry', id: 'e1', updatedAt: 't', tombstone: false })
    await db.syncOutbox.add({ ownerId: 'u2', kind: 'entry', id: 'e1', updatedAt: 't', tombstone: false })
    await db.syncOutbox.add({ ownerId: 'u1', kind: 'entry', id: 'e2', updatedAt: 't', tombstone: false })
    expect(await db.syncOutbox.count()).toBe(3)
  })
})
