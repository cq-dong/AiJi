import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Entry } from '@/domain/types'

// 回归（2026-10-05 用户报 bug）：「今天」锚定曾取最新条目日期（原型 seed 遗留）——
// 最新条目是 3 天前时，其分组头与头部计数仍按「今天」显示。修复：锚真实系统时钟。

vi.mock('@/app/di', () => ({
  di: { llm: {}, storage: {} },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import Home from '@/ui/screens/home'

const pad = (n: number) => String(n).padStart(2, '0')

// daysAgo 天前本地正午的条目。
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

// 与 helpers.monthDayLabel 同规则（zh-CN short month + numeric day）。
function monthDayOf(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

describe('home「今天」锚定真实系统时钟', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setCurrentLang('zh')
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  async function renderHome(entries: Entry[]): Promise<void> {
    useUiStore.setState({ entries, aiByEntry: {}, categories: [], online: true, justSaved: null })
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Home />
        </MemoryRouter>,
      )
    })
  }

  it('最新条目为 3 天前 → 分组头显实际日期而非「今天」，头部计「今天 0 条」', async () => {
    await renderHome([entryDaysAgo(3, 0), entryDaysAgo(3, 1), entryDaysAgo(4, 2)])

    const h2s = [...container.querySelectorAll('section h2')].map((h) => h.textContent ?? '')
    expect(h2s.length).toBeGreaterThan(0)
    expect(h2s.some((x) => x.includes('今天'))).toBe(false)
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    expect(h2s.some((x) => x.includes(monthDayOf(threeDaysAgo)))).toBe(true)

    // 头部：topDateLabel=真实今天，计数=真实今天条目数（0）。
    const header = container.querySelector('header')
    expect(header?.textContent ?? '').toMatch(/今天\s*0\s*条/)
  })

  it('条目就是今天 → 分组头仍显「今天」（正常路径不回归）', async () => {
    await renderHome([entryDaysAgo(0, 0), entryDaysAgo(1, 1)])
    const h2s = [...container.querySelectorAll('section h2')].map((h) => h.textContent ?? '')
    expect(h2s.some((x) => x.includes('今天'))).toBe(true)
    expect(h2s.some((x) => x.includes('昨天'))).toBe(true)
    const header = container.querySelector('header')
    expect(header?.textContent ?? '').toMatch(/今天\s*1\s*条/)
  })
})
