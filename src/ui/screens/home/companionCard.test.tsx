import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Entry } from '@/domain/types'
import { PD_KEYS } from '@/app/proactive'

// P-D 主动触达 UI（spec §4/§6）：CompanionCard 渲染（问候/模板两形态同骨架）、
// × dismiss 回调（不跳 /chat）、点卡片跳 /chat；home mount 编排接线
// （LLM 问候渲染 / 桩抛错模板兜底 / 频控中不渲染）。

const { greetFn, listEntriesFn, listMemoriesFn, listRemindersFn, getConversationFn, listConversationsFn } = vi.hoisted(() => ({
  greetFn: vi.fn(),
  listEntriesFn: vi.fn(),
  listMemoriesFn: vi.fn(),
  listRemindersFn: vi.fn(),
  getConversationFn: vi.fn(),
  listConversationsFn: vi.fn(),
}))
vi.mock('@/app/di', () => ({
  di: {
    llm: { proactiveGreeting: greetFn },
    storage: {
      listEntries: listEntriesFn,
      listMemories: listMemoriesFn,
      listReminders: listRemindersFn,
      getConversation: getConversationFn,
      listConversations: listConversationsFn,
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
  listConversationsFn.mockReset().mockResolvedValue([])
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

  it('StrictMode 双跑下问候卡仍渲染，且 LLM 只调一次（F-1 回归）', async () => {
    greetFn.mockResolvedValue('早上好')
    useUiStore.setState({
      entries: [entryOf(0)],
      aiByEntry: {},
      categories: [],
      online: true,
      justSaved: null,
    })
    await act(async () => {
      root.render(
        <StrictMode>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/chat" element={<div>CHAT_SCREEN</div>} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      )
    })
    // dev StrictMode 假卸载不得误杀 setGreeting（run1 promise resolve 时 cleanup 置 alive=false 的旧 bug）
    expect(container.querySelector('[aria-label="伙伴问候，点按进入对话"]')).not.toBeNull()
    expect(container.textContent).toContain('早上好')
    // greetedRef 守卫：双跑不重复调 LLM
    expect(greetFn).toHaveBeenCalledTimes(1)
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

// W0 修复（2026-10-04）：greeting context 的 rollingSummary 改取「updatedAt 最新会话」——
// 旧实现读死会话 id='1'（单会话 MVP 残留），多会话（crypto.randomUUID id）下永远 miss，
// rollingSummary 静默缺席。对齐 store.ts hydrate 的 chatList[0] 语义；无会话 → undefined。
describe('home 问候 context · 最新会话 rollingSummary（W0）', () => {
  it('两个会话 → greeting ctx 带 updatedAt 最新者的 rollingSummary，不再读死会话 id=1', async () => {
    listConversationsFn.mockResolvedValue([
      { id: 'c-new', messages: [], updatedAt: '2026-10-01T10:00:00.000Z', rollingSummary: '新摘要' },
      { id: 'c-old', messages: [], updatedAt: '2026-09-01T10:00:00.000Z', rollingSummary: '旧摘要' },
    ])
    greetFn.mockResolvedValue('早上好')
    await renderHome()
    expect(greetFn).toHaveBeenCalledWith(expect.objectContaining({ rollingSummary: '新摘要' }))
    expect(getConversationFn).not.toHaveBeenCalled() // 死路径 getConversation('1') 已移除
  })

  it('乱序返回也取 updatedAt 最大者（钉死「取最新」语义，不依赖存储排序）', async () => {
    listConversationsFn.mockResolvedValue([
      { id: 'c-old', messages: [], updatedAt: '2026-09-01T10:00:00.000Z', rollingSummary: '旧摘要' },
      { id: 'c-new', messages: [], updatedAt: '2026-10-01T10:00:00.000Z', rollingSummary: '新摘要' },
    ])
    greetFn.mockResolvedValue('早上好')
    await renderHome()
    expect(greetFn).toHaveBeenCalledWith(expect.objectContaining({ rollingSummary: '新摘要' }))
  })

  it('无会话 → rollingSummary 为 undefined，问候照常渲染不崩', async () => {
    listConversationsFn.mockResolvedValue([])
    greetFn.mockResolvedValue('晚上好')
    await renderHome()
    expect(greetFn).toHaveBeenCalledWith(expect.objectContaining({ rollingSummary: undefined }))
    expect(container.textContent).toContain('晚上好')
  })
})
