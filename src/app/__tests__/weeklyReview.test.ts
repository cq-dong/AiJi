import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Entry } from '@/domain/types'

// ── P-F ② 周回顾编排测试（spec: docs/acceptance/pf-companion-pack.md §②）──────
// store 真实导入；di mock 空壳——maybeRunWeeklyReview 只读 useUiStore live state
// （entries/settings）+ 调被 setState 覆盖的 recomputeAggregate mock，全程不触 di。

vi.mock('@/app/di', () => ({ di: {} }))

import { useUiStore } from '@/app/store'
import { lastWeekRange, maybeRunWeeklyReview, WR_RATE_PREFIX } from '@/app/weeklyReview'
import { scopeRange, shiftRef } from '@/domain/dateRange'
import { seedSettings } from '@/data/seed'

// 固定「现在」：2026-10-05 周一（本地时区）→ 上周 = ISO 2026-W40（09-28 ~ 10-04）。
const NOW = new Date('2026-10-05T12:00:00')
const RANGE = scopeRange('week', shiftRef('week', NOW, -1))
const RATE_KEY = WR_RATE_PREFIX + RANGE

// 上周三（RANGE 内）与本周一（RANGE 外）。
const IN_WEEK = '2026-09-30T10:00:00'
const OUT_WEEK = '2026-10-05T08:00:00'

function mkEntry(id: string, createdAt: string): Entry {
  return { id, createdAt, updatedAt: createdAt, parts: [{ type: 'text', content: `${id} 原文` }], status: 'ready' }
}

// 夹具自检：IN_WEEK 确实落在 RANGE、OUT_WEEK 不在（防 dates 算错静默全绿）。
it('夹具日期落在预期 ISO 周', () => {
  expect(RANGE).toBe('2026-W40')
  expect(scopeRange('week', new Date(IN_WEEK))).toBe(RANGE)
  expect(scopeRange('week', new Date(OUT_WEEK))).not.toBe(RANGE)
  expect(lastWeekRange(NOW)).toBe(RANGE)
})

describe('maybeRunWeeklyReview', () => {
  const recompute = vi.fn()

  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    recompute.mockResolvedValue(undefined)
    useUiStore.setState({
      entries: [mkEntry('e-in', IN_WEEK)],
      settings: { ...seedSettings },
      recomputeAggregate: recompute,
    })
  })

  it('rate key 已存在 → skip（每周最多跑一次）', async () => {
    window.localStorage.setItem(RATE_KEY, '2026-10-05T00:00:00.000Z')
    await maybeRunWeeklyReview(NOW)
    expect(recompute).not.toHaveBeenCalled()
  })

  it('weeklyReviewEnabled === false → skip，不写 rate key（不烧 quota）', async () => {
    useUiStore.setState({ settings: { ...seedSettings, weeklyReviewEnabled: false } })
    await maybeRunWeeklyReview(NOW)
    expect(recompute).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(RATE_KEY)).toBeNull()
  })

  it('上周范围内零条目 → skip，不写 rate key', async () => {
    useUiStore.setState({ entries: [mkEntry('e-out', OUT_WEEK)] })
    await maybeRunWeeklyReview(NOW)
    expect(recompute).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(RATE_KEY)).toBeNull()
  })

  it('成功 → 以 (week, 上周 range) 调 recomputeAggregate + 写 rate key', async () => {
    await maybeRunWeeklyReview(NOW)
    expect(recompute).toHaveBeenCalledTimes(1)
    expect(recompute).toHaveBeenCalledWith('week', RANGE)
    expect(window.localStorage.getItem(RATE_KEY)).not.toBeNull()
  })

  it('recompute 抛错 → console.warn + 不写 rate key（下次进首页重试）', async () => {
    recompute.mockRejectedValue(new Error('llm down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await maybeRunWeeklyReview(NOW)
    expect(recompute).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    expect(window.localStorage.getItem(RATE_KEY)).toBeNull()
    warn.mockRestore()
  })

  it('deps.store 注入：rate key 写到注入存储，不碰 window.localStorage', async () => {
    const mem = new Map<string, string>()
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    }
    await maybeRunWeeklyReview(NOW, { store })
    expect(recompute).toHaveBeenCalledTimes(1)
    expect(mem.get(RATE_KEY)).toBeDefined()
    expect(window.localStorage.getItem(RATE_KEY)).toBeNull()
    // 第二次：注入存储里已有 rate key → skip
    await maybeRunWeeklyReview(NOW, { store })
    expect(recompute).toHaveBeenCalledTimes(1)
  })
})
