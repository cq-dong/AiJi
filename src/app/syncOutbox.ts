// 同步 outbox：本地改动即入队（按 ownerId+kind+id 去重），同步引擎 debounce 后批量 push。
// 通知用槽模式（同 accountSlots）：dexieStorage → 本模块 → 引擎注册回调，零反向 import 成环。
import { db } from '@/data/db'
import type { SyncKind } from '@/domain/sync'

let notifyFn: (() => void) | null = null

/** syncEngine start 时注册：有改动入队即触发（引擎内 debounce）。stop 时传原引用清不掉无所谓——引擎停了自己不跑。 */
export function onOutboxEnqueue(fn: (() => void) | null): void {
  notifyFn = fn
}

/** 入队（去重：同 ownerId+kind+id 只留最新行）。tombstone=true → push 时带 deletedAt。 */
export async function enqueue(
  ownerId: string,
  kind: SyncKind,
  id: string,
  opts: { tombstone?: boolean } = {},
): Promise<void> {
  const now = new Date().toISOString()
  const tombstone = opts.tombstone ?? false
  const n = await db.syncOutbox
    .where('[ownerId+kind+id]')
    .equals([ownerId, kind, id])
    .modify({ updatedAt: now, tombstone })
  if (n === 0) await db.syncOutbox.add({ ownerId, kind, id, updatedAt: now, tombstone })
  notifyFn?.()
}
