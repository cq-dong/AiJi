import { db } from '@/data/db'
import type { StoragePort } from '@/ports'
import {
  seedAggregates,
  seedCategories,
  seedEntries,
  seedEntryAi,
  seedSettings,
  seedTags,
} from '@/data/seed'

// PWA StoragePort 适配：entries 走 Dexie（首屏空库时从 seed 灌入，保存即落库、重载留存）。
// entryAi/categories/aggregates/tags/settings 仍取 seed——其写入路径（LLM/设置 UI）未落地，
// 待对应端口接入时再路由到 Dexie。
let seeded = false
async function ensureSeeded(): Promise<void> {
  if (seeded) return
  if ((await db.entries.count()) > 0) { seeded = true; return }
  await db.entries.bulkPut(seedEntries)
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
    return seedEntryAi.find((a) => a.entryId === entryId)
  },
  async listCategories() {
    return seedCategories
  },
  async listTags() {
    return seedTags
  },
  async listAggregates() {
    return seedAggregates
  },
  async getSettings() {
    return seedSettings
  },
}
