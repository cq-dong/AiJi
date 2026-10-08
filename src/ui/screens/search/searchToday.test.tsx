import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Entry } from '@/domain/types'

// 回归（2026-10-05 用户报 bug）：搜索结果卡的相对时间曾锚最新条目日期——
// 最新条目是 3 天前时，结果卡错显「今天 HH:mm」（而日期过滤器早已用真实时钟，自相矛盾）。
// 修复：结果卡与过滤器统一锚真实系统时钟。

vi.mock('@/app/di', () => ({
  di: { llm: {}, storage: {} },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import Search from '@/ui/screens/search'

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
    parts: [{ type: 'text', content: `桂花拿铁 ${i}` }],
    status: 'ready',
  }
}

// React controlled input：走原生 setter + input 事件。
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('search 结果卡「今天」锚定真实系统时钟', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setCurrentLang('zh')
    localStorage.clear() // useRecentSearches
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  it('最新条目为 3 天前 → 结果卡显 M/D 而非「今天 HH:mm」', async () => {
    useUiStore.setState({ entries: [entryDaysAgo(3, 0)], aiByEntry: {}, categories: [], tags: [] })
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Search />
        </MemoryRouter>,
      )
    })
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).toBeTruthy()
    await act(async () => {
      typeInto(input, '桂花')
    })

    // 结果卡时间 span：「{相对时间} · {模态}」。过滤器区另有「今天」chip，须锚到卡片。
    const timeSpan = [...container.querySelectorAll('span')].find((s) => s.textContent?.includes(' · '))
    expect(timeSpan).toBeDefined()
    expect(timeSpan!.textContent).not.toContain('今天')
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    expect(timeSpan!.textContent).toContain(`${threeDaysAgo.getMonth() + 1}/${threeDaysAgo.getDate()}`)
  })
})
