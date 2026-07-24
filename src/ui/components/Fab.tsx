import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, GalleryThumbnails, Mic, Type } from 'lucide-react'
import { useT } from '@/app/i18n/useT'
import { haptic } from '@/ui/lib/haptics'
import type { I18nKey } from '@/app/i18n'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10 // 超阈取消长按 = 进入拖拽判定（与 tap / long-press 三态互斥）
const FAB_SIZE = 56 // h-14 w-14
const FAB_HALF = FAB_SIZE / 2
const NAV_H = 79 // NavBottom 高（夹取下界，防 FAB 拖进底栏）
const TOPBAR_H = 40 // 顶栏高（夹取上界，防 FAB 拖进搜索/AI 区）
const MENU_W = 168
const MENU_GAP = 8
const POS_KEY = 'aiji:fab-pos' // 拖拽位置持久化（FAB 中心，frame 坐标系）

// Batch 8（调研 #18）：点按=进 /capture（原行为）；长按 500ms（10px 容差）= 四模态快捷菜单，
// 直达 /capture?mode=x 免到屏再点。菜单项与 capture CaptureToolbar 同序同 icon（voice 主位）。
// 可拖拽：超 10px 容差即转拖拽（取消长按 timer，与菜单互斥），松手持久化位置到 localStorage，
// 旋转/resize 自动夹取防飘屏。菜单锚点跟随 FAB 并按象限自动翻转。
const ACTIONS: { mode: 'voice' | 'text' | 'camera' | 'gallery'; icon: typeof Mic; labelKey: I18nKey }[] = [
  { mode: 'voice', icon: Mic, labelKey: 'capture.tool.voice' },
  { mode: 'text', icon: Type, labelKey: 'capture.tool.text' },
  { mode: 'camera', icon: Camera, labelKey: 'capture.tool.camera' },
  { mode: 'gallery', icon: GalleryThumbnails, labelKey: 'capture.tool.gallery' },
]

type Pos = { x: number; y: number } // FAB 中心，frame 坐标系（px）

function readVar(el: Element | null, name: string): number {
  if (!el || typeof window === 'undefined') return 0
  const n = parseFloat(getComputedStyle(el).getPropertyValue(name).trim())
  return Number.isFinite(n) ? n : 0
}

// 夹取到可视区：x ∈ [HALF, W-HALF]，y ∈ [safeTop+顶栏+HALF, H-底栏-safeBottom-HALF]。
// 极小屏 maxY 可能 < minY → 退化为 minY（贴顶），不溢出。
function clampPos(p: Pos, frame: DOMRect, safeTop: number, safeBottom: number): Pos {
  const minX = FAB_HALF
  const maxX = Math.max(FAB_HALF, frame.width - FAB_HALF)
  const minY = safeTop + TOPBAR_H + FAB_HALF
  const maxY = Math.max(minY, frame.height - NAV_H - safeBottom - FAB_HALF)
  return {
    x: Math.min(maxX, Math.max(minX, p.x)),
    y: Math.min(maxY, Math.max(minY, p.y)),
  }
}

// 默认位：视觉等同原 right-5(20px) + bottom 93(+safeBottom)，再过一遍夹取。
function defaultPos(frame: DOMRect, safeTop: number, safeBottom: number): Pos {
  return clampPos(
    { x: frame.width - 20 - FAB_HALF, y: frame.height - (93 + safeBottom) - FAB_HALF },
    frame,
    safeTop,
    safeBottom,
  )
}

export function Fab() {
  const navigate = useNavigate()
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const [dragging, setDragging] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startClientRef = useRef<{ x: number; y: number } | null>(null)
  const dragStartCenterRef = useRef<Pos | null>(null)
  const draggingRef = useRef(false)
  const suppressClickRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)

  // 初始化定位（useLayoutEffect 防闪）：读保存位置或默认，按当前 frame 夹取。
  // 视口变化（旋转 / resize / desktop 缩放）→ 重新夹取，防 FAB 飘出屏。
  useLayoutEffect(() => {
    const frame = btnRef.current?.closest('.aji-frame') as HTMLElement | null
    if (!frame) return
    const apply = () => {
      const r = frame.getBoundingClientRect()
      if (r.width === 0) return
      const sTop = readVar(frame, '--safe-top')
      const sBot = readVar(frame, '--safe-bottom')
      let saved: Pos | null = null
      try {
        const raw = localStorage.getItem(POS_KEY)
        if (raw) saved = JSON.parse(raw) as Pos
      } catch {
        saved = null
      }
      setPos(saved ? clampPos(saved, r, sTop, sBot) : defaultPos(r, sTop, sBot))
    }
    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [])

  useEffect(() => () => clearTimer(), [])

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    startClientRef.current = { x: e.clientX, y: e.clientY }
    draggingRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      if (draggingRef.current) return // 已转拖拽，不触发菜单（三态互斥）
      suppressClickRef.current = true
      haptic('medium')
      setMenuOpen(true)
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = startClientRef.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (!draggingRef.current) {
      // 未进入拖拽：超容差即取消长按 timer、转拖拽（菜单已开则不转，避免长按后误拖）
      if (dx * dx + dy * dy <= MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) return
      if (menuOpen) return
      clearTimer()
      draggingRef.current = true
      setDragging(true)
      haptic('light')
      dragStartCenterRef.current = pos ? { ...pos } : null
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
        pointerIdRef.current = e.pointerId
      } catch {
        // 捕获失败不致命——只是边缘指针可能丢失，夹取仍保安全
      }
      return
    }
    // 拖拽中：按增量更新中心，夹取到 frame（delta 法无需 frame 原点，只取尺寸做边界）
    const base = dragStartCenterRef.current
    if (!base) return
    const frame = btnRef.current?.closest('.aji-frame') as HTMLElement | null
    if (!frame) return
    const r = frame.getBoundingClientRect()
    setPos(clampPos({ x: base.x + dx, y: base.y + dy }, r, readVar(frame, '--safe-top'), readVar(frame, '--safe-bottom')))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    clearTimer()
    const wasDragging = draggingRef.current
    draggingRef.current = false
    setDragging(false)
    startClientRef.current = null
    if (pointerIdRef.current !== null) {
      try {
        e.currentTarget.releasePointerCapture(pointerIdRef.current)
      } catch {
        // 释放失败忽略
      }
      pointerIdRef.current = null
    }
    if (wasDragging) {
      // 拖拽结束：持久化位置 + 吞掉随后冒泡的 click（不进 /capture）
      suppressClickRef.current = true
      setPos((p) => {
        if (p) {
          try {
            localStorage.setItem(POS_KEY, JSON.stringify(p))
          } catch {
            // 配额/隐私模式写失败——位置本次会话仍生效，仅不持久化
          }
        }
        return p
      })
    }
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

  // 菜单锚点：跟随 FAB 中心，按所在象限自动翻转（上/下、左/右），夹取防溢出。
  const menuAnchor = (() => {
    if (!pos) return null
    const frame = btnRef.current?.closest('.aji-frame') as HTMLElement | null
    const r = frame?.getBoundingClientRect()
    if (!r) return null
    const upward = pos.y > r.height / 2
    const rightSide = pos.x > r.width / 2
    let left = rightSide ? pos.x + FAB_HALF - MENU_W : pos.x - FAB_HALF
    left = Math.min(r.width - MENU_W - 8, Math.max(8, left))
    const top = upward ? pos.y - FAB_HALF - MENU_GAP : pos.y + FAB_HALF + MENU_GAP
    const origin = upward
      ? rightSide
        ? 'bottom right'
        : 'bottom left'
      : rightSide
        ? 'top right'
        : 'top left'
    return { left, top, upward, origin }
  })()

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={clearTimer}
        aria-label={t('comp.fab.startCapture')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // pos 未就绪（首帧 measure 前）沿用原 right/bottom，防初始化闪移；就绪后切 left/top。
        // transition 仅含 box-shadow/filter/transform：拖拽时 left/top 即时跟随手指（无滞后），
        // scale/shadow 仍平滑。touch-none 阻止拖拽触发页面滚动/PTR。
        style={
          pos
            ? { left: pos.x - FAB_HALF, top: pos.y - FAB_HALF }
            : { right: 20, bottom: 'calc(93px + var(--safe-bottom, 0px))' }
        }
        className={[
          'absolute z-30 flex h-14 w-14 touch-none items-center justify-center rounded-fab bg-gradient-to-b from-pri to-pri/85 text-card shadow-glowPri transition-[box-shadow,filter,transform] duration-base ease-out hover:brightness-[1.06]',
          dragging
            ? 'scale-105 cursor-grabbing shadow-pop'
            : 'cursor-grab active:scale-90 active:shadow-glowPriSm',
        ].join(' ')}
      >
        <Mic size={26} strokeWidth={2.2} />
      </button>

      <AnimatePresence>
        {menuOpen && menuAnchor && (
          <>
            {/* 透明遮罩：点任意处收菜单（不遮暗——快捷菜单是轻量层） */}
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div
              className="absolute z-50"
              style={{
                left: menuAnchor.left,
                top: menuAnchor.top,
                transform: menuAnchor.upward ? 'translateY(-100%)' : 'none',
                transformOrigin: menuAnchor.origin,
              }}
            >
              <motion.ul
                role="menu"
                aria-label={t('comp.fab.startCapture')}
                initial={{ opacity: 0, y: 10, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.95, transition: { duration: 0.12 } }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="flex w-[168px] flex-col gap-0.5 rounded-card border border-brd/80 bg-card p-1.5 shadow-sheet"
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
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
