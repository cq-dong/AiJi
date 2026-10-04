// PWA Share Target 接收页（契约 docs/acceptance/prd-trust-pack.md §范围②/t2 段）：
// - composeSharedText：title/text/url 三参有值按行拼接、filter 空值、trim。
// - 屏：/share-target?text&url 非空 → addPart 追加 text part（不覆盖在写草稿）→
//   replace 跳 /capture；空参数 → EmptyState + 回首页按钮。
// di mock 镜像 settings/categories 既有测试（store import 链需要，屏本身不碰 di）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/app/di', () => ({
  di: {
    llm: {},
    storage: {},
  },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import ShareTarget, { composeSharedText } from '@/ui/screens/shareTarget'
import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'

function resetCapture() {
  useUiStore.setState({
    capture: {
      parts: [],
      recording: false,
      saving: false,
      micDenied: false,
      finalized: '',
      interim: '',
    },
  })
}

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  setCurrentLang('zh')
  resetCapture()
  document.body.innerHTML = ''
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

async function renderAt(url: string) {
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/share-target" element={<ShareTarget />} />
          <Route path="/capture" element={<div>CAPTURE_PAGE</div>} />
          <Route path="/" element={<div>HOME_PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    )
  })
}

describe('composeSharedText', () => {
  it('三参齐全 → 按行拼接', () => {
    expect(composeSharedText('标题', '正文', 'https://x')).toBe('标题\n正文\nhttps://x')
  })

  it('单参/两参组合 → 跳过空位', () => {
    expect(composeSharedText(null, '正文', null)).toBe('正文')
    expect(composeSharedText('标题', null, 'https://x')).toBe('标题\nhttps://x')
    expect(composeSharedText(null, null, 'https://x')).toBe('https://x')
  })

  it('空字符串视同缺席（filter Boolean）', () => {
    expect(composeSharedText('', '正文', '')).toBe('正文')
  })

  it('全空 / 全空白 → 空串', () => {
    expect(composeSharedText(null, null, null)).toBe('')
    expect(composeSharedText(undefined, undefined, undefined)).toBe('')
    expect(composeSharedText('  ', '', null)).toBe('')
  })
})

describe('ShareTarget 屏', () => {
  it('text+url → 追加 text part（两行）且 replace 跳 /capture', async () => {
    await renderAt('/share-target?text=hello&url=https://x')
    expect(container.textContent).toContain('CAPTURE_PAGE')
    const parts = useUiStore.getState().capture.parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toEqual({ type: 'text', content: 'hello\nhttps://x' })
  })

  it('title+text+url → 三行全入草稿', async () => {
    await renderAt('/share-target?title=t1&text=hello&url=https://x')
    const parts = useUiStore.getState().capture.parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toEqual({ type: 'text', content: 't1\nhello\nhttps://x' })
  })

  it('追加语义：不覆盖在写草稿', async () => {
    useUiStore.getState().addPart({ type: 'text', content: '在写的内容' })
    await renderAt('/share-target?text=shared')
    const parts = useUiStore.getState().capture.parts
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: 'text', content: '在写的内容' })
    expect(parts[1]).toEqual({ type: 'text', content: 'shared' })
  })

  it('空参数 → 空态文案 + 不入草稿 + 不跳走', async () => {
    await renderAt('/share-target')
    expect(container.textContent).toContain('没有收到可记入的内容')
    expect(container.textContent).not.toContain('CAPTURE_PAGE')
    expect(useUiStore.getState().capture.parts).toHaveLength(0)
  })

  it('空态点「回首页」→ 导航到 /', async () => {
    await renderAt('/share-target')
    const btn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('回首页'),
    )
    expect(btn, '应有回首页按钮').toBeDefined()
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('HOME_PAGE')
  })
})
