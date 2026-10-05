// E2 eng-debt 测试补差（契约 docs/acceptance/e2-eng-debt.md §范围③）。
// summaryCache.ts（87 行纯函数，localStorage 同步）此前零测试。覆盖：
// - get：未命中 → null；命中 round-trip；腐坏 JSON → null（catch 分支）；detailLevel 键隔离（D27）。
// - set：同键覆盖；localStorage 抛异常被吞（catch + console.error）。
// - clear：精确删目标键，其他键（异 type/dateKey/level/外来前缀）不动。
// - shouldRefresh：无缓存 → true；day 只看 entryCount（generatedAt 再旧也不刷）；
//   week 跨日边界（临届同日 false / 跨日 true，entryCount 被忽略）；
//   month 跨 ISO 周（同周 false / 前周 true）。时间相关用 fake timers 钉死。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { get, set, clear, shouldRefresh, type CachedSummary } from '@/adapters/summaryCache'

const K = (type: string, dateKey: string, level: number) => `aiji:summary:${type}:${dateKey}:L${level}`

function summary(over: Partial<CachedSummary> = {}): CachedSummary {
  return {
    content: '本期摘要',
    generatedAt: new Date(2026, 9, 5, 8, 0, 0).toISOString(),
    entryCount: 5,
    ...over,
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('get / set', () => {
  it('未命中 → null；set 后命中 round-trip（含可选字段）', () => {
    expect(get('day', '2026-10-05', 3)).toBeNull()
    const data = summary({ highlights: ['a', 'b'], modelUsed: 'deepseek-v4-flash', detailLevel: 3 })
    set('day', '2026-10-05', 3, data)
    expect(get('day', '2026-10-05', 3)).toEqual(data)
  })

  it('同键 set 覆盖旧值', () => {
    set('day', '2026-10-05', 3, summary({ content: '旧' }))
    set('day', '2026-10-05', 3, summary({ content: '新' }))
    expect(get('day', '2026-10-05', 3)?.content).toBe('新')
  })

  it('detailLevel 键隔离：L3 有值不影响 L4 未命中（D27 切档不互相覆盖）', () => {
    set('week', '2026-W41', 3, summary({ content: 'L3 摘要' }))
    expect(get('week', '2026-W41', 4)).toBeNull()
    expect(get('week', '2026-W41', 3)?.content).toBe('L3 摘要')
  })

  it('腐坏 JSON → null（解析异常走 catch，不抛出）', () => {
    localStorage.setItem(K('day', '2026-10-05', 3), '{corrupted')
    expect(get('day', '2026-10-05', 3)).toBeNull()
  })

  it('localStorage.setItem 抛异常（配额满）→ 吞掉 + console.error，不向调用方抛', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => set('day', '2026-10-05', 3, summary())).not.toThrow()
    expect(errSpy).toHaveBeenCalledOnce()
  })
})

describe('clear', () => {
  it('精确删目标键：异 dateKey / 异 level / 异 type / 外来前缀键全部不动', () => {
    set('day', '2026-10-05', 3, summary())
    set('day', '2026-10-05', 4, summary({ content: 'L4' }))
    set('day', '2026-10-04', 3, summary({ content: '昨日' }))
    set('week', '2026-W41', 3, summary({ content: '周' }))
    localStorage.setItem('other-app:key', 'keep')

    clear('day', '2026-10-05', 3)

    expect(get('day', '2026-10-05', 3)).toBeNull()
    expect(get('day', '2026-10-05', 4)?.content).toBe('L4')
    expect(get('day', '2026-10-04', 3)?.content).toBe('昨日')
    expect(get('week', '2026-W41', 3)?.content).toBe('周')
    expect(localStorage.getItem('other-app:key')).toBe('keep')
  })

  it('删不存在的键 → 不抛、不影响其他键', () => {
    set('day', '2026-10-05', 3, summary())
    expect(() => clear('month', '2026-10', 1)).not.toThrow()
    expect(get('day', '2026-10-05', 3)).not.toBeNull()
  })
})

describe('shouldRefresh', () => {
  it('无缓存 → true（三种 scope 同语义）', () => {
    expect(shouldRefresh('day', '2026-10-05', 5, 3)).toBe(true)
    expect(shouldRefresh('week', '2026-W41', 0, 3)).toBe(true)
    expect(shouldRefresh('month', '2026-10', 0, 3)).toBe(true)
  })

  it('day：只看 entryCount——相等 false / 不等 true；generatedAt 再旧也不刷', () => {
    set('day', '2026-10-05', 3, summary({ entryCount: 5, generatedAt: '2020-01-01T00:00:00.000Z' }))
    expect(shouldRefresh('day', '2026-10-05', 5, 3)).toBe(false)
    expect(shouldRefresh('day', '2026-10-05', 6, 3)).toBe(true)
    expect(shouldRefresh('day', '2026-10-05', 0, 3)).toBe(true)
  })

  it('week：同日 false（entryCount 被忽略）；前一日 true', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0)) // 周一 noon（本地时区）
    set('week', '2026-W41', 3, summary({ entryCount: 1, generatedAt: new Date(2026, 9, 5, 8, 0, 0).toISOString() }))
    // entryCount 差很多也不刷——week 只认跨日。
    expect(shouldRefresh('week', '2026-W41', 999, 3)).toBe(false)
    set('week', '2026-W41', 3, summary({ generatedAt: new Date(2026, 9, 4, 23, 0, 0).toISOString() }))
    expect(shouldRefresh('week', '2026-W41', 1, 3)).toBe(true)
  })

  it('week 临届：23:59:59 同日 false → 00:00:01 跨日 true', () => {
    vi.useFakeTimers()
    const generatedAt = new Date(2026, 9, 5, 0, 0, 1).toISOString()
    set('week', '2026-W41', 3, summary({ generatedAt }))

    vi.setSystemTime(new Date(2026, 9, 5, 23, 59, 59))
    expect(shouldRefresh('week', '2026-W41', 0, 3)).toBe(false)

    vi.setSystemTime(new Date(2026, 9, 6, 0, 0, 1))
    expect(shouldRefresh('week', '2026-W41', 0, 3)).toBe(true)
  })

  it('month：同 ISO 周 false（entryCount 被忽略）；前一周 true', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0)) // 2026-10-07 noon
    set('month', '2026-10', 3, summary({ entryCount: 2, generatedAt: new Date(2026, 9, 7, 8, 0, 0).toISOString() }))
    expect(shouldRefresh('month', '2026-10', 123, 3)).toBe(false)
    // 8 天前必然落在上一 ISO 周（同年内，无跨年边界）。
    set('month', '2026-10', 3, summary({ generatedAt: new Date(2026, 8, 29, 12, 0, 0).toISOString() }))
    expect(shouldRefresh('month', '2026-10', 2, 3)).toBe(true)
  })
})
