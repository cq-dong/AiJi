// embedding 持久化 helpers（2026-10-03 P-B 语义召回）：db v10 embeddings 表读写 +
// 被嵌文本组装 + textHash 变更指纹。分区语义同其他分区表——list 按 ownerId 过滤、
// save 强制盖章 getCurrentOwner()（照抄 dexieStorage 的分区约定）。
import { db } from '@/data/db'
import { getCurrentOwner } from '@/app/currentOwner'
import type { Entry, EntryAi, EntryEmbedding } from '@/domain/types'

// 被嵌文本上限（spec §1）：title/summary/tags + 正文/转写，cap 800 字符。
export const EMBEDDING_TEXT_CAP = 800

// 被嵌文本组装：titleSuggestion + summary + tags(slug) + 正文/转写（text part 原文 /
// audio/video transcript），换行连接，cap 800。文本变了 → textHash 变 → 重嵌。
export function buildEmbeddingText(entry: Entry, ai: EntryAi | undefined): string {
  const raw = entry.parts
    .map((p) => (p.type === 'text' ? p.content : p.transcript ?? ''))
    .filter(Boolean)
    .join('\n')
  return [ai?.titleSuggestion ?? '', ai?.summary ?? '', (ai?.tags ?? []).join(' '), raw]
    .filter(Boolean)
    .join('\n')
    .slice(0, EMBEDDING_TEXT_CAP)
}

// textHash：djb2 hex。**非加密用途**——仅作「被嵌文本是否变了」的变更指纹（碰撞可接受，
// 最坏情况是极偶然的漏重嵌）。纯 TS 零依赖。
export function textHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

export function getEmbedding(entryId: string): Promise<EntryEmbedding | undefined> {
  return db.embeddings.get(entryId)
}

// save 强制盖章当前 owner（同 dexieStorage.saveEntry 的分区约定），防调用方漏传/传错。
export function saveEmbedding(row: EntryEmbedding): Promise<void> {
  return db.embeddings.put({ ...row, ownerId: getCurrentOwner() }).then(() => undefined)
}

// list 按 owner 过滤（默认当前 owner）。语义臂只召回当前账号的向量。
export function listEmbeddings(ownerId: string = getCurrentOwner()): Promise<EntryEmbedding[]> {
  return db.embeddings.where('ownerId').equals(ownerId).toArray()
}

// 惰性 GC（2026-10-04 W0）：本表无 delete 挂点——deleteEntry/trashEntry/hydrate purge 均不触
// embeddings，向量行（~6KB/行）永久残留。调用方传入当前有效 entryId 集，不在集内的行
// bulkDelete，返回删除数。只扫当前 owner 分区（listEmbeddings 语义），其他 owner 的行不受牵连。
// 挂点：store.withSemanticArm 召回时顺带触发（fire-and-forget，不阻塞召回主路径）。
export async function deleteStaleEmbeddings(validIds: Set<string>): Promise<number> {
  const rows = await listEmbeddings()
  const staleIds = rows.filter((r) => !validIds.has(r.entryId)).map((r) => r.entryId)
  if (staleIds.length === 0) return 0
  await db.embeddings.bulkDelete(staleIds)
  return staleIds.length
}
