// P-B（2026-10-03）纯函数测试：cosine / semanticArm / mergeCites / queryVectorCache LRU
// + data/embeddings 的 textHash / buildEmbeddingText。零 I/O，不碰 IndexedDB。
import { describe, it, expect, beforeEach } from 'vitest'
import {
  cosine,
  semanticArm,
  mergeCites,
  queryVectorCache,
  SEMANTIC_SIM_THRESHOLD,
  SEMANTIC_TOP_K,
  MERGED_CITES_CAP,
} from '@/app/semanticRecall'
import { textHash, buildEmbeddingText, EMBEDDING_TEXT_CAP } from '@/data/embeddings'
import type { Entry, EntryAi } from '@/domain/types'

function entry(partial: Partial<Entry> & { id: string }): Entry {
  return {
    createdAt: '2026-10-01T08:00:00+08:00',
    updatedAt: '2026-10-01T08:00:00+08:00',
    status: 'ready',
    parts: [],
    ...partial,
  }
}

function ai(partial: Partial<EntryAi>): EntryAi {
  return {
    id: 'ai1',
    entryId: 'e1',
    version: 1,
    category: '',
    tags: [],
    facets: {},
    modelUsed: 'm',
    createdAt: '2026-10-01',
    ...partial,
  }
}

describe('textHash（djb2 变更指纹）', () => {
  it('同文本 hash 稳定', () => {
    expect(textHash('今天跑了五公里')).toBe(textHash('今天跑了五公里'))
  })
  it('文本变了 hash 变', () => {
    expect(textHash('今天跑了五公里')).not.toBe(textHash('今天跑了六公里'))
    expect(textHash('abc')).not.toBe(textHash('abd'))
  })
  it('返回 hex 字符串（空串也有确定值）', () => {
    expect(textHash('x')).toMatch(/^[0-9a-f]+$/)
    expect(textHash('')).toBe(textHash(''))
  })
})

describe('buildEmbeddingText（被嵌文本组装）', () => {
  it('title + summary + tags + 正文/转写 换行拼接', () => {
    const e = entry({
      id: 'e1',
      parts: [
        { type: 'text', content: '正文内容' },
        { type: 'audio', ref: 'r1', durationSec: 3, transcript: '转写内容' },
      ],
    })
    const text = buildEmbeddingText(e, ai({ titleSuggestion: '标题', summary: '摘要', tags: ['run', 'life'] }))
    expect(text).toBe('标题\n摘要\nrun life\n正文内容\n转写内容')
  })
  it('ai 缺席也能拼（仅正文）', () => {
    const e = entry({ id: 'e1', parts: [{ type: 'text', content: '只有正文' }] })
    expect(buildEmbeddingText(e, undefined)).toBe('只有正文')
  })
  it('cap 800 字符', () => {
    const e = entry({ id: 'e1', parts: [{ type: 'text', content: 'x'.repeat(2000) }] })
    const text = buildEmbeddingText(e, ai({ summary: 'y'.repeat(200) }))
    expect(text.length).toBe(EMBEDDING_TEXT_CAP)
    expect(text.length).toBe(800)
  })
})

describe('cosine', () => {
  it('同向 = 1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
  })
  it('正交 = 0', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0)
  })
  it('反向 = -1', () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
  })
  it('长度不等 → 0（换模型后新旧向量混存不参与召回）', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
    expect(cosine([], [])).toBe(0)
  })
  it('零向量 → 0', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
})

describe('semanticArm（sim ≥ 0.2 取 top-8，降序）', () => {
  it('阈值过滤：低于 0.2 的出局', () => {
    // 问句 [1,0]：e1 同向 sim=1；e2 近似正交 sim≈0；e3 sim≈0.447 保留
    const rows = [
      { entryId: 'e1', vector: [1, 0] },
      { entryId: 'e2', vector: [0, 1] },
      { entryId: 'e3', vector: [1, 2] },
    ]
    const out = semanticArm([1, 0], rows)
    expect(out.map((x) => x.entryId)).toEqual(['e1', 'e3'])
    expect(out[0].sim).toBeCloseTo(1)
    expect(out[1].sim).toBeCloseTo(1 / Math.sqrt(5))
  })
  it('top-8 截断 + 降序', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      entryId: `e${i}`,
      // 与 [1,0] 的夹角递增 → sim 递减但全 >0.2
      vector: [10, i],
    }))
    const out = semanticArm([1, 0], rows)
    expect(out).toHaveLength(SEMANTIC_TOP_K)
    expect(out[0].entryId).toBe('e0')
    for (let i = 1; i < out.length; i++) expect(out[i - 1].sim).toBeGreaterThanOrEqual(out[i].sim)
    for (const x of out) expect(x.sim).toBeGreaterThanOrEqual(SEMANTIC_SIM_THRESHOLD)
  })
  it('空 rows / 全部低于阈值 → 空', () => {
    expect(semanticArm([1, 0], [])).toEqual([])
    expect(semanticArm([1, 0], [{ entryId: 'e1', vector: [0, 1] }])).toEqual([])
  })
})

describe('mergeCites（关键词在前保序，语义追加去重，cap 12）', () => {
  it('关键词保序在前，语义新命中按 sim 降序追加', () => {
    const out = mergeCites(['k1', 'k2'], [
      { entryId: 's2', sim: 0.9 },
      { entryId: 's1', sim: 0.5 },
    ])
    expect(out).toEqual(['k1', 'k2', 's2', 's1'])
  })
  it('语义命中已在关键词结果里 → 不重复追加', () => {
    const out = mergeCites(['k1', 'k2'], [
      { entryId: 'k2', sim: 0.9 },
      { entryId: 's1', sim: 0.5 },
    ])
    expect(out).toEqual(['k1', 'k2', 's1'])
  })
  it('cap 12：关键词占满则语义进不来', () => {
    const kw = Array.from({ length: MERGED_CITES_CAP }, (_, i) => `k${i}`)
    const out = mergeCites(kw, [{ entryId: 's1', sim: 0.9 }])
    expect(out).toHaveLength(MERGED_CITES_CAP)
    expect(out).not.toContain('s1')
  })
  it('cap 12：总量截断', () => {
    const kw = Array.from({ length: 10 }, (_, i) => `k${i}`)
    const sem = Array.from({ length: 8 }, (_, i) => ({ entryId: `s${i}`, sim: 0.9 - i * 0.01 }))
    const out = mergeCites(kw, sem)
    expect(out).toHaveLength(MERGED_CITES_CAP)
    expect(out.slice(10)).toEqual(['s0', 's1'])
  })
  it('关键词自身去重', () => {
    expect(mergeCites(['a', 'a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('queryVectorCache（进程内 LRU 50）', () => {
  beforeEach(() => queryVectorCache.clear())

  it('set 后 get 命中；key 归一化（trim+lowercase）', () => {
    queryVectorCache.set(' 那家咖啡店 ', [1, 0])
    expect(queryVectorCache.get('那家咖啡店')).toEqual([1, 0])
    expect(queryVectorCache.get('那家咖啡店 '.trim().toLowerCase())).toEqual([1, 0])
    queryVectorCache.set('Hello World', [0, 1])
    expect(queryVectorCache.get('hello world')).toEqual([0, 1])
  })
  it('未命中 → undefined', () => {
    expect(queryVectorCache.get('没存过的问题')).toBeUndefined()
  })
  it('超 50 逐最旧（LRU eviction）', () => {
    for (let i = 0; i < 51; i++) queryVectorCache.set(`q${i}`, [i])
    expect(queryVectorCache.get('q0')).toBeUndefined() // 最旧被逐
    expect(queryVectorCache.get('q50')).toEqual([50])
  })
  it('get 命中刷新热度，不被逐出', () => {
    for (let i = 0; i < 50; i++) queryVectorCache.set(`q${i}`, [i])
    queryVectorCache.get('q0') // 刷新 q0 到最新位
    queryVectorCache.set('q-new', [999]) // 触发逐出 → 应逐 q1 而非 q0
    expect(queryVectorCache.get('q0')).toEqual([0])
    expect(queryVectorCache.get('q1')).toBeUndefined()
  })
})
