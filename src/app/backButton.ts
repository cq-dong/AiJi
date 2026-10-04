// A1 ②（2026-10-05）· Android 硬件返回键编排。契约：docs/acceptance/a1-android-shell.md §范围②。
// main.tsx 启动早期调 initBackButton() 一次（native-only，web 零行为直接 return）。
//
// cb 三层策略（顺序钉死）：
//   1. 栈非空 → pop 栈顶执行（LIFO——后开先收）→ return。
//   2. window.location.pathname !== '/' → window.history.back() → return。
//   3. 首页：双击退出——首按 armed=true 起 2s 定时器（窗外自动复位 false）；
//      窗内再按 → clearTimeout + 复位 armed + App.exitApp()。
//
// 栈语义为什么用 LIFO 数组而不用 CustomEvent/preventDefault：
// 多 sheet 并存（如 ReminderCreator 嵌在 CategoryEditSheet 上、feedback Sheet 压在
// settings 上）时，CustomEvent 的分发顺序依赖注册时序与 stopImmediatePropagation，
// 不确定性高；数组栈的 push/pop 是确定性 LIFO——Sheet 每个实例挂载即 push 自己的
// dismiss、卸载即调返回的 unregister（由 a1-ui 的 Sheet.tsx 消费），栈顶永远是
// 「最后挂载的那个 sheet」，符合用户「返回 = 收最上层面板」的直觉。

import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useUiStore } from '@/app/store'

// 模块级 LIFO 栈：UI overlay（Sheet 等）注册关闭回调。元素类型 `() => void`——
// 同步执行，回调内部自行处理异步（如 dismiss 动画）。
const stack: Array<() => void> = []

// 首页双击退出武装定时器：2s 内未再按则复位 exitArmed=false。重复武装前先 clearTimeout
// （防止「首按-首按-再按」的边界序列里旧定时器提前复位新武装窗）。
let exitTimer: ReturnType<typeof setTimeout> | null = null

function clearExitTimer(): void {
  if (exitTimer !== null) {
    clearTimeout(exitTimer)
    exitTimer = null
  }
}

// 注册返回键 handler；返回 unregister（重复调幂等）。
// Sheet 等 overlay 在挂载 effect 里 push、dismiss/unmount cleanup 里 unregister。
export function pushBackHandler(fn: () => void): () => void {
  stack.push(fn)
  let active = true
  return () => {
    if (!active) return // 幂等：第二次及以后 no-op
    active = false
    const idx = stack.indexOf(fn)
    if (idx !== -1) stack.splice(idx, 1)
  }
}

export function initBackButton(): void {
  // web 零行为：浏览器返回键由 history/路由管理；本编排只对原生壳生效。
  if (!Capacitor.isNativePlatform()) return
  void App.addListener('backButton', () => {
    // 1. overlay 栈顶优先（LIFO——后开先收）
    const top = stack.pop()
    if (top) {
      top()
      return
    }
    // 2. 非首页 → history 回退（react-router 走 popstate）
    if (window.location.pathname !== '/') {
      window.history.back()
      return
    }
    // 3. 首页：双击退出
    if (!useUiStore.getState().exitArmed) {
      // 首按：武装 + 起 2s 复位定时器。重复武装先 clearTimeout（新窗替换旧窗）。
      useUiStore.setState({ exitArmed: true })
      clearExitTimer()
      exitTimer = setTimeout(() => {
        exitTimer = null
        // 2s 窗过去仍 armed → 复位（用户放弃双击）
        if (useUiStore.getState().exitArmed) useUiStore.setState({ exitArmed: false })
      }, 2000)
      return
    }
    // 2s 窗内第二按 → 退出。复位 armed（状态机闭环；测试环境 exitApp 被 mock 不真退出）。
    clearExitTimer()
    useUiStore.setState({ exitArmed: false })
    void App.exitApp()
  })
}
