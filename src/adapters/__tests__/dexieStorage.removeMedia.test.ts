import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { Entry } from '@/domain/types'

// 同 dexieStorage.partition.test.ts：seed mock 成空，ensureSeeded DEV 分支 no-op。
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

// Q6：硬删路径（trash 永久删除 + 30 天 purge）清 OPFS 媒体时需同步删 poster 帧
//（`${ref}.poster`，见 domain/mediaRef.posterRefOf）——否则主 blob 删了 poster 成孤儿
// 泄漏配额（iOS 尤甚）。jsdom 无 navigator.storage.getDirectory → mock OPFS 根目录。

function mkEntry(id: string): Entry {
  return {
    id,
    createdAt: '2026-10-05T08:00:00+08:00',
    updatedAt: '2026-10-05T08:00:00+08:00',
    status: 'ready',
    parts: [
      { type: 'text', content: 'hello' },
      { type: 'audio', ref: 'audio-1', durationSec: 3, mime: 'audio/webm' },
      { type: 'video', ref: 'video-1', durationSec: 5, mime: 'video/webm' },
    ],
  }
}

const removeEntry = vi.fn((_name: string): Promise<void> => Promise.resolve())

beforeEach(async () => {
  removeEntry.mockClear()
  Object.defineProperty(navigator, 'storage', {
    value: { getDirectory: async () => ({ removeEntry }) },
    configurable: true,
  })
  db.close()
  await Dexie.delete('aiji')
  await db.open()
  setCurrentOwner('local')
})

afterEach(() => {
  delete (navigator as { storage?: unknown }).storage
})

function removedNames(): string[] {
  return removeEntry.mock.calls.map((c) => c[0] as string)
}

describe('removeMediaForEntry poster 清理', () => {
  it('deleteEntry：audio/video 主 blob 与 poster 帧同步删，text part 跳过', async () => {
    await dexieStorage.saveEntry(mkEntry('e1'))
    await dexieStorage.deleteEntry('e1')
    const names = removedNames()
    expect(names).toContain('audio-1')
    expect(names).toContain('audio-1.poster')
    expect(names).toContain('video-1')
    expect(names).toContain('video-1.poster')
    expect(names).toHaveLength(4)
    expect(await dexieStorage.getEntry('e1')).toBeUndefined()
  })

  it('purgeExpired：过期回收项同样清 poster', async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    await dexieStorage.saveEntry({ ...mkEntry('e2'), deletedAt: old })
    expect(await dexieStorage.purgeExpired()).toBe(1)
    const names = removedNames()
    expect(names).toContain('video-1.poster')
    expect(names).toContain('audio-1.poster')
  })

  it('OPFS removeEntry 拒绝（文件不存在）→ best-effort，删除主流程不受影响', async () => {
    removeEntry.mockImplementation(() => Promise.reject(new Error('NotFoundError')))
    await dexieStorage.saveEntry(mkEntry('e3'))
    await expect(dexieStorage.deleteEntry('e3')).resolves.toBeUndefined()
    expect(await dexieStorage.getEntry('e3')).toBeUndefined()
    expect(removeEntry).toHaveBeenCalled()
  })
})
