// P-C（2026-10-03 spec §4 UI）AI 记忆 sheet 归档组：
// 已归档折叠组置底 / 默认折叠 / 归档条目不显启停开关 / 恢复回调。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Memory, Settings } from '@/domain/types'

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

function mkMemory(id: string, content: string, over: Partial<Memory> = {}): Memory {
  return {
    id,
    content,
    enabled: true,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...over,
  }
}

describe('MemorySheet 归档组', () => {
  let container: HTMLDivElement
  let root: Root
  let restoreMemoryMock: ReturnType<typeof vi.fn>
  let toggleMemoryMock: ReturnType<typeof vi.fn>

  const ACTIVE = mkMemory('a1', '喜欢美式咖啡')
  const ARCHIVED = mkMemory('r1', '正在准备 7 月考试', { archivedAt: '2026-10-01T00:00:00.000Z' })

  function render(memories: Memory[]) {
    restoreMemoryMock = vi.fn().mockResolvedValue(undefined)
    toggleMemoryMock = vi.fn().mockResolvedValue(undefined)
    useUiStore.setState({
      memories,
      settings: { autoMemory: true } as unknown as Settings,
      restoreMemory: restoreMemoryMock,
      toggleMemory: toggleMemoryMock,
      deleteMemory: vi.fn().mockResolvedValue(undefined),
      saveMemory: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn(),
    } as unknown as UiStatePatch)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }

  async function mount() {
    await act(async () => {
      root.render(<MemorySheet onClose={() => {}} />)
    })
  }

  async function click(el: Element) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  beforeEach(() => {
    setCurrentLang('zh')
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('归档组折叠头置底且默认折叠：归档内容不可见，活跃记忆正常渲染带开关', async () => {
    render([ACTIVE, ARCHIVED])
    await mount()
    expect(container.textContent).toContain('喜欢美式咖啡')
    expect(container.textContent).toContain('已归档（1）')
    expect(container.textContent).not.toContain('正在准备 7 月考试')
    // switch = 自动记忆总开关 1 + 活跃行启停 1；归档行折叠中不渲染
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2)
  })

  it('展开归档组：归档条目可见，无启停开关，有「恢复」按钮', async () => {
    render([ACTIVE, ARCHIVED])
    await mount()
    const header = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('已归档'),
    )!
    await click(header)
    expect(container.textContent).toContain('正在准备 7 月考试')
    // 展开后 switch 数不变（归档行无启停开关）
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2)
    const restoreBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === '恢复',
    )
    expect(restoreBtn).toBeTruthy()
  })

  it('点「恢复」回调 restoreMemory(id)', async () => {
    render([ACTIVE, ARCHIVED])
    await mount()
    const header = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('已归档'),
    )!
    await click(header)
    const restoreBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === '恢复',
    )!
    await click(restoreBtn)
    expect(restoreMemoryMock).toHaveBeenCalledWith('r1')
  })

  it('无归档记忆时不渲染归档组', async () => {
    render([ACTIVE])
    await mount()
    expect(container.textContent).not.toContain('已归档')
  })
})
