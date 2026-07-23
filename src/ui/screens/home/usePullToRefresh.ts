import { useEffect, useRef, useState } from 'react'
import { animate, useMotionValue, useReducedMotion, type MotionValue } from 'framer-motion'

// 下拉刷新 hook（移动端 PWA 标准 PTR 模式）：
// - 非 passive touch 监听挂在内容根节点；仅当滚动容器（最近的 <main>）scrollTop<=0
//   且手势向下时接管（preventDefault 阻断原生滚动/橡皮筋），阻尼 0.5、封顶 120px。
// - 松手 ≥64px → refreshing：指示器停驻 48px，跑 onRefresh（至少展示 600ms 防闪烁），
//   完成后 spring 收 0；不足阈值直接回弹。
// - 与 SwipeableCard 共存：dragDirectionLock 下纵向手势本就不触发横滑，PTR 接管后
//   卡片 drag 收 pointercancel 自然取消。reduced-motion 时回弹/停驻瞬切。
const THRESHOLD = 64
const HOLD = 48
const DAMPING = 0.5
const MAX_PULL = 120
const MIN_SHOW_MS = 600

export function usePullToRefresh(onRefresh: () => Promise<void>): {
  ref: React.RefObject<HTMLDivElement | null>
  pull: MotionValue<number>
  refreshing: boolean
} {
  const ref = useRef<HTMLDivElement>(null)
  const pull = useMotionValue(0)
  const [refreshing, setRefreshing] = useState(false)
  const reduce = useReducedMotion()
  // 手势状态放 ref，避免重渲建 listener。
  const gesture = useRef({ startY: 0, armed: false })
  const refreshingRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const scroller = el.closest('main')
    if (!scroller) return

    const snapTo = (target: number) => {
      animate(
        pull,
        target,
        reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 40 },
      )
    }

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return
      gesture.current.armed = scroller.scrollTop <= 0
      gesture.current.startY = e.touches[0]?.clientY ?? 0
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!gesture.current.armed || refreshingRef.current) return
      const y = e.touches[0]?.clientY ?? 0
      const dy = y - gesture.current.startY
      if (dy <= 0) {
        // 向上滑（正常滚动）：放行一次后解除武装，后续不再拦截本手势。
        gesture.current.armed = false
        pull.set(0)
        return
      }
      // 顶部下拉：接管滚动。非 passive listener 才能 preventDefault。
      e.preventDefault()
      pull.set(Math.min(dy * DAMPING, MAX_PULL))
    }

    const onTouchEnd = () => {
      if (!gesture.current.armed || refreshingRef.current) return
      gesture.current.armed = false
      if (pull.get() >= THRESHOLD) {
        refreshingRef.current = true
        setRefreshing(true)
        snapTo(HOLD)
        const started = Date.now()
        void onRefresh()
          .catch(() => {})
          .finally(() => {
            const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - started))
            window.setTimeout(() => {
              refreshingRef.current = false
              setRefreshing(false)
              snapTo(0)
            }, wait)
          })
      } else {
        snapTo(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [pull, reduce, onRefresh])

  return { ref, pull, refreshing }
}
