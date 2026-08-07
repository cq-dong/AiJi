// 云端同步（Phase 2）域类型——纯 TS 零 I/O。协议契约见
// docs/superpowers/plans/2026-08-08-cloud-sync-phase2.md 头部。
import type { Draft, Entry, EntryAi } from './types'

export type SyncKind = 'entry' | 'category' | 'tag' | 'reminder' | 'draft' | 'media'

export interface SyncChange {
  seq?: number // 仅 pull 响应带（服务端游标）
  kind: SyncKind
  id: string
  payload?: unknown
  updatedAt: string
  deletedAt?: string
}

// entry 行 payload：Entry 全量 + 当前 EntryAi（无则 null）。
export interface EntryPayload {
  entry: Entry
  ai: EntryAi | null
}

// media 行 payload。
export interface MediaPayload {
  ref: string
  mime: string
  size: number
}

// outbox 行：只记「谁变了」，payload 在 flush 时从活库现组（天然合并多次改写）。
// UNIQUE(ownerId,kind,id) 去重；tombstone=true 时 push 带 deletedAt。
export interface OutboxRow {
  seq?: number // Dexie 自增主键
  ownerId: string
  kind: SyncKind
  id: string
  updatedAt: string
  tombstone: boolean
}

// syncMedia：ref 已上传标记（存在即已传；media tombstone 推送成功后删行）。
export interface SyncMediaTrackRow {
  ref: string
  uploadedAt: string
}

// syncState：kv 元数据。key 例：'lastPullSeq:<accountId>'(number) / 'migrated:<accountId>'('1')。
export interface SyncStateRow {
  key: string
  value: unknown
}

// Draft payload 在 flush 时直接是 Draft 行本身（drafts 表不分区）。
export type DraftPayload = Draft
