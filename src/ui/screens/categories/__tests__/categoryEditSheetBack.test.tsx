// D1 收尾波（2026-10-05）CategoryEditSheet 接硬件返回键：
// 主层 + 嵌套导出确认层都注册；嵌套 LIFO——back 先收确认层，再按才收主层。
// 契约：docs/acceptance/d1-eng-debt.md §范围④。
// di mock 镜像 settings 既有测试（zipExport/store import 链需要）；backButton mock 捕获栈。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Category } from '@/domain/types'

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

vi.mock('@/app/di', () => ({
  di: {
    llm: {},
    storage: {},
  },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { setCurrentLang } from '@/app/currentLang'
import { CategoryEditSheet } from '@/ui/screens/categories/CategoryEditSheet'

const CATEGORY: Category = {
  slug: 'idea',
  label: '想法',
  aliases: [],
  usageCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
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

describe('CategoryEditSheet 硬件返回（D1）', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let onClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    backStack.length = 0
    setCurrentLang('zh')
    onClose = vi.fn()
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

  async function mount() {
    await act(async () => {
      root!.render(
        <CategoryEditSheet
          category={CATEGORY}
          liveCount={3}
          onClose={onClose}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
    })
  }

  it('主层挂载注册；back → onClose', async () => {
    await mount()
    expect(backStack.length).toBe(1)
    await pressBack()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('嵌套导出确认层 LIFO：back 先收确认层（主层不关），再 back 才收主层', async () => {
    await mount()
    expect(backStack.length).toBe(1)
    // 打开嵌套导出确认层
    const exportBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('导出该类别'),
    )!
    await click(exportBtn)
    expect(container.textContent).toContain('导出确认')
    expect(backStack.length).toBe(2)

    // 第一次 back：确认层收（DOM 消失），主层仍在，onClose 未调
    await pressBack()
    expect(container.textContent).not.toContain('导出确认')
    expect(container.textContent).toContain('编辑类别')
    expect(onClose).not.toHaveBeenCalled()
    expect(backStack.length).toBe(1)

    // 第二次 back：主层收
    await pressBack()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
