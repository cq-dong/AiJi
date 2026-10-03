// P-C 记忆生命周期（2026-10-03，spec docs/superpowers/specs/2026-10-03-memory-lifecycle.md）：
// 纯函数层——向量初筛阈值/top-K、90 天过期判定、裁决四动作执行语义。零 I/O，
// store.saveMemory / archiveStaleMemories 编排调用，适配器只产出 MemoryVerdict。
import { cosine } from '@/app/semanticRecall'
import type { Memory, MemoryVerdict } from '@/domain/types'

// 相似阈值（spec §2）：判的是「同一事实」，比条目召回的 0.2 严得多。
export const MEMORY_SIM_THRESHOLD = 0.85
// 进入 LLM 裁决的相似旧记忆上限（spec §2 top-3）。
export const MEMORY_SIMILAR_TOP_K = 3
// 90 天未确认 → 自动归档（spec §4）。
export const MEMORY_STALE_MS = 90 * 24 * 3600 * 1000

export interface MemorySimilar {
  id: string
  content: string
  sim: number
}

// 向量初筛：新记忆向量 vs 各候选 cosine，≥ threshold 取 sim 降序 top-K。
// 候选向量为空/维数不符时 cosine=0 天然落选（语义召回同款容错）。
export function topSimilarMemories(
  newVec: number[],
  candidates: { id: string; content: string; vec: number[] }[],
  threshold: number = MEMORY_SIM_THRESHOLD,
  topK: number = MEMORY_SIMILAR_TOP_K,
): MemorySimilar[] {
  return candidates
    .map((c) => ({ id: c.id, content: c.content, sim: cosine(newVec, c.vec) }))
    .filter((x) => x.sim >= threshold)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK)
}

// 过期判定（spec §4）：启用中 && 未归档 && 距今 (lastConfirmedAt ?? createdAt) > 90 天。
// 手动停用（enabled=false）的行不参与自动归档——用户已明示，保持原样。
export function isStaleMemory(m: Memory, nowMs: number): boolean {
  if (!m.enabled || m.archivedAt) return false
  const base = Date.parse(m.lastConfirmedAt ?? m.createdAt)
  return nowMs - base > MEMORY_STALE_MS
}

// 裁决执行（spec §3）：返回需 upsert 的行集合（store 负责逐条落库 + 内存态合并）。
// oldId 双层防御内层：适配器 JSON 白名单已验 oldId ∈ similar（外层）；幻觉漏网或裁决
// 期间行被手动删除 → 默认 ADD（宁可多存不丢信息）+ console.warn。
export function applyMemoryVerdict(args: {
  memories: Memory[] // 当前全量（含停用/归档，裁决可能指向任一 enabled 行）
  newContent: string
  verdict: MemoryVerdict
  similar: { id: string; content: string }[] // 初筛产出，sim 降序；skip 无 oldId → 无操作
  nowIso: string
  newId: string // uuid 由调用方生成（测试可注入）
}): Memory[] {
  const { memories, newContent, verdict, similar, nowIso, newId } = args
  const newRow = (): Memory => ({
    id: newId,
    content: newContent,
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastConfirmedAt: nowIso,
  })
  if (verdict.action === 'add') return [newRow()]

  const oldId = verdict.oldId
  if (oldId !== undefined && !similar.some((s) => s.id === oldId)) {
    console.warn('[memoryLifecycle] verdict oldId not in similar, default ADD', verdict)
    return [newRow()]
  }

  if (verdict.action === 'skip') {
    // skip 且 oldId 缺席（解析层容忍）：无旧行可刷 → 无操作（不落新行，只 warn；
    // 不回落 top-1、不 ADD——lead 2026-10-03 约定：新信息视为已被覆盖，丢弃）。
    if (oldId === undefined) {
      console.warn('[memoryLifecycle] skip without oldId, no-op', verdict)
      return []
    }
    const old = memories.find((m) => m.id === oldId)
    if (!old) {
      // 指向的旧行裁决期间被删 → 信息已不被覆盖 → 退化 ADD 保底（不丢新信息）。
      console.warn('[memoryLifecycle] skip target row missing, default ADD', verdict)
      return [newRow()]
    }
    // 只刷 lastConfirmedAt（spec §3）——不碰 updatedAt，避免打乱列表/prompt 注入排序。
    return [{ ...old, lastConfirmedAt: nowIso }]
  }

  const old = memories.find((m) => m.id === oldId)
  if (!old) {
    // 裁决期间行被手动删除 → 退化 ADD（不复活已删内容，也不丢新信息）。
    console.warn('[memoryLifecycle] verdict old row missing, default ADD', verdict)
    return [newRow()]
  }
  if (verdict.action === 'replace') {
    // 旧行 enabled=false 留痕（不删，UI 可手动恢复）+ 新行落库。
    return [{ ...old, enabled: false, updatedAt: nowIso }, newRow()]
  }
  // merge：旧行内容替换为合并结果，不新增行。
  return [{ ...old, content: verdict.merged, updatedAt: nowIso, lastConfirmedAt: nowIso }]
}
