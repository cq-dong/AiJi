import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Entry } from '@/domain/types'

// P-A 性能（2026-10-03）：主页窗口化——首屏 30 条 + 增量加载。
// jsdom 无 IntersectionObserver → 走「加载更多」按钮兜底路径（生产 WebView 走哨兵）。
// windowGroups 纯函数：按组顺序累计到 limit 截断，组内允许截断。

vi.mock('@/app/di', () => ({
  di: { llm: {}, storage: {} },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import Home from '@/ui/screens/home'
import { windowGroups } from './helpers'

const pad = (n: number) => String(n).padStart(2, '0')

function entryOf(i: number): Entry {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - Math.floor(i / 5)) // 每 5 条一组（跨天）
  return {
    id: `e${i}`,
    createdAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`,
    updatedAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`,
    parts: [{ type: 'text', content: `条目 ${i}` }],
    status: 'ready',
  }
}

describe('windowGroups（纯函数）', () => {
  const groups = [
    { key: '2026-10-03', label: '今天', entries: [entryOf(0), entryOf(1), entryOf(2)] },
    { key: '2026-10-02', label: '昨天', entries: [entryOf(3), entryOf(4)] },
  ]

  it('limit 覆盖全部 → 原样返回', () => {
    const { visible, rendered } = windowGroups(groups, 10)
    expect(visible).toHaveLength(2)
    expect(rendered).toBe(5)
  })

  it('组内截断：limit=4 → 第一组 3 条 + 第二组 1 条', () => {
    const { visible, rendered } = windowGroups(groups, 4)
    expect(visible).toHaveLength(2)
    expect(visible[0]!.entries).toHaveLength(3)
    expect(visible[1]!.entries).toHaveLength(1)
    expect(rendered).toBe(4)
  })

  it('limit=0 → 空', () => {
    const { visible, rendered } = windowGroups(groups, 0)
    expect(visible).toHaveLength(0)
    expect(rendered).toBe(0)
  })
})

describe('home 屏窗口化', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setCurrentLang('zh') // jsdom navigator.language=en-US，不设则按钮文案是 'Load more'
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  async function renderHome(entries: Entry[]): Promise<void> {
    useUiStore.setState({
      entries,
      aiByEntry: {},
      categories: [],
      online: true,
      justSaved: null,
    })
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Home />
        </MemoryRouter>,
      )
    })
  }

  it('45 条 → 首渲 30 卡 + 「加载更多」；点击后渲 45 卡，按钮消失', async () => {
    await renderHome(Array.from({ length: 45 }, (_, i) => entryOf(i)))
    expect(container.querySelectorAll('article')).toHaveLength(30)
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('加载更多'))
    expect(btn).toBeDefined()
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelectorAll('article')).toHaveLength(45)
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes('加载更多'))).toBe(false)
  })

  it('20 条（≤PAGE）→ 全渲，无加载更多按钮', async () => {
    await renderHome(Array.from({ length: 20 }, (_, i) => entryOf(i)))
    expect(container.querySelectorAll('article')).toHaveLength(20)
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes('加载更多'))).toBe(false)
  })
})
