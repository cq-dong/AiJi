import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Entry } from '@/domain/types'
import { PD_KEYS } from '@/app/proactive'

// P-D 主动触达 UI（spec §4/§6）：CompanionCard 渲染（问候/模板两形态同骨架）、
// × dismiss 回调（不跳 /chat）、点卡片跳 /chat；home mount 编排接线
// （LLM 问候渲染 / 桩抛错模板兜底 / 频控中不渲染）。

const { greetFn, listEntriesFn, listMemoriesFn, listRemindersFn, getConversationFn } = vi.hoisted(() => ({
  greetFn: vi.fn(),
  listEntriesFn: vi.fn(),
  listMemoriesFn: vi.fn(),
  listRemindersFn: vi.fn(),
  getConversationFn: vi.fn(),
}))
vi.mock('@/app/di', () => ({
  di: {
    llm: { proactiveGreeting: greetFn },
    storage: {
      listEntries: listEntriesFn,
      listMemories: listMemoriesFn,
      listReminders: listRemindersFn,
      getConversation: getConversationFn,
      getMedia: vi.fn(async () => undefined),
    },
  },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { CompanionCard } from './CompanionCard'
import Home from '@/ui/screens/home'
import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'

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
  greetFn.mockReset()
  listEntriesFn.mockReset().mockResolvedValue([])
  listMemoriesFn.mockReset().mockResolvedValue([])
  listRemindersFn.mockReset().mockResolvedValue([])
  getConversationFn.mockReset().mockResolvedValue(undefined)
})

async function renderCard(text: string, onOpenChat = vi.fn(), onDismiss = vi.fn()) {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <CompanionCard text={text} onOpenChat={onOpenChat} onDismiss={onDismiss} />
      </MemoryRouter>,
    )
  })
  return { onOpenChat, onDismiss }
}

describe('CompanionCard', () => {
  it('问候形态：渲染 LLM 问候文本 + 「记」头像 + 关闭按钮', async () => {
    await renderCard('三天没记了，方案后来怎样了？')
    expect(container.textContent).toContain('三天没记了，方案后来怎样了？')
    expect(container.textContent).toContain('记')
    expect(container.querySelector('button[aria-label="关闭问候"]')).not.toBeNull()
  })

  it('模板形态：同骨架渲染模板兜底句', async () => {
    await renderCard('今天有什么想记的？')
    expect(container.textContent).toContain('今天有什么想记的？')
    expect(container.querySelector('[aria-label="伙伴问候，点按进入对话"]')).not.toBeNull()
  })

  it('点卡片 → onOpenChat；点 × → onDismiss 且不触发 onOpenChat', async () => {
    const { onOpenChat, onDismiss } = await renderCard('你好')
    const card = container.querySelector('[role="button"]')!
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onOpenChat).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()

    onOpenChat.mockClear()
    const closeBtn = container.querySelector('button[aria-label="关闭问候"]')!
    await act(async () => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onOpenChat).not.toHaveBeenCalled() // × 不跳 /chat（stopPropagation）
  })
})

async function renderHome() {
  useUiStore.setState({
    entries: [entryOf(0)],
    aiByEntry: {},
    categories: [],
    online: true,
    justSaved: null,
  })
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat" element={<div>CHAT_SCREEN</div>} />
        </Routes>
      </MemoryRouter>,
    )
  })
}

describe('home 屏问候卡挂载', () => {
  it('LLM 问候成功 → 渲染问候卡；点卡片跳 /chat', async () => {
    greetFn.mockResolvedValue('三天没记了，方案后来怎样了？')
    await renderHome()
    expect(container.textContent).toContain('三天没记了，方案后来怎样了？')

    const card = container.querySelector('[aria-label="伙伴问候，点按进入对话"]')!
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('CHAT_SCREEN')
  })

  it('LLM 抛错（契约桩）→ 模板兜底卡', async () => {
    greetFn.mockRejectedValue(new Error('stub: not implemented'))
    await renderHome()
    expect(container.textContent).toContain('今天有什么想记的？')
  })

  it('6h 频控中 → 不渲染卡（LLM 也不调）', async () => {
    window.localStorage.setItem(PD_KEYS.lastGreetingAt, new Date().toISOString())
    await renderHome()
    expect(container.querySelector('[aria-label="伙伴问候，点按进入对话"]')).toBeNull()
    expect(greetFn).not.toHaveBeenCalled()
  })

  it('点 × → 卡片消失 + 写当日 dismiss（重进不再出）', async () => {
    greetFn.mockResolvedValue('早上好')
    await renderHome()
    const closeBtn = container.querySelector('button[aria-label="关闭问候"]')!
    await act(async () => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[aria-label="伙伴问候，点按进入对话"]')).toBeNull()

    const pad = (n: number) => String(n).padStart(2, '0')
    const d = new Date()
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    expect(window.localStorage.getItem(PD_KEYS.dismissedDate)).toBe(today)

    // 重进 home（同日）→ 不再调 LLM、不出卡
    greetFn.mockClear()
    await renderHome()
    expect(container.querySelector('[aria-label="伙伴问候，点按进入对话"]')).toBeNull()
    expect(greetFn).not.toHaveBeenCalled()
  })
})
