// A1（2026-10-05）Sheet 消费点：
// ① 面板 paddingBottom = max(16px, --safe-bottom, --safe-ime)（键盘顶起时底部输入面不被遮）
// ② 硬件返回键 → dismiss（沿既有路径：动画 + onClose）；unmount 自动 unregister。
// 契约：docs/acceptance/a1-android-shell.md §范围①②。
// backButton 模块由 a1-app 并行实现，本测试用 vi.mock 捕获注册的 handler 模拟硬件返回。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AnimatePresence } from 'framer-motion'

// vi.hoisted：handler 栈捕获放进 hoisted 闭包，vi.mock factory 可引用。
// 模拟 a1-app backButton 的 LIFO 栈语义（注册=入栈，unregister=出栈）。
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
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sheet } from '@/ui/components/Sheet'

let container: HTMLDivElement
let root: Root | null = null

async function renderSheet(onClose: () => void): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <AnimatePresence>
        <Sheet title="测试" onClose={onClose}>
          <div>content</div>
        </Sheet>
      </AnimatePresence>,
    )
  })
}

describe('Sheet A1 ①②', () => {
  beforeEach(() => {
    backStack.length = 0
  })
  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount()
      })
      root = null
    }
    container?.remove()
  })

  it('② 挂载注册 back handler；触发后 onClose 被调', async () => {
    const onClose = vi.fn()
    await renderSheet(onClose)
    expect(backStack.length).toBe(1)
    const handler = backStack[backStack.length - 1]
    expect(handler).toBeDefined()
    await act(async () => {
      handler!()
    })
    // dismiss：reduced-motion 直调 onClose；否则 spring 动画 .then(onClose)——waitFor 兼容两路径
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce(), { timeout: 2000 })
  })

  it('② unmount 自动 unregister（栈清空）→ onClose 不再新增调用', async () => {
    const onClose = vi.fn()
    await renderSheet(onClose)
    expect(backStack.length).toBe(1)
    await act(async () => {
      root!.unmount()
    })
    root = null
    // unmount 后 cleanup 调 unregister → 栈空；真实 backButton.ts pop 栈空 → 不会调本 sheet 的 handler
    expect(backStack.length).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('② 多个 Sheet 实例各注册一份（栈长 = 挂载数，天然 LIFO）', async () => {
    const onClose1 = vi.fn()
    const onClose2 = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <AnimatePresence>
          <Sheet title="s1" onClose={onClose1}>
            <div>one</div>
          </Sheet>
          <Sheet title="s2" onClose={onClose2}>
            <div>two</div>
          </Sheet>
        </AnimatePresence>,
      )
    })
    expect(backStack.length).toBe(2)
    // 栈顶 = 最后挂载的（s2）→ 模拟返回先收 s2
    const top = backStack[backStack.length - 1]
    await act(async () => {
      top()
    })
    await vi.waitFor(() => expect(onClose2).toHaveBeenCalledOnce(), { timeout: 2000 })
    expect(onClose1).not.toHaveBeenCalled()
  })

  it('① 面板 style.paddingBottom 含 max(16px, --safe-bottom, --safe-ime)', async () => {
    await renderSheet(vi.fn())
    // 面板 = role=dialog 根的直接 div 子元素（backdrop 是 button，不会误中）
    const panel = container.querySelector('[role="dialog"] > div') as HTMLElement | null
    expect(panel, '面板应存在').toBeTruthy()
    expect(panel!.style.paddingBottom).toContain('max(16px')
    expect(panel!.style.paddingBottom).toContain('var(--safe-bottom')
    expect(panel!.style.paddingBottom).toContain('var(--safe-ime')
  })
})
