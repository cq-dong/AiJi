// W0（2026-10-04）orphan embeddings 惰性 GC data 层测试：
// deleteEntry/trashEntry/hydrate purge 均不触 embeddings 表，向量行（~6KB/行）永久残留。
// deleteStaleEmbeddings(validIds)：list 当前 owner 全量 → 收集不在 validIds 的行 → bulkDelete
// → 返回删除数。分区安全：只扫当前 owner，其他 owner 的行不受牵连。
import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { db } from '@/data/db'
import { deleteStaleEmbeddings, listEmbeddings } from '@/data/embeddings'
import { setCurrentOwner } from '@/app/currentOwner'

function row(entryId: string, ownerId = 'local') {
  return { entryId, ownerId, vector: [1, 0], model: 'm', textHash: 'h', updatedAt: 't' }
}

beforeEach(async () => {
  setCurrentOwner('local')
  db.close()
  await Dexie.delete('aiji')
  await db.open()
})

describe('deleteStaleEmbeddings 惰性 GC', () => {
  it('种 3 行（2 个有效 id）→ 删 1 行返回 1，剩余 2 行', async () => {
    await db.embeddings.bulkPut([row('e1'), row('e2'), row('ghost')])
    const n = await deleteStaleEmbeddings(new Set(['e1', 'e2']))
    expect(n).toBe(1)
    const rest = (await db.embeddings.toArray()).map((r) => r.entryId).sort()
    expect(rest).toEqual(['e1', 'e2'])
  })

  it('无残留 → 返回 0 不动表', async () => {
    await db.embeddings.bulkPut([row('e1'), row('e2')])
    const n = await deleteStaleEmbeddings(new Set(['e1', 'e2']))
    expect(n).toBe(0)
    expect(await db.embeddings.count()).toBe(2)
  })

  it('分区安全：其他 owner 的残留行不受牵连（list 只扫当前 owner）', async () => {
    await db.embeddings.bulkPut([row('e1'), row('x9', 'u2')])
    // validIds 只含 e1——u2 的 x9 不在其中，但不属当前 owner 分区，不得删。
    const n = await deleteStaleEmbeddings(new Set(['e1']))
    expect(n).toBe(0)
    expect(await db.embeddings.count()).toBe(2)
    expect(await listEmbeddings('u2')).toHaveLength(1)
  })
})
