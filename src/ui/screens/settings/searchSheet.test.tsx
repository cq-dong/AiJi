import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Settings } from '@/domain/types'

// SearchSheet（2026-09-29 能力大补）：Tavily BYOK Key 配置弹层。
// 镜像 GeocodingSheet 行为：未配显 placeholder、已配显「留空不变」、保存 trim、空串=清除。

// 最小 di mock（store import 需要；本测试不触发存储调用）
vi.mock('@/app/di', () => ({
  di: {
    llm: {},
    storage: {},
  },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import { SearchSheet } from '@/ui/screens/settings/SearchSheet'

type UiStatePatch = Parameters<typeof useUiStore.setState>[0]

describe('SearchSheet 网络搜索 Key 配置', () => {
  let container: HTMLDivElement
  let root: Root
  let setSearchConfigMock: ReturnType<typeof vi.fn>
  let onCloseMock: ReturnType<typeof vi.fn>

  function render(searchKeyRef?: string) {
    setSearchConfigMock = vi.fn().mockResolvedValue(undefined)
    onCloseMock = vi.fn()
    useUiStore.setState({
      settings: { searchKeyRef } as unknown as Settings,
      setSearchConfig: setSearchConfigMock,
    } as unknown as UiStatePatch)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }

  async function mount() {
    await act(async () => {
      root.render(<SearchSheet onClose={onCloseMock} />)
    })
  }

  async function click(el: Element) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  function buttonByText(text: string): HTMLButtonElement {
    const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.trim() === text)
    expect(b, `应存在按钮「${text}」`).toBeTruthy()
    return b!
  }

  function keyInput(): HTMLInputElement {
    const el = container.querySelector<HTMLInputElement>('input[type="password"]')
    expect(el).toBeTruthy()
    return el!
  }

  async function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
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

  it('未配置：渲染标题/说明/输入框 placeholder', async () => {
    render(undefined)
    await mount()
    expect(container.textContent).toContain('网络搜索')
    expect(container.textContent).toContain('Tavily Key')
    expect(keyInput().placeholder).toContain('tvly-')
  })

  it('已配置：label 带「已设置，留空不变」，placeholder 为保持提示', async () => {
    render('search:key')
    await mount()
    expect(container.textContent).toContain('已设置，留空不变')
    expect(keyInput().placeholder).toContain('留空保持不变')
  })

  it('保存：trim 后调用 setSearchConfig 并关闭', async () => {
    render(undefined)
    await mount()
    await typeInto(keyInput(), '  tvly-abc-123  ')
    await click(buttonByText('保存'))
    expect(setSearchConfigMock).toHaveBeenCalledWith('tvly-abc-123')
    expect(onCloseMock).toHaveBeenCalled()
  })

  it('空串保存 = 清除（D8 语义）', async () => {
    render('search:key')
    await mount()
    await click(buttonByText('保存'))
    expect(setSearchConfigMock).toHaveBeenCalledWith('')
    expect(onCloseMock).toHaveBeenCalled()
  })

  it('取消：不调 setSearchConfig，仅关闭', async () => {
    render(undefined)
    await mount()
    await click(buttonByText('取消'))
    expect(setSearchConfigMock).not.toHaveBeenCalled()
    expect(onCloseMock).toHaveBeenCalled()
  })
})
