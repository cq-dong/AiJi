import type { StoragePort } from '@/ports'
import {
  seedAggregates,
  seedCategories,
  seedEntries,
  seedEntryAi,
  seedSettings,
  seedTags,
} from '@/data/seed'

// Mock adapter — returns prototype sample data synchronously (as resolved promises).
export const mockStorage: StoragePort = {
  async listEntries() {
    return seedEntries
  },
  async getEntry(id) {
    return seedEntries.find((e) => e.id === id)
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
