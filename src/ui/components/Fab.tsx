import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, GalleryThumbnails, Mic, Type } from 'lucide-react'
import { useT } from '@/app/i18n/useT'
import { haptic } from '@/ui/lib/haptics'
import type { I18nKey } from '@/app/i18n'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

// Batch 8（调研 #18）：点按=进 /capture（原行为）；长按 500ms（10px 容差，与
// CategoryCard 同律）= 四模态快捷菜单，直达 /capture?mode=x 免到屏再点。
// 菜单项与 capture CaptureToolbar 同序同 icon（voice 主位）。
const ACTIONS: { mode: 'voice' | 'text' | 'camera' | 'gallery'; icon: typeof Mic; labelKey: I18nKey }[] = [
  { mode: 'voice', icon: Mic, labelKey: 'capture.tool.voice' },
  { mode: 'text', icon: Type, labelKey: 'capture.tool.text' },
  { mode: 'camera', icon: Camera, labelKey: 'capture.tool.camera' },
  { mode: 'gallery', icon: GalleryThumbnails, labelKey: 'capture.tool.gallery' },
]

export function Fab() {
  const navigate = useNavigate()
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  useEffect(() => () => clearTimer(), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    startPosRef.current = { x: e.clientX, y: e.clientY }
    clearTimer()
    timerRef.current = setTimeout(() => {
      suppressClickRef.current = true
      haptic('medium')
      setMenuOpen(true)
    }, LONG_PRESS_MS)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = startPosRef.current
    if (!start || timerRef.current === null) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) clearTimer()
  }
  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    navigate('/capture')
  }
  const pick = (mode: (typeof ACTIONS)[number]['mode']) => {
    haptic('light')
    setMenuOpen(false)
    navigate(`/capture?mode=${mode}`)
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearTimer}
        onPointerCancel={clearTimer}
        onPointerLeave={clearTimer}
        aria-label={t('comp.fab.startCapture')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // D1: FAB 上移安全区高度，避免被系统导航栏遮挡。Android WebView 不支持 env()，
        // --safe-bottom 由 MainActivity 原生注入；PWA fallback 0 → 退化为 93px。
        style={{ bottom: 'calc(93px + var(--safe-bottom, 0px))' }}
        className="absolute right-5 z-30 flex h-14 w-14 items-center justify-center rounded-fab bg-gradient-to-b from-pri to-pri/85 text-card shadow-glowPri transition-all duration-base ease-out hover:brightness-[1.06] active:scale-90 active:shadow-glowPriSm"
      >
        <Mic size={26} strokeWidth={2.2} />
      </button>

      <AnimatePresence>
        {menuOpen && (
          <>
            {/* 透明遮罩：点任意处收菜单（不遮暗——快捷菜单是轻量层） */}
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <motion.ul
              role="menu"
              aria-label={t('comp.fab.startCapture')}
              initial={{ opacity: 0, y: 10, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.95, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              style={{ bottom: 'calc(155px + var(--safe-bottom, 0px))', transformOrigin: 'bottom right' }}
              className="absolute right-5 z-50 flex w-[168px] flex-col gap-0.5 rounded-card border border-brd/80 bg-card p-1.5 shadow-sheet"
            >
              {ACTIONS.map((a, i) => (
                <motion.li
                  key={a.mode}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 * i + 0.04, duration: 0.16, ease: 'easeOut' }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => pick(a.mode)}
                    className="flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-chip px-3 text-left text-[13px] font-medium text-ink transition duration-base ease-out hover:bg-page active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40"
                  >
                    <span className={`flex size-7 items-center justify-center rounded-full ${a.mode === 'voice' ? 'bg-pri text-white' : 'bg-priS text-pri'}`}>
                      <a.icon size={15} strokeWidth={2.2} />
                    </span>
                    {t(a.labelKey)}
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
