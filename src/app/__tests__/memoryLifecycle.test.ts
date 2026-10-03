// P-C（2026-10-03 spec §2/§3/§4）记忆生命周期纯函数测试：
// 向量初筛 0.85 阈值 + top-3 / 90 天过期判定（边界 + lastConfirmedAt 回落）/ 裁决四动作执行语义。
import { describe, it, expect, vi } from 'vitest'
import type { Memory } from '@/domain/types'
import {
  MEMORY_SIM_THRESHOLD,
  MEMORY_SIMILAR_TOP_K,
  topSimilarMemories,
  isStaleMemory,
  applyMemoryVerdict,
} from '@/app/memoryLifecycle'

const NOW = '2026-10-03T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)

function mkMemory(id: string, content: string, over: Partial<Memory> = {}): Memory {
  return { id, content, enabled: true, createdAt: NOW, updatedAt: NOW, ...over }
}

describe('topSimilarMemories 向量初筛', () => {
  it('阈值常量 = 0.85（spec §2 判同一事实），top-K = 3', () => {
    expect(MEMORY_SIM_THRESHOLD).toBe(0.85)
    expect(MEMORY_SIMILAR_TOP_K).toBe(3)
  })

  it('低于阈值落选（0.8 排除）、高于阈值命中（0.96 纳入），sim 降序', () => {
    // 勾股向量：cos([1,0],[4,3]/5)=0.8、cos([1,0],[24,7]/25)=0.96、cos([1,0],[1,0])=1
    const hits = topSimilarMemories(
      [1, 0],
      [
        { id: 'low', content: '低相似', vec: [4, 3] }, // 0.8 < 0.85
        { id: 'mid', content: '中相似', vec: [24, 7] }, // 0.96 ≥ 0.85
        { id: 'high', content: '高相似', vec: [1, 0] }, // 1
      ],
    )
    expect(hits.map((h) => h.id)).toEqual(['high', 'mid'])
  })

  it('>= 边界语义：sim 恰超阈值纳入、恰低于阈值排除', () => {
    // cos([1,1],[1,0]) = 1/√2 ≈ 0.7071：threshold 0.7 纳入、0.71 排除
    const cands = [{ id: 'x', content: 'x', vec: [1, 0] }]
    expect(topSimilarMemories([1, 1], cands, 0.7)).toHaveLength(1)
    expect(topSimilarMemories([1, 1], cands, 0.71)).toHaveLength(0)
  })

  it('top-K 截断：4 条过阈值只取 sim 最高的 3 条', () => {
    const cands = [
      { id: 'a', content: 'a', vec: [1, 0] }, // 1
      { id: 'b', content: 'b', vec: [24, 7] }, // 0.96
      { id: 'c', content: 'c', vec: [15, 8] }, // 15/17 ≈ 0.882
      { id: 'd', content: 'd', vec: [12, 5] }, // 12/13 ≈ 0.923
    ]
    const hits = topSimilarMemories([1, 0], cands)
    expect(hits.map((h) => h.id)).toEqual(['a', 'b', 'd'])
  })

  it('空向量/维数不符 cosine=0 落选；无候选返空', () => {
    expect(topSimilarMemories([1, 0], [{ id: 'e', content: 'e', vec: [] }])).toEqual([])
    expect(topSimilarMemories([1, 0], [])).toEqual([])
  })
})

describe('isStaleMemory 90 天过期判定', () => {
  it('89 天不归档、91 天归档（> 90 天严格大于）', () => {
    const at = (days: number) => new Date(NOW_MS - days * 24 * 3600 * 1000).toISOString()
    expect(isStaleMemory(mkMemory('m1', 'x', { createdAt: at(89) }), NOW_MS)).toBe(false)
    expect(isStaleMemory(mkMemory('m2', 'x', { createdAt: at(91) }), NOW_MS)).toBe(true)
  })

  it('lastConfirmedAt 缺省回落 createdAt；有 lastConfirmedAt 以它为准', () => {
    const at = (days: number) => new Date(NOW_MS - days * 24 * 3600 * 1000).toISOString()
    // createdAt 200 天前但 10 天前刚被裁决确认过 → 不归档
    expect(
      isStaleMemory(mkMemory('m1', 'x', { createdAt: at(200), lastConfirmedAt: at(10) }), NOW_MS),
    ).toBe(false)
    // createdAt 10 天前不可能；lastConfirmedAt 100 天前 → 归档
    expect(
      isStaleMemory(mkMemory('m2', 'x', { createdAt: at(200), lastConfirmedAt: at(100) }), NOW_MS),
    ).toBe(true)
  })

  it('已归档（archivedAt 非空）跳过；手动停用（enabled=false）跳过', () => {
    const old = new Date(NOW_MS - 200 * 24 * 3600 * 1000).toISOString()
    expect(isStaleMemory(mkMemory('m1', 'x', { createdAt: old, archivedAt: NOW }), NOW_MS)).toBe(false)
    expect(isStaleMemory(mkMemory('m2', 'x', { createdAt: old, enabled: false }), NOW_MS)).toBe(false)
  })
})

describe('applyMemoryVerdict 裁决四动作执行', () => {
  const similar = [
    { id: 'old1', content: '住在上海' },
    { id: 'old2', content: '喜欢美式' },
  ]
  const base = {
    memories: [mkMemory('old1', '住在上海'), mkMemory('old2', '喜欢美式')],
    newContent: '搬到杭州了',
    similar,
    nowIso: NOW,
    newId: 'new-uuid',
  }

  it('add：新行落库（enabled + 三时间戳 + lastConfirmedAt）', () => {
    const rows = applyMemoryVerdict({ ...base, verdict: { action: 'add' } })
    expect(rows).toEqual([
      { id: 'new-uuid', content: '搬到杭州了', enabled: true, createdAt: NOW, updatedAt: NOW, lastConfirmedAt: NOW },
    ])
  })

  it('replace：旧行 enabled=false 留痕 + 新行落库', () => {
    const rows = applyMemoryVerdict({ ...base, verdict: { action: 'replace', oldId: 'old1' } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'old1', enabled: false, updatedAt: NOW })
    expect(rows[1]).toMatchObject({ id: 'new-uuid', content: '搬到杭州了', enabled: true, lastConfirmedAt: NOW })
  })

  it('merge：旧行 content=merged + updatedAt/lastConfirmedAt 刷新，不新增行', () => {
    const rows = applyMemoryVerdict({
      ...base,
      verdict: { action: 'merge', oldId: 'old2', merged: '喜欢美式，也接受拿铁' },
    })
    expect(rows).toEqual([
      { ...base.memories[1], content: '喜欢美式，也接受拿铁', updatedAt: NOW, lastConfirmedAt: NOW },
    ])
  })

  it('skip（带 oldId）：只刷旧行 lastConfirmedAt，updatedAt 不动', () => {
    const rows = applyMemoryVerdict({ ...base, verdict: { action: 'skip', oldId: 'old2' } })
    expect(rows).toEqual([{ ...base.memories[1], lastConfirmedAt: NOW }])
    expect(rows[0]!.updatedAt).toBe(base.memories[1]!.updatedAt)
  })

  it('skip（无 oldId）：无操作——不落新行不刷行，仅 console.warn（lead 2026-10-03 约定）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = applyMemoryVerdict({ ...base, verdict: { action: 'skip' } })
    expect(rows).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('skip（oldId 指向的行已被删）：信息不再被覆盖 → 退化 ADD 保底', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = applyMemoryVerdict({
      ...base,
      memories: [base.memories[1]!], // old1 已被删
      verdict: { action: 'skip', oldId: 'old1' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'new-uuid', content: '搬到杭州了' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('oldId 不在 similar → 默认 ADD + console.warn（双层防御内层）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = applyMemoryVerdict({ ...base, verdict: { action: 'replace', oldId: 'ghost' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'new-uuid', enabled: true })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('裁决期间旧行被删 → 退化 ADD + console.warn（不复活已删内容）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = applyMemoryVerdict({
      ...base,
      memories: [base.memories[1]!], // old1 已被删
      verdict: { action: 'merge', oldId: 'old1', merged: 'x' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'new-uuid', content: '搬到杭州了' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
