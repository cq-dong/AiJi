import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useUiStore } from '@/app/store'

// 开屏 overlay（JS 整图层）：冷启动时系统 splash（Android 12+ 强制居中图标+背景色，
// 见 styles.xml AppTheme.NoActionBarLaunch）短暂顶住白屏；WebView 首帧加载后，此 overlay
// 全屏显示 splash.webp 整图，待 store hydrated（下方路由/gate 已就绪）+ 最小显示 1000ms 后
// 淡出，露出已稳定的 onboarding / login / home。跨 Android 版本统一显示用户设计的整图。
//
// 为什么不在 native 层显示整图：Android 12+ SplashScreen API 强制只支持居中 icon + 背景色，
// 不支持全屏整图；JS overlay 接在系统 splash 之后是唯一能全屏显示整图的跨版本方案。
const MIN_SHOW_MS = 1000
const FADE_MS = 320

export function SplashOverlay() {
  const hydrated = useUiStore((s) => s.hydrated)
  const reduce = useReducedMotion()
  const [visible, setVisible] = useState(true)
  // 挂载时刻（ms）—— 计算已显示时长，保证最小显示，防 hydrate 过快导致整图一闪而过。
  const startRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!hydrated) return
    const elapsed = Date.now() - startRef.current
    const remain = Math.max(0, MIN_SHOW_MS - elapsed)
    const id = setTimeout(() => setVisible(false), remain)
    return () => clearTimeout(id)
  }, [hydrated])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden
          // fixed 全屏盖在路由树之上（NavBottom z-20 / Fab z-30 / Sheet z-40-50，100 全盖）。
          // splash.webp 为 9:16 整图，cover 铺满 9:16 视口不裁；非 9:16 屏 cover 居中裁边。
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: FADE_MS / 1000, ease: 'easeOut' }}
          className="fixed inset-0 z-[100] bg-page"
          style={{
            backgroundImage: 'url(/splash.webp)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}
    </AnimatePresence>
  )
}
