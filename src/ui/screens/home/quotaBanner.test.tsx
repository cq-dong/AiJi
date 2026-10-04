import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Entry } from '@/domain/types'

// Q6 采集压缩包 ③（2026-10-05）：OPFS 配额横幅。home mount fire-and-forget 调
// refreshStorageQuota（@/app/storageQuota，q6-store 路导出）；store.storageQuota
// usage/quota ≥ 80% 且当日未 dismiss → CompanionCard 下、时间线上出警示卡；
// × 写 localStorage['aiji.quota.dismissed']=本地 YYYY-MM-DD（当日不再出，次日重出）。

const { refreshFn, listConversationsFn } = vi.hoisted(() => ({
  refreshFn: vi.fn(),
  listConversationsFn: vi.fn(),
}))
vi.mock('@/app/storageQuota', () => ({ refreshStorageQuota: refreshFn }))
vi.mock('@/app/di', () => ({
  di: {
    llm: { proactiveGreeting: vi.fn(async () => null) },
    storage: {
      listEntries: vi.fn(async () => []),
      listMemories: vi.fn(async () => []),
      listReminders: vi.fn(async () => []),
      listConversations: listConversationsFn,
      getMedia: vi.fn(async () => undefined),
    },
  },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import Home from '@/ui/screens/home'
import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'

const DISMISS_KEY = 'aiji.quota.dismissed'

const pad = (n: number) => String(n).padStart(2, '0')
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function entryOf(i: number): Entry {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return {
    id: `e${i}`,
    createdAt: d.toISOString(),
    updatedAt: d.toISOString(),
    parts: [{ type: 'text', content: `条目 ${i}` }],
    status: 'ready',
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setCurrentLang('zh')
  window.localStorage.clear()
  document.body.innerHTML = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  refreshFn.mockReset().mockResolvedValue(undefined)
  listConversationsFn.mockReset().mockResolvedValue([])
})

async function renderHome(storageQuota: { usage: number; quota: number } | null) {
  useUiStore.setState({
    entries: [entryOf(0)],
    aiByEntry: {},
    categories: [],
    online: true,
    justSaved: null,
    storageQuota,
  })
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    )
  })
}

const bannerText = () => container.querySelector('[role="alert"]')?.textContent ?? null

describe('home 配额横幅（Q6 ③）', () => {
  it('mount 调 refreshStorageQuota；85% ≥ 80% → 渲染警示卡（含 pct 与清理建议）', async () => {
    await renderHome({ usage: 850, quota: 1000 })
    expect(refreshFn).toHaveBeenCalledTimes(1)
    const text = bannerText()
    expect(text).toContain('本地存储已用 85%')
    expect(text).toContain('回收站')
    expect(container.querySelector('button[aria-label="知道了"]')).not.toBeNull()
  })

  it('50% < 80% → 不渲染', async () => {
    await renderHome({ usage: 500, quota: 1000 })
    expect(bannerText()).toBeNull()
  })

  it('storageQuota null（estimate 不可用/未返回）→ 不渲染', async () => {
    await renderHome(null)
    expect(bannerText()).toBeNull()
  })

  it('点 × → 横幅消失 + localStorage 写今日本地日期', async () => {
    await renderHome({ usage: 900, quota: 1000 })
    const closeBtn = container.querySelector('button[aria-label="知道了"]')!
    await act(async () => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(bannerText()).toBeNull()
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe(localYmd(new Date()))
  })

  it('localStorage 已是今日 → 不渲染（当日不再出）', async () => {
    window.localStorage.setItem(DISMISS_KEY, localYmd(new Date()))
    await renderHome({ usage: 900, quota: 1000 })
    expect(bannerText()).toBeNull()
  })

  it('localStorage 是昨日 → 渲染（次日重出）', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    window.localStorage.setItem(DISMISS_KEY, localYmd(yesterday))
    await renderHome({ usage: 900, quota: 1000 })
    expect(bannerText()).toContain('本地存储已用 90%')
  })

  it('quota=0（异常值）→ 不渲染（除零守卫）', async () => {
    await renderHome({ usage: 0, quota: 0 })
    expect(bannerText()).toBeNull()
  })
})
