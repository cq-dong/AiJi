import Dexie, { type Table } from 'dexie'
import type { Aggregate, Category, Draft, Entry, EntryAi, Reminder, Settings, Tag } from '@/domain/types'

// IndexedDB schema (PRD §7.3). UI 层先用 mock 适配器，schema 已就位待接入。
export class AiJiDB extends Dexie {
  entries!: Table<Entry, string>
  entryAi!: Table<EntryAi, string>
  categories!: Table<Category, string>
  tags!: Table<Tag, string>
  aggregates!: Table<Aggregate, string>
  // Single-row settings: stored at fixed key 1 (put(obj, 1) upserts). ++id schema,
  // but we always pass the explicit key — auto-increment never fires.
  settings!: Table<Settings, number>
  // AI 提醒（Phase 9 Batch 2b）：foreground-only notifications (Q1), dueAt is absolute ISO (Q2).
  reminders!: Table<Reminder, string>
  // Wave 4: multi-row capture drafts (keyPath id, string). Lets users pause multiple
  // in-progress entries + resume any. Wave 3 was single-row key=1.
  drafts!: Table<Draft, string>

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
    // v2: add scope.range index for getAggregate(scope, range) lookups.
    this.version(2).stores({
      entries: 'id, createdAt, updatedAt, status',
      entryAi: 'id, entryId, version',
      categories: 'slug, usageCount',
      tags: 'slug, usageCount',
      aggregates: 'id, scope.type, scope.range, stale',
      settings: '++id',
    })
    // v3: add reminders table (keyPath id, indices on dueAt/status/entryId).
    // Safe migration — only adds a new table, no existing keyPath changes.
    // .stores() is NOT incremental: every store must be redeclared verbatim.
    this.version(3).stores({
      entries: 'id, createdAt, updatedAt, status',
      entryAi: 'id, entryId, version',
      categories: 'slug, usageCount',
      tags: 'slug, usageCount',
      aggregates: 'id, scope.type, scope.range, stale',
      settings: '++id',
      reminders: 'id, dueAt, status, entryId',
    })
    // v4: add drafts table (single-row, keyPath id). Wave 3 capture draft.
    // .stores() is NOT incremental — every store redeclared verbatim.
    this.version(4).stores({
      entries: 'id, createdAt, updatedAt, status',
      entryAi: 'id, entryId, version',
      categories: 'slug, usageCount',
      tags: 'slug, usageCount',
      aggregates: 'id, scope.type, scope.range, stale',
      settings: '++id',
      reminders: 'id, dueAt, status, entryId',
      drafts: 'id',
    })
    // v5: Wave 4 — 30-day trash (entries.deletedAt index) + multi-row drafts.
    // Draft id changed from literal 1 (number) to string; old single-row draft (key=1)
    // would violate the new type, so the upgrade clears stale drafts (dev data, fine).
    this.version(5).stores({
      entries: 'id, createdAt, updatedAt, status, deletedAt',
      entryAi: 'id, entryId, version',
      categories: 'slug, usageCount',
      tags: 'slug, usageCount',
      aggregates: 'id, scope.type, scope.range, stale',
      settings: '++id',
      reminders: 'id, dueAt, status, entryId',
      drafts: 'id, updatedAt',
    }).upgrade(async (tx) => {
      await tx.table('drafts').clear()
    })
  }
}

export const db = new AiJiDB()
