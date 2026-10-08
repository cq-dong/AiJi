import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Entry } from '@/domain/types'

// 回归（2026-10-05 用户报 bug）：TimeLens 分组头「今天」曾锚最新条目日期——
// 最新条目是 3 天前时其分组头错标「今天」。修复：锚真实系统时钟。

vi.mock('@/app/di', () => ({
  di: { llm: {}, storage: {} },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { setCurrentLang } from '@/app/currentLang'
import { TimeLens } from './TimeLens'

const pad = (n: number) => String(n).padStart(2, '0')

function entryDaysAgo(daysAgo: number, i: number): Entry {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`
  return {
    id: `old${i}`,
    createdAt: iso,
    updatedAt: iso,
    parts: [{ type: 'text', content: `旧条目 ${i}` }],
    status: 'ready',
  }
}

describe('TimeLens「今天」锚定真实系统时钟', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setCurrentLang('zh')
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  it('最新条目为 3 天前 → 分组头显实际日期而非「今天」', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TimeLens entries={[entryDaysAgo(3, 0), entryDaysAgo(4, 1)]} aiByEntry={{}} categories={[]} />
        </MemoryRouter>,
      )
    })
    const h2s = [...container.querySelectorAll('section h2')].map((h) => h.textContent ?? '')
    expect(h2s.length).toBeGreaterThan(0)
    expect(h2s.some((x) => x.includes('今天'))).toBe(false)
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    const md = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(threeDaysAgo)
    expect(h2s.some((x) => x.includes(md))).toBe(true)
  })

  it('条目就是今天 → 分组头仍显「今天」（正常路径不回归）', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TimeLens entries={[entryDaysAgo(0, 0), entryDaysAgo(1, 1)]} aiByEntry={{}} categories={[]} />
        </MemoryRouter>,
      )
    })
    const h2s = [...container.querySelectorAll('section h2')].map((h) => h.textContent ?? '')
    expect(h2s.some((x) => x.includes('今天'))).toBe(true)
    expect(h2s.some((x) => x.includes('昨天'))).toBe(true)
  })
})
