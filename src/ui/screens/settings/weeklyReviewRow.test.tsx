// P-F（2026-10-04）设置页「AI」组周回顾开关行：
// 渲染 label + hint + Toggle（undefined 视同开 / 显式关回显 aria-checked=false）；
// 拨动 → setSettings({ weeklyReviewEnabled: next })。镜像 autoMemory 行语义。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Settings } from '@/domain/types'

// 最小 di mock（store import 需要）；重适配器模块瘦身，避免无关模块副作用。
vi.mock('@/app/di', () => ({
  di: {
    llm: {},
    storage: {},
  },
}))
vi.mock('@/adapters/dexieStorage', () => ({ importSampleData: vi.fn() }))
vi.mock('@/adapters/zipExport', () => ({ exportZip: vi.fn() }))
vi.mock('@/adapters/fileShare', () => ({ canShareFiles: () => false, saveBlob: vi.fn() }))
vi.mock('@/app/syncEngine', () => ({ maybeStartSync: vi.fn(), stopSync: vi.fn(), syncNow: vi.fn() }))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
// vite define 常量（关于区版本号）——vitest 无 define 注入，全局兜底。
;(globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0-test'

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import SettingsScreen from '@/ui/screens/settings'

type UiStatePatch = Parameters<typeof useUiStore.setState>[0]

describe('设置页 · 周回顾开关行', () => {
  let container: HTMLDivElement
  let root: Root
  let setSettingsMock: ReturnType<typeof vi.fn>

  async function render(settings: Partial<Settings>) {
    setSettingsMock = vi.fn()
    useUiStore.setState({
      settings: { language: 'zh', theme: 'system', ...settings } as unknown as Settings,
      entries: [],
      memories: [],
      setSettings: setSettingsMock,
    } as unknown as UiStatePatch)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SettingsScreen />
        </MemoryRouter>,
      )
    })
  }

  // 定位「每周回顾」行内的 Toggle（设置页有多个 role=switch，须按行收窄）。
  function weeklyRowSwitch(): HTMLElement {
    const label = Array.from(container.querySelectorAll('span')).find((x) => x.textContent?.trim() === '每周回顾')
    expect(label, '应渲染「每周回顾」行标签').toBeTruthy()
    let el: HTMLElement | null = label as HTMLElement
    while (el && !el.querySelector('[role="switch"]')) el = el.parentElement
    const sw = el?.querySelector('[role="switch"]')
    expect(sw, '「每周回顾」行内应有 Toggle').toBeTruthy()
    return sw as HTMLElement
  }

  async function click(el: Element) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  beforeEach(() => {
    setCurrentLang('zh') // 文案断言钉死中文
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('渲染 label + hint；weeklyReviewEnabled 缺省 → 开关为开', async () => {
    await render({})
    expect(container.textContent).toContain('每周回顾')
    expect(container.textContent).toContain('自动汇总上周记录，首页卡片提醒你查看')
    expect(weeklyRowSwitch().getAttribute('aria-checked')).toBe('true')
  })

  it('weeklyReviewEnabled === false → 开关回显为关', async () => {
    await render({ weeklyReviewEnabled: false })
    expect(weeklyRowSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('开 → 拨动：setSettings({ weeklyReviewEnabled: false })', async () => {
    await render({})
    await click(weeklyRowSwitch())
    expect(setSettingsMock).toHaveBeenCalledWith({ weeklyReviewEnabled: false })
  })

  it('关 → 拨动：setSettings({ weeklyReviewEnabled: true })', async () => {
    await render({ weeklyReviewEnabled: false })
    await click(weeklyRowSwitch())
    expect(setSettingsMock).toHaveBeenCalledWith({ weeklyReviewEnabled: true })
  })
})
