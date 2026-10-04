// D1 收尾波（2026-10-05）trash 永久删除确认 dialog 接硬件返回键：back = 取消 = onClose。
// 契约：docs/acceptance/d1-eng-debt.md §范围④。
// react-router-dom mock（useNavigate）；di mock（store import 链需要）；backButton mock 捕获栈。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Entry } from '@/domain/types'

const { backStack } = vi.hoisted(() => {
  const stack: Array<() => void> = []
  return { backStack: stack }
})

vi.mock('@/app/backButton', () => ({
  pushBackHandler: (fn: () => void) => {
    backStack.push(fn)
    return () => {
      const i = backStack.indexOf(fn)
      if (i >= 0) backStack.splice(i, 1)
    }
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    llm: {},
    storage: {},
  },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import Trash from '@/ui/screens/trash'

type UiStatePatch = Parameters<typeof useUiStore.setState>[0]

const TRASHED_ENTRY: Entry = {
  id: 'e1',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  parts: [{ type: 'text', content: '一条已删除的记录' }],
  status: 'ready',
  deletedAt: '2026-10-01T08:00:00.000Z',
}

// 模拟真实 backButton：pop 栈顶后执行（先 pop 再调，与 initBackButton 一致）。
async function pressBack() {
  const top = backStack.pop()
  expect(top, '栈里应有已注册的 handler').toBeDefined()
  await act(async () => {
    top!()
  })
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('Trash 确认 dialog 硬件返回（D1）', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let deleteEntryMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    backStack.length = 0
    setCurrentLang('zh')
    deleteEntryMock = vi.fn().mockResolvedValue(undefined)
    useUiStore.setState({
      trashed: [TRASHED_ENTRY],
      aiByEntry: {},
      recoverEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: deleteEntryMock,
    } as unknown as UiStatePatch)
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

  async function openConfirmDialog() {
    await act(async () => {
      root!.render(<Trash />)
    })
    // 滑卡右缘「删除」操作钮（aria-label = common.delete）→ 开不可逆确认 dialog
    const delBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === '删除',
    )!
    expect(delBtn, '应存在删除操作钮').toBeTruthy()
    await click(delBtn)
    expect(container.textContent).toContain('永久删除')
  }

  it('确认 dialog 挂载注册；back → 取消（dialog 关、deleteEntry 未调）', async () => {
    await openConfirmDialog()
    expect(backStack.length).toBe(1)
    await pressBack()
    // back = onClose = 取消语义：dialog 卸载、不发生删除
    expect(container.textContent).not.toContain('永久删除')
    expect(deleteEntryMock).not.toHaveBeenCalled()
    expect(backStack.length).toBe(0)
  })

  it('dialog 未开时栈为空（back 不被隐形 handler 吞掉）', async () => {
    await act(async () => {
      root!.render(<Trash />)
    })
    expect(backStack.length).toBe(0)
  })
})
