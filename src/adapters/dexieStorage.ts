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

// PWA StoragePort 适配：entries + settings 走 Dexie（首屏空库时 entries 从 seed 灌入；
// settings 落库到单行 key=1，seed 兜底首启）。entryAi/categories/aggregates/tags 仍取 seed——
// 其写入路径（LLM）未落地，待 LlmPort 接入时再路由到 Dexie。
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
}
