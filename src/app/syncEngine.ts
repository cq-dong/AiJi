// 云端同步引擎：outbox flush（debounce）+ 游标 pull + 首启迁移 + 5min 兜底 + online 补传。
// 应用远端变更直接写 db.*（绕过 dexieStorage 挂钩）→ 零回声。
//
// 防环：本模块不 import accountStore（否则 accountStore→syncEngine→accountStore 成环）。
// 当前 owner 走 getCurrentOwner()；settings.syncEnabled 走 di.storage.getSettings()（di
// 不 import 本模块，无环）；账号变化通知走 accountSlots.storeRehydrate 槽（已注册）。
import { db } from '@/data/db'
import { dexieStorage } from '@/adapters/dexieStorage'
import { getCurrentOwner } from '@/app/currentOwner'
import { accountSlots } from '@/app/accountSlots'
import { onOutboxEnqueue } from '@/app/syncOutbox'
import { useSyncStore } from '@/app/syncStore'
import { di } from '@/app/di'
import {
  downloadMedia, getSyncStatus, pullChanges, pushChanges, uploadMedia,
} from '@/adapters/syncHttp'
import { SessionExpiredError, StorageFullError } from '@/ports'
import type { EntryPayload, OutboxRow, SyncChange } from '@/domain/sync'
import type { Category, Draft, Reminder, Tag } from '@/domain/types'

const FLUSH_BATCH = 200
const DEBOUNCE_MS = 2000
const INTERVAL_MS = 5 * 60 * 1000

let started = false
let intervalId: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let onlineHandler: (() => void) | null = null
let running = false // tick 单飞
let dirty = false // 跑中又有新触发 → 跑完补一轮

// ── syncStore 便捷写 ──────────────────────────────────────
function patch(p: Partial<ReturnType<typeof useSyncStore.getState>>): void {
  useSyncStore.setState(p)
}

async function refreshPendingCount(): Promise<void> {
  const owner = getCurrentOwner()
  const n = await db.syncOutbox.where('ownerId').equals(owner).count()
  const st = useSyncStore.getState()
  if (st.migrating) {
    patch({ pendingCount: n, migrationRemaining: n })
  } else {
    patch({ pendingCount: n })
  }
}

// ── assemblePayload：从活库现组 SyncChange（多次改写天然合并为最新态）──
async function assemblePayload(row: OutboxRow): Promise<SyncChange | null> {
  if (row.tombstone) {
    return { kind: row.kind, id: row.id, updatedAt: row.updatedAt, deletedAt: row.updatedAt }
  }
  if (row.kind === 'entry') {
    const entry = await db.entries.get(row.id)
    if (!entry) return null // 行已不在（硬删但 outbox 只剩非 tombstone 行的极端序）
    // 附加最新 EntryAi：version 最大、平手 createdAt 最新——与 dexieStorage.getEntryAi 同则。
    const ais = await db.entryAi.where('entryId').equals(row.id).toArray()
    let ai: EntryPayload['ai'] = null
    if (ais.length > 0) {
      ai = ais.reduce((a, b) => {
        if (b.version !== a.version) return b.version > a.version ? b : a
        return new Date(b.createdAt).getTime() > new Date(a.createdAt).getTime() ? b : a
      })
    }
    const payload: EntryPayload = { entry, ai }
    return { kind: 'entry', id: row.id, updatedAt: row.updatedAt, payload }
  }
  if (row.kind === 'category') {
    const c = await db.categories.get(row.id)
    if (!c) return null
    return { kind: 'category', id: row.id, updatedAt: row.updatedAt, payload: { ...c, ownerId: row.ownerId } as Category }
  }
  if (row.kind === 'tag') {
    const t = await db.tags.get(row.id)
    if (!t) return null
    return { kind: 'tag', id: row.id, updatedAt: row.updatedAt, payload: { ...t, ownerId: row.ownerId } as Tag }
  }
  if (row.kind === 'reminder') {
    const r = await db.reminders.get(row.id)
    if (!r) return null
    return { kind: 'reminder', id: row.id, updatedAt: row.updatedAt, payload: { ...r, ownerId: row.ownerId } as Reminder }
  }
  if (row.kind === 'draft') {
    const d = await db.drafts.get(row.id)
    if (!d) return null
    return { kind: 'draft', id: row.id, updatedAt: row.updatedAt, payload: d as Draft }
  }
  // media：outbox 行由 deleteEntry 级联出 media tombstone（tombstone=true 上面已返）；
  // media 非 tombstone 行不会进 outbox（媒体走 PUT /media/:ref 上传后由 syncMedia track 标记，
  // 不作为独立 SyncChange push）。此处不应到达。
  return null
}

// ── uploadPendingMedia：entry flush 前先传未上传的媒体 ──
async function uploadPendingMedia(payload: EntryPayload): Promise<void> {
  for (const p of payload.entry.parts) {
    if (p.type === 'text') continue
    const ref = p.ref
    const tracked = await db.syncMedia.get(ref)
    if (tracked) continue // 已传
    const blob = await dexieStorage.getMedia(ref)
    if (!blob) {
      // 媒体本地已丢（OPFS 清/换设备）——不阻塞文本同步，track 未记所以下轮还会试。
      console.warn('[syncEngine] media blob missing, skip upload:', ref)
      continue
    }
    try {
      await uploadMedia(ref, blob)
      await db.syncMedia.put({ ref, uploadedAt: new Date().toISOString() })
    } catch (e) {
      if (e instanceof StorageFullError) {
        // 置 storageFull，UI 提示升级；entry 仍推（文本先行）；track 未记，下轮重试。
        patch({ storageFull: true })
        continue
      }
      throw e // 网络等错误上抛 → flush 整批保留 outbox 下轮重试
    }
  }
}

// ── flush：读 outbox → 组装 → 传媒体 → push → 清已推行 ──
export async function flush(): Promise<void> {
  const owner = getCurrentOwner()
  while (true) {
    const rows = await db.syncOutbox
      .where('ownerId')
      .equals(owner)
      .limit(FLUSH_BATCH)
      .toArray()
    if (rows.length === 0) break
    // seq 升序（toArray 已按主键序，但显式排序保险）。
    rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

    const changes: SyncChange[] = []
    const seqsToDelete: number[] = []
    const mediaTombstoneRefs: string[] = []
    const skipSeqs: number[] = []
    for (const row of rows) {
      const ch = await assemblePayload(row)
      if (ch === null) {
        // 行已不存在 → 跳过并删该 outbox 行（避免幽灵行滞留）。
        skipSeqs.push(row.seq!)
        continue
      }
      // entry 非 tombstone：先传未上传的媒体（文本先行，媒体失败不阻塞）。
      if (row.kind === 'entry' && !row.tombstone) {
        const ep = ch.payload as EntryPayload
        try {
          await uploadPendingMedia(ep)
        } catch (e) {
          // 媒体上传网络/5xx 失败 → 整批保留 outbox 下轮重试（文本也等，保证顺序一致）。
          // 但不置 lastError（仅媒体层，文本尚未失败）。
          console.warn('[syncEngine] uploadPendingMedia failed, will retry:', e)
          return
        }
      }
      // media tombstone 推送成功后删 track 行（见 pushChanges 成功后）。
      if (row.kind === 'media' && row.tombstone) {
        mediaTombstoneRefs.push(row.id)
      }
      changes.push(ch)
      seqsToDelete.push(row.seq!)
    }
    // 跳过的幽灵行直接删。
    if (skipSeqs.length > 0) await db.syncOutbox.bulkDelete(skipSeqs)

    if (changes.length === 0) continue

    let result
    try {
      result = await pushChanges(changes)
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e
      // 网络/5xx：保留 outbox 下轮重试，不置 lastError（常规重试）。
      console.warn('[syncEngine] pushChanges failed, will retry:', e)
      return
    }
    // 推送成功 → 删已推 outbox 行。
    await db.syncOutbox.bulkDelete(seqsToDelete)
    // media tombstone 行推送成功后清 track 行（让该 ref 可重新上传，若他端又创同 ref）。
    for (const ref of mediaTombstoneRefs) {
      await db.syncMedia.delete(ref).catch(() => {})
    }
    // rejected 仅 info——下轮 pull 拿胜方，无需重推（重推也输）。
    if (result.rejected.length > 0) {
      console.info('[syncEngine] push rejected (server has newer/tombstone):', result.rejected)
    }
  }
}

// ── apply：把远端变更直接写 db.*（零回声，绕过 dexieStorage 挂钩）──
async function applyChange(ch: SyncChange): Promise<void> {
  const owner = getCurrentOwner()
  const id = ch.id
  if (ch.kind === 'entry') {
    if (ch.deletedAt) {
      // entry tombstone → 读 entry 取媒体 refs → 删 entry/AI/媒体。不动 reminders。
      const e = await db.entries.get(id)
      if (e) {
        const refs = e.parts.filter((p) => p.type !== 'text').map((p) => p.ref)
        for (const ref of refs) {
          await dexieStorage.deleteMedia(ref).catch(() => {})
          await db.syncMedia.delete(ref).catch(() => {})
        }
      }
      await db.entries.delete(id)
      await db.entryAi.where('entryId').equals(id).delete()
      return
    }
    const p = ch.payload as EntryPayload
    // 直写 db.entries（盖 ownerId 为当前 owner——拉到的行归属当前账号分区）。
    await db.entries.put({ ...p.entry, ownerId: owner })
    if (p.ai) await db.entryAi.put(p.ai)
    // 媒体下行：本地无 blob 才下载。
    for (const part of p.entry.parts) {
      if (part.type === 'text') continue
      const ref = part.ref
      const existing = await dexieStorage.getMedia(ref)
      if (existing) continue
      try {
        const blob = await downloadMedia(ref)
        await dexieStorage.saveMedia(ref, blob)
        await db.syncMedia.put({ ref, uploadedAt: new Date().toISOString() })
      } catch (e) {
        console.warn('[syncEngine] downloadMedia failed for', ref, e)
        // 不阻塞——entry 已落，媒体下次 pull 不会再下（local 有则跳过逻辑会兜底若已存在）
      }
    }
    return
  }
  if (ch.kind === 'category') {
    if (ch.deletedAt) {
      await db.categories.delete(id)
      return
    }
    const row = ch.payload as Category
    await db.categories.put({ ...row, ownerId: owner })
    return
  }
  if (ch.kind === 'tag') {
    if (ch.deletedAt) {
      await db.tags.delete(id)
      return
    }
    const row = ch.payload as Tag
    await db.tags.put({ ...row, ownerId: owner })
    return
  }
  if (ch.kind === 'reminder') {
    if (ch.deletedAt) {
      await db.reminders.delete(id)
      return
    }
    const row = ch.payload as Reminder
    await db.reminders.put({ ...row, ownerId: owner })
    return
  }
  if (ch.kind === 'draft') {
    if (ch.deletedAt) {
      await db.drafts.delete(id)
      return
    }
    const row = ch.payload as Draft
    await db.drafts.put(row) // 草稿不分区
    return
  }
  if (ch.kind === 'media') {
    if (ch.deletedAt) {
      await dexieStorage.deleteMedia(id).catch(() => {})
      await db.syncMedia.delete(id).catch(() => {})
      return
    }
    const existing = await dexieStorage.getMedia(id)
    if (existing) return
    try {
      const blob = await downloadMedia(id)
      await dexieStorage.saveMedia(id, blob)
      await db.syncMedia.put({ ref: id, uploadedAt: new Date().toISOString() })
    } catch (e) {
      console.warn('[syncEngine] downloadMedia(media) failed for', id, e)
    }
    return
  }
}

// ── pull：游标循环 → apply → 更新 lastPullSeq ──
export async function pull(): Promise<void> {
  const owner = getCurrentOwner()
  const stateKey = `lastPullSeq:${owner}`
  const stateRow = await db.syncState.get(stateKey)
  let cursor = (stateRow?.value as number) ?? 0
  let hadChanges = false
  while (true) {
    const { changes, cursor: newCursor, hasMore } = await pullChanges(cursor)
    for (const ch of changes) {
      try {
        await applyChange(ch)
      } catch (e) {
        // 单条 apply 失败不阻塞整轮 pull（媒体下载失败等已 inner-catch，
        // 这里兜底其他意外）。记录但不抛。
        console.warn('[syncEngine] applyChange failed for', ch.kind, ch.id, e)
      }
      hadChanges = true
    }
    cursor = newCursor
    await db.syncState.put({ key: stateKey, value: cursor })
    if (!hasMore) break
  }
  if (hadChanges) {
    accountSlots.storeRehydrate?.()
  }
}

// ── migrate：首启全量入队（entries 含 trashed + categories/tags/reminders/drafts）──
async function migrate(): Promise<void> {
  const owner = getCurrentOwner()
  const migratedKey = `migrated:${owner}`
  const existing = await db.syncState.get(migratedKey)
  if (existing) return // 已迁移
  patch({ migrating: true })
  const [ents, cats, tgs, rems, drafts] = await Promise.all([
    db.entries.where('ownerId').equals(owner).toArray(),
    db.categories.where('ownerId').equals(owner).toArray(),
    db.tags.where('ownerId').equals(owner).toArray(),
    db.reminders.where('ownerId').equals(owner).toArray(),
    db.drafts.toArray(),
  ])
  // 全量入队（幂等——flush 现组 payload，LWW 服务端去重）。
  // trashed 条目入队非 tombstone——payload 带 deletedAt 字段即可（软删可恢复）。
  for (const e of ents) await enqueue(owner, 'entry', e.id)
  for (const c of cats) await enqueue(owner, 'category', c.slug)
  for (const t of tgs) await enqueue(owner, 'tag', t.slug)
  for (const r of rems) await enqueue(owner, 'reminder', r.id)
  for (const d of drafts) await enqueue(owner, 'draft', d.id)
  const total = ents.length + cats.length + tgs.length + rems.length + drafts.length
  patch({ migrationTotal: total, migrationRemaining: total })
  await db.syncState.put({ key: migratedKey, value: '1' })
  patch({ migrating: false })
}

// 本地 enqueue 引用（避免从 syncOutbox 模块 import 触发 notifyFn 重复——直接用 db 写更简单，
// 但复用 enqueue 的去重逻辑更稳）。
async function enqueue(ownerId: string, kind: OutboxRow['kind'], id: string): Promise<void> {
  // 直接走 db.syncOutbox upsert（去重逻辑同 syncOutbox.enqueue，但不触发 notifyFn——
  // migrate 时引擎自己控制节奏，不需要 debounce 触发）。
  const now = new Date().toISOString()
  const n = await db.syncOutbox
    .where('[ownerId+kind+id]')
    .equals([ownerId, kind, id])
    .modify({ updatedAt: now, tombstone: false })
  if (n === 0) await db.syncOutbox.add({ ownerId, kind, id, updatedAt: now, tombstone: false })
}

// ── tick：单飞 flush→pull，跑中置 dirty 补一轮 ──
async function tick(): Promise<void> {
  if (running) {
    dirty = true
    return
  }
  running = true
  patch({ syncing: true })
  try {
    do {
      dirty = false
      try {
        await flush()
        await pull()
        // 刷新状态
        await refreshPendingCount()
        try {
          const st = await getSyncStatus()
          patch({ usedBytes: st.usedBytes, limitBytes: st.limitBytes, lastSyncAt: new Date().toISOString(), lastError: null })
        } catch {
          // getSyncStatus 失败不致命——lastSyncAt 仍更新。
          patch({ lastSyncAt: new Date().toISOString(), lastError: null })
        }
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          // sessionExpired UX 由 accountStore 负责，引擎只静默停。
          patch({ lastError: '登录已过期，请重新登录' })
          stopSync()
          return
        }
        // 其他异常不外抛（引擎永不让同步失败炸 UI）。
        patch({ lastError: e instanceof Error ? e.message : String(e) })
        break
      }
    } while (dirty)
  } finally {
    running = false
    patch({ syncing: false })
  }
}

function scheduleTick(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void tick()
  }, DEBOUNCE_MS)
}

// ── 启停 ──────────────────────────────────────────────────

/** 启动同步引擎：network 账号 + settings.syncEnabled && 未 start → 注册回调/interval/online + migrate + tick。
 *  防环：读 settings 走 di.storage.getSettings()（di 不 import 本模块）；判 network 走 getCurrentOwner()。 */
export async function maybeStartSync(): Promise<void> {
  if (started) return
  const owner = getCurrentOwner()
  if (owner === 'local') return // guest/未登录恒 'local'，不开同步
  let syncEnabled: boolean
  try {
    const s = await di.storage.getSettings()
    syncEnabled = !!s.syncEnabled
  } catch {
    return // settings 读不到 → 不启（boot 时序未到）
  }
  if (!syncEnabled) return
  started = true
  patch({ running: true, lastError: null })
  // outbox 入队回调 → debounce 2s → tick
  onOutboxEnqueue(() => scheduleTick())
  // 5min 兜底 interval
  intervalId = setInterval(() => void tick(), INTERVAL_MS)
  // online 事件补传
  onlineHandler = () => void tick()
  window.addEventListener('online', onlineHandler)
  // 首启迁移 + 首轮 tick
  try {
    await migrate()
  } catch (e) {
    console.warn('[syncEngine] migrate failed:', e)
  }
  await refreshPendingCount()
  void tick()
}

/** 停止同步引擎：清 interval/listener/onOutboxEnqueue(null)。sessionExpired 时引擎自调。 */
export function stopSync(): void {
  if (!started) return
  started = false
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler)
    onlineHandler = null
  }
  onOutboxEnqueue(null)
  patch({ running: false, syncing: false, migrating: false })
}
