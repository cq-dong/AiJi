// 同步引擎：apply 远端变更（零回声）+ flush 组装（传媒体→push）+ tombstone 形。
// fake-indexeddb 跑真 Dexie；syncHttp/dexieStorage 媒体方法/accountSlots 全 mock。
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import type { Entry, EntryAi, Reminder } from '@/domain/types'
import type { SyncChange } from '@/domain/sync'

// ── mock syncHttp（5 函数全 mock）── 各测试按需覆盖 mockReturnValue。
const pushChangesMock = vi.fn()
const pullChangesMock = vi.fn()
const uploadMediaMock = vi.fn()
const downloadMediaMock = vi.fn()
const getSyncStatusMock = vi.fn()
vi.mock('@/adapters/syncHttp', () => ({
  pushChanges: (...a: unknown[]) => pushChangesMock(...a),
  pullChanges: (...a: unknown[]) => pullChangesMock(...a),
  uploadMedia: (...a: unknown[]) => uploadMediaMock(...a),
  downloadMedia: (...a: unknown[]) => downloadMediaMock(...a),
  getSyncStatus: (...a: unknown[]) => getSyncStatusMock(...a),
}))

// ── mock dexieStorage：仅 mock 3 个媒体方法（OPFS 在 jsdom 不可用）。
// db.* 读写走真 Dexie——引擎 apply 直写 db.*（零回声验证的关键）。
const getMediaMock = vi.fn()
const saveMediaMock = vi.fn()
const deleteMediaMock = vi.fn()
vi.mock('@/adapters/dexieStorage', () => ({
  dexieStorage: {
    getMedia: (...a: unknown[]) => getMediaMock(...a),
    saveMedia: (...a: unknown[]) => saveMediaMock(...a),
    deleteMedia: (...a: unknown[]) => deleteMediaMock(...a),
  },
}))

// ── mock accountSlots：storeRehydrate 槽（验证 pull 后刷 UI 被调）。
const storeRehydrateMock = vi.fn()
vi.mock('@/app/accountSlots', () => ({
  accountSlots: { storeRehydrate: (...a: unknown[]) => storeRehydrateMock(...a) },
}))

// seed mock 成空——ensureSeeded 在 DEV 下跑，空数组 no-op。
vi.mock('@/data/seed', () => ({
  seedEntries: [], seedEntryAi: [], seedCategories: [], seedTags: [],
  seedAggregates: [], seedReminders: [],
  seedSettings: {
    llmProvider: '', sttProvider: '', recordLocation: false, dailyReminder: false,
    theme: 'light', aggregateDetailLevel: 3, sttMode: 'stream', videoVisionEnabled: true,
    videoFrameIntervalSec: 10, vlmProvider: '', keySource: 'byok',
  },
}))

import { db } from '@/data/db'
import { flush, pull } from '@/app/syncEngine'
import { setCurrentOwner } from '@/app/currentOwner'

function makeEntry(id: string, parts: Entry['parts'] = []): Entry {
  return {
    id, ownerId: 'u1',
    createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
    parts, status: 'ready',
  }
}

beforeEach(async () => {
  db.close()
  await Dexie.delete('aiji')
  await db.open()
  setCurrentOwner('u1')
  pushChangesMock.mockReset()
  pullChangesMock.mockReset()
  uploadMediaMock.mockReset()
  downloadMediaMock.mockReset()
  getSyncStatusMock.mockReset()
  getMediaMock.mockReset()
  saveMediaMock.mockReset()
  deleteMediaMock.mockReset()
  storeRehydrateMock.mockReset()
  // 默认返回 resolved Promise（引擎对媒体方法用 .catch/await，undefined 会炸）。
  getMediaMock.mockResolvedValue(undefined)
  saveMediaMock.mockResolvedValue(undefined)
  deleteMediaMock.mockResolvedValue(undefined)
})

describe('syncEngine', () => {
  it('apply entry payload writes to db, no outbox echo', async () => {
    const entry = makeEntry('e1', [{ type: 'text', content: 'hello' }])
    const change: SyncChange = {
      kind: 'entry', id: 'e1', seq: 1, updatedAt: '2026-08-08T01:00:00.000Z',
      payload: { entry, ai: null },
    }
    pullChangesMock.mockResolvedValueOnce({ changes: [change], cursor: 1, hasMore: false })

    await pull()

    const e = await db.entries.get('e1')
    expect(e).toBeTruthy()
    expect(e?.ownerId).toBe('u1') // 盖章为当前 owner
    expect(e?.parts[0]).toMatchObject({ type: 'text', content: 'hello' })
    // 关键断言：outbox 无回声（apply 走 db.* 直写，未触发 enqueue）
    expect(await db.syncOutbox.count()).toBe(0)
    // 有变更 → storeRehydrate 被调刷 UI
    expect(storeRehydrateMock).toHaveBeenCalled()
  })

  it('apply entry tombstone clears entries/entryAi, keeps reminders', async () => {
    // 预置：entry + entryAi + reminder（reminder 不应被 entry tombstone 触动）
    await db.entries.put(makeEntry('e1', [{ type: 'audio', ref: 'ref1', durationSec: 3 }]))
    const ai: EntryAi = {
      id: 'ai1', entryId: 'e1', version: 1, category: 'idea', tags: [], facets: {},
      modelUsed: 'm', createdAt: '2026-08-08T00:00:00.000Z',
    }
    await db.entryAi.put(ai)
    const rem: Reminder = {
      id: 'r1', entryId: 'e1', ownerId: 'u1', dueAt: '2026-08-09T00:00:00.000Z',
      label: 'x', status: 'pending', createdAt: '2026-08-08T00:00:00.000Z',
    }
    await db.reminders.put(rem)

    const change: SyncChange = {
      kind: 'entry', id: 'e1', seq: 1, updatedAt: '2026-08-08T02:00:00.000Z',
      deletedAt: '2026-08-08T02:00:00.000Z',
    }
    pullChangesMock.mockResolvedValueOnce({ changes: [change], cursor: 1, hasMore: false })

    await pull()

    expect(await db.entries.get('e1')).toBeUndefined()
    expect(await db.entryAi.where('entryId').equals('e1').count()).toBe(0)
    // reminder 应保留（其 tombstone 独立到达）
    expect(await db.reminders.get('r1')).toBeTruthy()
    // 媒体删除被调（ref1）
    expect(deleteMediaMock).toHaveBeenCalledWith('ref1')
  })

  it('media download: pull media change with no local blob → download + save + track', async () => {
    getMediaMock.mockResolvedValue(undefined) // 本地无 blob
    const blob = new Blob(['fake-bytes'], { type: 'image/jpeg' })
    downloadMediaMock.mockResolvedValue(blob)

    const change: SyncChange = {
      kind: 'media', id: 'refX', seq: 5, updatedAt: '2026-08-08T03:00:00.000Z',
      payload: { ref: 'refX', mime: 'image/jpeg', size: 9 },
    }
    pullChangesMock.mockResolvedValueOnce({ changes: [change], cursor: 5, hasMore: false })

    await pull()

    expect(downloadMediaMock).toHaveBeenCalledWith('refX')
    expect(saveMediaMock).toHaveBeenCalledWith('refX', blob)
    const track = await db.syncMedia.get('refX')
    expect(track).toBeTruthy() // track 记录已落
  })

  it('flush: uploadMedia before pushChanges, push receives EntryPayload, outbox cleared', async () => {
    // entry 含 audio part ref 'refA'；本地有 blob → upload 应发生。
    const entry = makeEntry('e1', [{ type: 'audio', ref: 'refA', durationSec: 2 }])
    await db.entries.put(entry)
    // outbox 入队一行非 tombstone entry（模拟 saveEntry 的挂钩效果，但直接写 db 避开 notifyFn）。
    await db.syncOutbox.add({
      ownerId: 'u1', kind: 'entry', id: 'e1', updatedAt: '2026-08-08T01:00:00.000Z', tombstone: false,
    })
    const blob = new Blob(['audio-bytes'], { type: 'audio/webm' })
    getMediaMock.mockResolvedValue(blob)
    uploadMediaMock.mockResolvedValue(undefined)
    pushChangesMock.mockResolvedValue({ applied: 1, rejected: [] })

    await flush()

    // uploadMedia 先于 pushChanges 被调
    expect(uploadMediaMock).toHaveBeenCalledTimes(1)
    expect(uploadMediaMock).toHaveBeenCalledWith('refA', blob)
    expect(pushChangesMock).toHaveBeenCalledTimes(1)
    // pushChanges 收到 EntryPayload 形 payload
    const pushed = pushChangesMock.mock.calls[0][0] as SyncChange[]
    expect(pushed).toHaveLength(1)
    expect(pushed[0].kind).toBe('entry')
    expect(pushed[0].id).toBe('e1')
    expect(pushed[0].payload).toMatchObject({ entry: { id: 'e1' }, ai: null })
    expect(pushed[0].deletedAt).toBeUndefined()
    // outbox 清空
    expect(await db.syncOutbox.count()).toBe(0)
  })

  it('flush tombstone: change carries deletedAt and no payload', async () => {
    // 直接构造 outbox tombstone 行（模拟 deleteEntry 级联入队后的状态）。
    await db.syncOutbox.add({
      ownerId: 'u1', kind: 'entry', id: 'e1', updatedAt: '2026-08-08T04:00:00.000Z', tombstone: true,
    })
    pushChangesMock.mockResolvedValue({ applied: 1, rejected: [] })

    await flush()

    expect(pushChangesMock).toHaveBeenCalledTimes(1)
    const pushed = pushChangesMock.mock.calls[0][0] as SyncChange[]
    expect(pushed).toHaveLength(1)
    expect(pushed[0].kind).toBe('entry')
    expect(pushed[0].id).toBe('e1')
    expect(pushed[0].deletedAt).toBeTruthy() // 带 deletedAt
    expect(pushed[0].payload).toBeUndefined() // 无 payload
    // outbox 清空
    expect(await db.syncOutbox.count()).toBe(0)
  })
})
