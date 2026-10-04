// D1 收尾波（2026-10-05）useBackDismiss hook 单测：
// 挂载注册 / unmount 注销 / latest-ref——onClose 换新引用后触发调的是新引用。
// 契约：docs/acceptance/d1-eng-debt.md §范围④。
// backButton 模块用 vi.mock 捕获注册的 handler 栈（模式同 sheetBackIme.test.tsx）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// vi.hoisted：handler 栈捕获放进 hoisted 闭包，vi.mock factory 可引用。
// 模拟 backButton 的 LIFO 栈语义（注册=入栈，unregister=出栈）。
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

import { useBackDismiss } from '@/ui/components/useBackDismiss'

// 探针组件：仅调 hook，渲染 null。
function Probe({ onClose }: { onClose: () => void }) {
  useBackDismiss(onClose)
  return null
}

// 模拟真实 backButton：pop 栈顶后执行（先 pop 再调，与 initBackButton 一致）。
async function pressBack() {
  const top = backStack.pop()
  expect(top, '栈里应有已注册的 handler').toBeDefined()
  await act(async () => {
    top!()
  })
}

describe('useBackDismiss', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    backStack.length = 0
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

  it('挂载注册一份 handler；触发后调 onClose', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root!.render(<Probe onClose={onClose} />)
    })
    expect(backStack.length).toBe(1)
    await pressBack()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('unmount 自动 unregister（栈清空）', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root!.render(<Probe onClose={onClose} />)
    })
    expect(backStack.length).toBe(1)
    await act(async () => {
      root!.unmount()
    })
    root = null
    expect(backStack.length).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('onClose 换新引用后，触发调的是新引用（latest-ref 无旧闭包）', async () => {
    const onClose1 = vi.fn()
    const onClose2 = vi.fn()
    await act(async () => {
      root!.render(<Probe onClose={onClose1} />)
    })
    // 重渲换新引用——hook 内 effect 依赖空数组不重注册，latest-ref 必须指向新引用
    await act(async () => {
      root!.render(<Probe onClose={onClose2} />)
    })
    expect(backStack.length).toBe(1)
    await pressBack()
    expect(onClose2).toHaveBeenCalledOnce()
    expect(onClose1).not.toHaveBeenCalled()
  })

  it('多个实例各注册一份（栈长 = 挂载数，LIFO 后挂载先收）', async () => {
    const onClose1 = vi.fn()
    const onClose2 = vi.fn()
    await act(async () => {
      root!.render(
        <>
          <Probe onClose={onClose1} />
          <Probe onClose={onClose2} />
        </>,
      )
    })
    expect(backStack.length).toBe(2)
    await pressBack()
    expect(onClose2).toHaveBeenCalledOnce()
    expect(onClose1).not.toHaveBeenCalled()
  })
})
