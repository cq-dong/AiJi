// A1 ②（2026-10-05）· 硬件返回键编排测试。契约：docs/acceptance/a1-android-shell.md §范围②。
// 三层策略（顺序钉死）：
//   1. 栈非空 → pop 栈顶执行（LIFO——后开先收）。
//   2. 非首页 → window.history.back()。
//   3. 首页 → 双击退出（首按 armed=true 起 2s 定时器；窗内再按 → exitApp；窗外再按 → 重新武装）。
// mock 双 Capacitor 包：core 的 isNativePlatform 可控；app 的 addListener 捕获 cb + exitApp spy。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// hoisted：mock 工厂函数引用——isNativePlatform 由用例逐条控制。
const mocks = vi.hoisted(() => ({
  isNative: true as boolean,
  addListener: vi.fn(),
  exitApp: vi.fn(),
  backCb: null as null | (() => void),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.isNative },
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (eventName: string, cb: () => void) => {
      mocks.addListener(eventName, cb)
      if (eventName === 'backButton') mocks.backCb = cb
      return Promise.resolve({ remove: () => Promise.resolve() })
    },
    exitApp: () => mocks.exitApp(),
  },
}))

// store import 需要 di 空壳——本模块只读写 useUiStore.exitArmed，不触 di 任何 port。
vi.mock('@/app/di', () => ({ di: {} }))

import { initBackButton, pushBackHandler } from '@/app/backButton'
import { useUiStore } from '@/app/store'

// 用例注册的 handler 统一收集——afterEach 全量 unregister，保证下一用例栈是空的（防串扰）。
const pendingUnregisters: Array<() => void> = []
function push(fn: () => void): () => void {
  const u = pushBackHandler(fn)
  pendingUnregisters.push(u)
  return u
}

function fireBack(): void {
  if (!mocks.backCb) throw new Error('backButton listener 未注册（initBackButton 未被调或平台守卫拦截）')
  mocks.backCb()
}

function setPath(path: string): void {
  window.history.pushState({}, '', path)
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.isNative = true
  mocks.backCb = null
  mocks.addListener.mockClear()
  mocks.exitApp.mockClear()
  useUiStore.setState({ exitArmed: false })
  setPath('/')
})

afterEach(() => {
  while (pendingUnregisters.length > 0) pendingUnregisters.pop()!()
  useUiStore.setState({ exitArmed: false })
  vi.useRealTimers()
})

describe('initBackButton · 平台守卫', () => {
  it('非 native 平台 → 不注册 backButton listener（web 零行为）', () => {
    mocks.isNative = false
    initBackButton()
    expect(mocks.addListener).not.toHaveBeenCalled()
    expect(mocks.backCb).toBeNull()
  })

  it('native 平台 → 注册 backButton listener', () => {
    mocks.isNative = true
    initBackButton()
    expect(mocks.addListener).toHaveBeenCalledTimes(1)
    expect(mocks.addListener).toHaveBeenCalledWith('backButton', expect.any(Function))
    expect(mocks.backCb).not.toBeNull()
  })
})

describe('backButton cb · 栈优先（LIFO）', () => {
  it('栈非空 → 一次 back 只弹栈顶（后注册者先弹）', () => {
    initBackButton()
    const calls: string[] = []
    push(() => calls.push('first'))
    push(() => calls.push('second'))
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    setPath('/settings') // 非首页——栈优先于路由回退

    fireBack()
    expect(calls).toEqual(['second'])
    expect(backSpy).not.toHaveBeenCalled()

    fireBack()
    expect(calls).toEqual(['second', 'first'])
    expect(backSpy).not.toHaveBeenCalled()

    backSpy.mockRestore()
  })

  it('unregister 后该 handler 不再被调（栈中剔除）', () => {
    initBackButton()
    const calls: string[] = []
    push(() => calls.push('a'))
    const unregisterB = push(() => calls.push('b'))
    unregisterB()
    setPath('/settings')

    fireBack()
    expect(calls).toEqual(['a'])
  })

  it('重复 unregister 幂等（第二次 no-op，不影响其他 handler）', () => {
    initBackButton()
    const calls: string[] = []
    const unregisterX = push(() => calls.push('x'))
    unregisterX()
    unregisterX() // 幂等
    push(() => calls.push('y'))
    setPath('/settings')

    fireBack()
    expect(calls).toEqual(['y'])
  })
})

describe('backButton cb · 路由回退', () => {
  it('栈空 + 非首页（/settings）→ window.history.back 被调', () => {
    initBackButton()
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    setPath('/settings')

    fireBack()
    expect(backSpy).toHaveBeenCalledTimes(1)
    backSpy.mockRestore()
  })

  it('栈空 + 非首页 → 不触 armed / 不调 exitApp', () => {
    initBackButton()
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    setPath('/settings')

    fireBack()
    expect(useUiStore.getState().exitArmed).toBe(false)
    expect(mocks.exitApp).not.toHaveBeenCalled()
    backSpy.mockRestore()
  })
})

describe('backButton cb · 首页双击退出', () => {
  it('首页首按 → exitArmed=true 且 exitApp 未调', () => {
    initBackButton()
    setPath('/')

    fireBack()
    expect(useUiStore.getState().exitArmed).toBe(true)
    expect(mocks.exitApp).not.toHaveBeenCalled()
  })

  it('首页 2s 窗内再按 → exitApp 被调一次', () => {
    initBackButton()
    setPath('/')

    fireBack()
    expect(useUiStore.getState().exitArmed).toBe(true)
    vi.advanceTimersByTime(500)
    fireBack()
    expect(mocks.exitApp).toHaveBeenCalledTimes(1)
  })

  it('首页首按 2s 后超时 → exitArmed 自动复位 false', () => {
    initBackButton()
    setPath('/')

    fireBack()
    expect(useUiStore.getState().exitArmed).toBe(true)
    vi.advanceTimersByTime(2100)
    expect(useUiStore.getState().exitArmed).toBe(false)
    expect(mocks.exitApp).not.toHaveBeenCalled()
  })

  it('双击退出后 2s 再按 → 重新武装且 exitApp 仍只调过一次', () => {
    initBackButton()
    setPath('/')

    fireBack() // 第一次：armed=true
    vi.advanceTimersByTime(500)
    fireBack() // 2s 内第二次：exitApp 调一次（同时复位 armed）
    expect(mocks.exitApp).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2100) // 越过 2s 窗
    fireBack() // 再按 → 重新武装，不再 exit
    expect(useUiStore.getState().exitArmed).toBe(true)
    expect(mocks.exitApp).toHaveBeenCalledTimes(1)
  })

  it('首页首按 → 再次首按（已超时复位）→ 再次首按 → 重新起 2s 定时器', () => {
    initBackButton()
    setPath('/')

    fireBack()
    vi.advanceTimersByTime(2100) // 超时复位
    fireBack() // 新一轮首按
    expect(useUiStore.getState().exitArmed).toBe(true)
    vi.advanceTimersByTime(500)
    fireBack() // 新窗内第二按 → exit
    expect(mocks.exitApp).toHaveBeenCalledTimes(1)
  })
})
