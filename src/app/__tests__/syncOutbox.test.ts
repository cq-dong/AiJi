// outbox 挂钩：saveEntry→入队；重复 save 去重；deleteEntry→entry+reminder+media 三 tombstone；
// trashEntry→非 tombstone 更新；adoptLocal→全量入队。fake-indexeddb 跑真 Dexie。
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import type { Entry, Reminder } from '@/domain/types'

// 把 seed mock 成空——ensureSeeded 在 DEV 下会跑，空数组 bulkPut 是 no-op，不污染挂钩测试。
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

function makeEntry(id: string): Entry {
  return {
    id, ownerId: 'u1', createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
    parts: [{ type: 'audio', ref: 'ref1', durationSec: 3 }], status: 'ready',
  }
}

beforeEach(async () => {
  db.close()
  await Dexie.delete('aiji')
  await db.open()
  setCurrentOwner('u1')
})

describe('syncOutbox hooks', () => {
  it('saveEntry enqueues, repeated save dedups', async () => {
    await dexieStorage.saveEntry(makeEntry('e1'))
    await dexieStorage.saveEntry(makeEntry('e1'))
    const rows = await db.syncOutbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ownerId: 'u1', kind: 'entry', id: 'e1', tombstone: false })
  })

  it('deleteEntry enqueues entry+reminder+media tombstones', async () => {
    await dexieStorage.saveEntry(makeEntry('e1'))
    const rem: Reminder = {
      id: 'r1', entryId: 'e1', dueAt: '2026-08-09T00:00:00.000Z',
      label: 'x', status: 'pending', createdAt: '2026-08-08T00:00:00.000Z',
    }
    await dexieStorage.saveReminder(rem)
    await db.syncOutbox.clear()
    await dexieStorage.deleteEntry('e1')
    const tombs = (await db.syncOutbox.toArray()).filter((r) => r.tombstone)
    const keys = tombs.map((r) => `${r.kind}:${r.id}`).sort()
    expect(keys).toEqual(['entry:e1', 'media:ref1', 'reminder:r1'])
  })

  it('trashEntry enqueues non-tombstone update', async () => {
    await dexieStorage.saveEntry(makeEntry('e1'))
    await db.syncOutbox.clear()
    await dexieStorage.trashEntry('e1')
    const rows = await db.syncOutbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].tombstone).toBe(false)
  })

  it('recoverEntry enqueues non-tombstone update', async () => {
    await dexieStorage.saveEntry(makeEntry('e1'))
    await dexieStorage.trashEntry('e1')
    await db.syncOutbox.clear()
    await dexieStorage.recoverEntry('e1')
    const rows = await db.syncOutbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].tombstone).toBe(false)
  })

  it('deleteCategory enqueues category tombstone', async () => {
    await dexieStorage.saveCategory({
      slug: 'idea', label: '想法', aliases: [], usageCount: 1, createdAt: '2026-08-08T00:00:00.000Z',
    })
    await db.syncOutbox.clear()
    await dexieStorage.deleteCategory('idea')
    const rows = await db.syncOutbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'category', id: 'idea', tombstone: true })
  })

  it('adoptLocal enqueues entries/categories/tags/reminders (trashed not tombstone)', async () => {
    setCurrentOwner('local')
    const e1: Entry = {
      id: 'l1', ownerId: 'local', createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
      parts: [], status: 'ready',
    }
    // a trashed entry (deletedAt set) — must enqueue as non-tombstone update
    const e2: Entry = {
      id: 'l2', ownerId: 'local', createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
      parts: [], status: 'ready', deletedAt: '2026-08-08T01:00:00.000Z',
    }
    await dexieStorage.saveEntry(e1)
    await dexieStorage.saveEntry(e2)
    await dexieStorage.saveCategory({
      slug: 'c1', label: 'C', aliases: [], usageCount: 1, createdAt: '2026-08-08T00:00:00.000Z',
    })
    await dexieStorage.saveTag({
      slug: 't1', label: 'T', usageCount: 1, createdAt: '2026-08-08T00:00:00.000Z',
    })
    await dexieStorage.saveReminder({
      id: 'r1', entryId: 'l1', dueAt: '2026-08-09T00:00:00.000Z',
      label: 'x', status: 'pending', createdAt: '2026-08-08T00:00:00.000Z',
    })
    await db.syncOutbox.clear()
    await dexieStorage.adoptLocal('net-1')

    const rows = await db.syncOutbox.toArray()
    // 2 entries + 1 category + 1 tag + 1 reminder = 5 enqueued rows
    expect(rows).toHaveLength(5)
    // none tombstone (trashed entry carries deletedAt in payload, not as tombstone)
    expect(rows.every((r) => !r.tombstone)).toBe(true)
    const ids = rows.map((r) => `${r.kind}:${r.id}`).sort()
    expect(ids).toEqual(['category:c1', 'entry:l1', 'entry:l2', 'reminder:r1', 'tag:t1'])
    // all stamped with adopted owner
    expect(rows.every((r) => r.ownerId === 'net-1')).toBe(true)
  })
})
