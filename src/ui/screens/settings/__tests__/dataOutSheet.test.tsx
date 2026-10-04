// PRD trust pack t1（2026-10-05）：设置「数据出门」DataOutSheet。
// 契约：docs/acceptance/prd-trust-pack.md §范围③b / §测试要点 t1。
// - groupUploadsByModel 纯函数：按 modelUsed 聚合 aiByEntry + aggregates → count/lastAt（取最大），
//   按 lastAt 降序。
// - 渲染：有数据出聚合行；无数据出空态文案。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Aggregate, EntryAi } from '@/domain/types'

vi.mock('@/app/di', () => ({
  di: { llm: {}, storage: {} },
}))

// framer-motion useReducedMotion 需要 matchMedia（jsdom 无）——最小 stub。
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { groupUploadsByModel, DataOutSheet } from '@/ui/screens/settings/DataOutSheet'
import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'

function makeAi(entryId: string, modelUsed: string, createdAt: string): EntryAi {
  return {
    id: `ai-${entryId}`,
    entryId,
    version: 1,
    category: 'idea',
    tags: [],
    facets: {},
    modelUsed,
    createdAt,
  }
}
function makeAggregate(id: string, modelUsed: string, createdAt: string): Aggregate {
  return {
    id,
    scope: { type: 'day', range: '2026-09-01' },
    summary: 's',
    entryIds: [],
    modelUsed,
    createdAt,
    stale: false,
  }
}

describe('groupUploadsByModel（纯函数）', () => {
  it('按 modelUsed 聚合 aiByEntry + aggregates：count 累计、lastAt 取最新、按 lastAt 降序', () => {
    const groups = groupUploadsByModel(
      {
        e1: makeAi('e1', 'deepseek-v4-flash', '2026-09-01T08:00:00.000Z'),
        e2: makeAi('e2', 'deepseek-v4-flash', '2026-09-03T08:00:00.000Z'),
        e3: makeAi('e3', 'builtin-llm', '2026-09-02T08:00:00.000Z'),
      },
      [makeAggregate('a1', 'deepseek-v4-flash', '2026-09-04T08:00:00.000Z')],
    )
    expect(groups).toHaveLength(2)
    // deepseek：2 条 EntryAi + 1 条 aggregate = 3；lastAt = 09-04（aggregate）
    expect(groups[0]).toEqual({ model: 'deepseek-v4-flash', count: 3, lastAt: '2026-09-04T08:00:00.000Z' })
    expect(groups[1]).toEqual({ model: 'builtin-llm', count: 1, lastAt: '2026-09-02T08:00:00.000Z' })
  })

  it('空输入 → 空数组', () => {
    expect(groupUploadsByModel({}, [])).toEqual([])
  })
})

describe('DataOutSheet 渲染', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    setCurrentLang('zh')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount()
      })
      root = null
    }
    container.remove()
  })

  it('有记录 → 聚合行（model + 条数 + 最近时间）', async () => {
    useUiStore.setState({
      aiByEntry: { e1: makeAi('e1', 'deepseek-v4-flash', new Date().toISOString()) },
      aggregates: [],
    })
    await act(async () => {
      root!.render(<DataOutSheet onClose={() => {}} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('deepseek-v4-flash')
    expect(text).toContain('1 条')
    expect(text).not.toContain('尚无数据出门记录')
  })

  it('无记录 → 空态文案', async () => {
    useUiStore.setState({ aiByEntry: {}, aggregates: [] })
    await act(async () => {
      root!.render(<DataOutSheet onClose={() => {}} />)
    })
    expect(container.textContent ?? '').toContain('尚无数据出门记录')
  })
})
