// A1（2026-10-05）AppShell 消费点：
// ① BareLayout main paddingBottom = max(--safe-bottom, --safe-ime)（键盘顶起时 in-flow
//    底部输入面不被遮；MainLayout 的 MAIN_BOTTOM_CLEARANCE 不动——主路由无底部输入面）。
// ② MainLayout + BareLayout 各挂退出 Toast：exitArmed=true 时渲染「再按一次退出」。
// 契约：docs/acceptance/a1-android-shell.md §范围①②。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// 重资产子组件不渲染——本测试只关心 main style + ExitToast；这些组件各自挂 di/store/
// Capacitor 初始化链，与本测试断言无关。
vi.mock('@/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/components')>()
  return {
    ...actual,
    Fab: () => null,
    NavBottom: () => null,
    Statusbar: () => null,
    ReminderPopup: () => null,
    FiringReminderPopup: () => null,
    // Toast 保留真实现——ExitToast 渲染链终点，断言靠它
  }
})
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import { BareLayout, MainLayout } from '@/ui/layout/AppShell'

let container: HTMLDivElement
let root: Root | null = null

async function renderShell(layout: 'main' | 'bare'): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const Layout = layout === 'main' ? MainLayout : BareLayout
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>screen content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  })
}

describe('AppShell A1 ①②', () => {
  beforeEach(() => {
    setCurrentLang('zh')
    useUiStore.setState({ exitArmed: false })
  })
  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount()
      })
      root = null
    }
    container?.remove()
    useUiStore.setState({ exitArmed: false })
  })

  it('① BareLayout main paddingBottom 含 max(var(--safe-bottom, --safe-ime)', async () => {
    await renderShell('bare')
    const main = container.querySelector('main') as HTMLElement | null
    expect(main, 'BareLayout 应渲染 <main>').toBeTruthy()
    expect(main!.style.paddingBottom).toContain('max(var(--safe-bottom')
    expect(main!.style.paddingBottom).toContain('var(--safe-ime')
  })

  it('② MainLayout exitArmed=true 渲染退出 Toast（role=status + zh 文案）', async () => {
    useUiStore.setState({ exitArmed: true })
    await renderShell('main')
    const toast = container.querySelector('[role="status"]') as HTMLElement | null
    expect(toast, 'exitArmed=true 时 MainLayout 应渲染 Toast').toBeTruthy()
    expect(toast!.textContent).toBe('再按一次退出')
  })

  it('② BareLayout exitArmed=true 渲染退出 Toast', async () => {
    useUiStore.setState({ exitArmed: true })
    await renderShell('bare')
    const toast = container.querySelector('[role="status"]') as HTMLElement | null
    expect(toast).toBeTruthy()
    expect(toast!.textContent).toBe('再按一次退出')
  })

  it('② exitArmed=false 时两 layout 均不渲染 Toast', async () => {
    await renderShell('main')
    expect(container.querySelector('[role="status"]')).toBeNull()
    await act(async () => {
      root!.unmount()
    })
    root = null
    container.remove()
    await renderShell('bare')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('② Toast onDismiss 把 exitArmed 复位为 false（UI 消失）', async () => {
    useUiStore.setState({ exitArmed: true })
    await renderShell('main')
    expect(container.querySelector('[role="status"]')).toBeTruthy()
    await act(async () => {
      useUiStore.setState({ exitArmed: false })
    })
    // AnimatePresence 退出动画 0.18s——等真实卸载（exit 完成才从 DOM 移除）
    await vi.waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull(), { timeout: 1000 })
  })
})
