// D1 收尾波（2026-10-05）MemorySheet 接硬件返回键：back → onClose；unmount 注销。
// 契约：docs/acceptance/d1-eng-debt.md §范围④。
// di mock 镜像 memorySheet.test.tsx（store import 需要）；backButton mock 捕获 handler 栈。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Settings } from '@/domain/types'

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

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import { MemorySheet } from '@/ui/screens/settings/MemorySheet'

type UiStatePatch = Parameters<typeof useUiStore.setState>[0]

describe('MemorySheet 硬件返回（D1）', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    backStack.length = 0
    setCurrentLang('zh')
    useUiStore.setState({
      memories: [],
      settings: { autoMemory: true } as unknown as Settings,
      restoreMemory: vi.fn(),
      toggleMemory: vi.fn(),
      deleteMemory: vi.fn(),
      saveMemory: vi.fn(),
      setSettings: vi.fn(),
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

  it('挂载注册 back handler；触发后 onClose 被调', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root!.render(<MemorySheet onClose={onClose} />)
    })
    expect(backStack.length).toBe(1)
    const top = backStack.pop()!
    await act(async () => {
      top()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('unmount 自动 unregister（栈清空）', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root!.render(<MemorySheet onClose={onClose} />)
    })
    expect(backStack.length).toBe(1)
    await act(async () => {
      root!.unmount()
    })
    root = null
    expect(backStack.length).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })
})
