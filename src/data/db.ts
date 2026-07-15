import Dexie, { type Table } from 'dexie'
import type { Aggregate, Category, Entry, EntryAi, Settings, Tag } from '@/domain/types'

// IndexedDB schema (PRD §7.3). UI 层先用 mock 适配器，schema 已就位待接入。
export class AiJiDB extends Dexie {
  entries!: Table<Entry, string>
  entryAi!: Table<EntryAi, string>
  categories!: Table<Category, string>
  tags!: Table<Tag, string>
  aggregates!: Table<Aggregate, string>
  settings!: Table<Settings, string>

  constructor() {
    super('aiji')
    this.version(1).stores({
      entries: 'id, createdAt, updatedAt, status',
      entryAi: 'id, entryId, version',
      categories: 'slug, usageCount',
      tags: 'slug, usageCount',
      aggregates: 'id, scope.type, stale',
      settings: '++id',
    })
  }
}

export const db = new AiJiDB()
