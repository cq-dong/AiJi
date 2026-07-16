import { db } from '@/data/db'
import type { StoragePort } from '@/ports'
import type { Aggregate, AggregateScopeType, Reminder } from '@/domain/types'
import {
  seedAggregates,
  seedCategories,
  seedEntries,
  seedEntryAi,
  seedReminders,
  seedSettings,
  seedTags,
} from '@/data/seed'

// PWA StoragePort 适配：entries/settings/entryAi/categories/tags/aggregates 走 Dexie（首屏空库时从
// seed 灌入；settings 落库到单行 key=1，seed 兜底首启）。aggregates 真读 Dexie，空库时 seed 兜底。
// entries 落库由 store.finishSave；entryAi/categories/tags 落库由处理管线（LlmPort 分类 + 涌现）；
// aggregates 落库由 store.recomputeAggregate（LlmPort 聚合 → saveAggregate）。
let seeded = false
async function ensureSeeded(): Promise<void> {
  if (seeded) return
  const entriesEmpty = (await db.entries.count()) === 0
  if (entriesEmpty) {
    // 首启：灌完整原型数据集（条目 + 其 AI + 类别/标签库）。
    await db.entries.bulkPut(seedEntries)
    await db.categories.bulkPut(seedCategories)
    await db.tags.bulkPut(seedTags)
    await db.entryAi.bulkPut(seedEntryAi)
  } else {
    // 存量库（用户在过往阶段存过真实条目）：e1-e12 在 Phase 2 首启已灌入 Dexie，
    // 故 seedEntryAi(ai1-ai12, entryId=e1-e12) 与之匹配不孤儿——补灌 categories/tags/entryAi。
    if ((await db.categories.count()) === 0) await db.categories.bulkPut(seedCategories)
    if ((await db.tags.count()) === 0) await db.tags.bulkPut(seedTags)
    if ((await db.entryAi.count()) === 0) await db.entryAi.bulkPut(seedEntryAi)
  }
  // aggregates 空库时灌 seed 兜底（真重算后会覆盖）。
  if ((await db.aggregates.count()) === 0) await db.aggregates.bulkPut(seedAggregates)
  // reminders 空库时灌 seed 样例（Phase 9 Batch 2b）。
  if ((await db.reminders.count()) === 0) await db.reminders.bulkPut(seedReminders)
  seeded = true
}

export const dexieStorage: StoragePort = {
  async listEntries() {
    await ensureSeeded()
    const all = await db.entries.toArray()
    // 跨 +08:00 / Z ISO 必须用时序比较，字符串序非时序（见 D4）。
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  },
  async getEntry(id) {
    await ensureSeeded()
    return db.entries.get(id)
  },
  async saveEntry(entry) {
    await db.entries.put(entry)
  },
  async getEntryAi(entryId) {
    await ensureSeeded()
    const rows = await db.entryAi.where('entryId').equals(entryId).toArray()
    if (rows.length === 0) return undefined
    return rows.reduce((a, b) => (a.version > b.version ? a : b))
  },
  async saveEntryAi(ai) {
    await db.entryAi.put(ai)
  },
  async listCategories() {
    await ensureSeeded()
    return db.categories.toArray()
  },
  async saveCategory(cat) {
    await db.categories.put(cat)
  },
  async listTags() {
    await ensureSeeded()
    return db.tags.toArray()
  },
  async saveTag(tag) {
    await db.tags.put(tag)
  },
  async listAggregates() {
    await ensureSeeded()
    const all = await db.aggregates.toArray()
    // Newest first — matches seed ordering and store expectations.
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  },
  async getAggregate(scope: AggregateScopeType, range: string): Promise<Aggregate | undefined> {
    await ensureSeeded()
    // scope.range is a compound index — filter by type then range for an exact match.
    const rows = await db.aggregates
      .where('scope.type')
      .equals(scope)
      .toArray()
    return rows.find((r) => r.scope.range === range)
  },
  async saveAggregate(ag: Aggregate): Promise<void> {
    await db.aggregates.put(ag)
  },
  async getSettings() {
    // Single-row settings at key 1. Fall back to seed on first run / empty DB.
    const row = await db.settings.get(1)
    return row ?? seedSettings
  },
  async saveSettings(s) {
    // Upsert the single settings row at fixed key 1 (++id never fires — explicit key).
    await db.settings.put(s, 1)
  },
  async saveMedia(ref, blob) {
    // OPFS (PRD §7.2). A2 de-risk: does the browser persist media locally (iOS 尤甚)?
    // Graceful degradation: OPFS unsupported → no-op (transcript still shows; replay lost).
    try {
      const root = await navigator.storage?.getDirectory?.()
      if (!root) return
      const handle = await root.getFileHandle(ref, { create: true })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    } catch (e) {
      console.error('[dexieStorage] saveMedia failed', e)
    }
  },
  async getMedia(ref) {
    try {
      const root = await navigator.storage?.getDirectory?.()
      if (!root) return undefined
      const handle = await root.getFileHandle(ref)
      const file = await handle.getFile()
      return file
    } catch {
      return undefined // not found (seed parts) or OPFS unsupported
    }
  },
  async listReminders(): Promise<Reminder[]> {
    await ensureSeeded()
    const all = await db.reminders.toArray()
    // Earliest due first — pending reminders surface to top; missed naturally fall below.
    return all.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  },
  async getReminder(id: string): Promise<Reminder | undefined> {
    await ensureSeeded()
    return db.reminders.get(id)
  },
  async saveReminder(r: Reminder): Promise<void> {
    await db.reminders.put(r)
  },
  async deleteReminder(id: string): Promise<void> {
    await db.reminders.delete(id)
  },
  async deleteCategory(slug: string): Promise<void> {
    await db.categories.delete(slug)
  },
  async deleteEntry(id: string): Promise<void> {
    await db.entries.delete(id)
    // 删该条目的所有 AI 版本（entryAi byEntry index）。
    await db.entryAi.where('entryId').equals(id).delete()
  },
}
