import { db } from '@/data/db'
import type { StoragePort } from '@/ports'
import type { Aggregate, AggregateScopeType, Conversation, Draft, Entry, Reminder } from '@/domain/types'
import {
  seedAggregates,
  seedCategories,
  seedEntries,
  seedEntryAi,
  seedReminders,
  seedSettings,
  seedTags,
} from '@/data/seed'

// D9: 生产环境不再自动灌 seed 数据——首装看到 12 条测试记录像数据泄露。
// DEV 环境保留自动 seed 方便开发（import.meta.env.DEV 在 prod build 为 false，整块被
// tree-shake）；生产环境空库，用户可在 onboarding/settings 主动调 importSampleData() 导入。
// seedSettings 仍作 getSettings 默认形状兜底（默认配置，非样例数据）。
let seeded = false
async function ensureSeeded(): Promise<void> {
  if (seeded) return
  if (import.meta.env.DEV) {
    // DEV only：空库时灌完整原型数据集，方便开发调试（生产 build 此块被 tree-shake 掉）。
    const entriesEmpty = (await db.entries.count()) === 0
    if (entriesEmpty) {
      await db.entries.bulkPut(seedEntries)
      await db.categories.bulkPut(seedCategories)
      await db.tags.bulkPut(seedTags)
      await db.entryAi.bulkPut(seedEntryAi)
    } else {
      // 存量库（用户在过往阶段存过真实条目）：补灌 categories/tags/entryAi（若缺）。
      if ((await db.categories.count()) === 0) await db.categories.bulkPut(seedCategories)
      if ((await db.tags.count()) === 0) await db.tags.bulkPut(seedTags)
      if ((await db.entryAi.count()) === 0) await db.entryAi.bulkPut(seedEntryAi)
    }
    if ((await db.aggregates.count()) === 0) await db.aggregates.bulkPut(seedAggregates)
    if ((await db.reminders.count()) === 0) await db.reminders.bulkPut(seedReminders)
  }
  seeded = true
}

// D9: 主动导入示例数据（onboarding 首启引导 / settings 数据管理按钮调用）。
// 写入完整原型集（条目 + AI + 类别/标签/聚合/提醒）。幂等：已存在的行被覆盖（同主键 put）。
// 调用后需 rehydrate store 才能刷新 UI（store.rehydrate 重读 Dexie）。
export async function importSampleData(): Promise<void> {
  await db.entries.bulkPut(seedEntries)
  await db.categories.bulkPut(seedCategories)
  await db.tags.bulkPut(seedTags)
  await db.entryAi.bulkPut(seedEntryAi)
  await db.aggregates.bulkPut(seedAggregates)
  await db.reminders.bulkPut(seedReminders)
  seeded = true
}

// D5: 硬删路径（trash 永久删除 + 30 天 purge）清 OPFS 媒体 blob，免配额累积（iOS 尤甚）。
// 软删（trashEntry）不调——恢复需要媒体。best-effort：OPFS 不支持/ref 不存在 → 静默。
async function removeMediaForEntry(e: Entry): Promise<void> {
  for (const p of e.parts) {
    if (p.type !== 'audio' && p.type !== 'video') continue
    try {
      const root = await navigator.storage?.getDirectory?.()
      if (root) await root.removeEntry(p.ref).catch(() => {})
    } catch {
      // OPFS unsupported — best-effort
    }
  }
}

export const dexieStorage: StoragePort = {
  async listEntries() {
    await ensureSeeded()
    const all = await db.entries.toArray()
    // Wave 4: trashed entries (deletedAt set) live in the trash view, not the main list.
    const active = all.filter((e) => !e.deletedAt)
    // 跨 +08:00 / Z ISO 必须用时序比较，字符串序非时序（见 D4）。
    return active.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
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
    // D1: 严格 > 在等版本上随机取（Dexie toArray 主键序）。改 >= + createdAt tie-break，
    // 始终返回最高版本 + 最新创建的 EntryAi。配合 openAiCompatLlm.classify 版本递增，重处理不再返过期 AI。
    return rows.reduce((a, b) => {
      if (b.version !== a.version) return b.version > a.version ? b : a
      return new Date(b.createdAt).getTime() > new Date(a.createdAt).getTime() ? b : a
    })
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
    // D2: 合并 seedSettings defaults——旧用户行缺 Wave 3 加的 aggregateDetailLevel 等字段时，
    // seed 兜底（不返 undefined 谎称类型）。row 不存在时 {...seed, ...{}} = seed。
    const row = await db.settings.get(1)
    return { ...seedSettings, ...row }
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
  async deleteMedia(ref: string): Promise<void> {
    try {
      const root = await navigator.storage?.getDirectory?.()
      if (!root) return
      await root.removeEntry(ref)
    } catch {
      // OPFS unsupported / ref absent — best-effort
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
    // D5: 先取 entry 清 OPFS 媒体，再删 Dexie 行 + 级联 AI/reminders。
    const e = await db.entries.get(id)
    if (e) await removeMediaForEntry(e)
    await db.entries.delete(id)
    await db.entryAi.where('entryId').equals(id).delete()
    await db.reminders.where('entryId').equals(id).delete()
  },
  async saveDraft(d: Draft): Promise<void> {
    // Wave 4: multi-row. d.id is string; put by keyPath (no explicit key).
    await db.drafts.put(d)
  },
  async listDrafts(): Promise<Draft[]> {
    await ensureSeeded()
    const all = await db.drafts.toArray()
    // 最近更新在上 — 草稿视图倒序。
    return all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  },
  async getDraft(id: string): Promise<Draft | undefined> {
    await ensureSeeded()
    return db.drafts.get(id)
  },
  async deleteDraft(id: string): Promise<void> {
    await db.drafts.delete(id)
  },
  async listTrashed(): Promise<Entry[]> {
    await ensureSeeded()
    const all = await db.entries.toArray()
    // Trashed = deletedAt set. 最近删除在上（30 天倒计时从 deletedAt 起算）。
    const trashed = all.filter((e) => e.deletedAt)
    return trashed.sort((a, b) => new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime())
  },
  async trashEntry(id: string): Promise<void> {
    const e = await db.entries.get(id)
    if (!e) return
    await db.entries.put({ ...e, deletedAt: new Date().toISOString() })
  },
  async recoverEntry(id: string): Promise<void> {
    const e = await db.entries.get(id)
    if (!e || !e.deletedAt) return
    // undefined props are dropped by structured clone → deletedAt absent on next read.
    await db.entries.put({ ...e, deletedAt: undefined })
  },
  async purgeExpired(): Promise<number> {
    // 30-day window: entries trashed before cutoff are hard-deleted (+ cascade AI + reminders).
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const all = await db.entries.toArray()
    const expired = all.filter((e) => e.deletedAt && new Date(e.deletedAt).getTime() < cutoff)
    for (const e of expired) {
      await removeMediaForEntry(e)
      await db.entries.delete(e.id)
      await db.entryAi.where('entryId').equals(e.id).delete()
      await db.reminders.where('entryId').equals(e.id).delete()
    }
    return expired.length
  },
  // AI Chat · conversations (docs/design/ai-chat-impl-plan.md §3)。MVP 单会话 id=1，
  // messages 内嵌数组——saveConversation 整体覆写（无 message 级 diff，简单优先）。
  async listConversations(): Promise<Conversation[]> {
    const all = await db.conversations.toArray()
    // 最近更新在上——单会话时仅 1 行，多会话时倒序。
    return all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  },
  async getConversation(id: string): Promise<Conversation | undefined> {
    return db.conversations.get(id)
  },
  async saveConversation(c: Conversation): Promise<void> {
    await db.conversations.put(c)
  },
  async deleteConversation(id: string): Promise<void> {
    await db.conversations.delete(id)
  },
}
