import { useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValue, animate, useReducedMotion, type PanInfo } from 'framer-motion'
import { cn } from './cn'
import { haptic, type HapticStyle } from '@/ui/lib/haptics'

// 列表项横向滑卡：左/右滑露出操作钮。遵循 NN/g contextual swipe 六则——
// 滑动时内容保持可见（只平移不消失）、破坏性操作用危险色且以「滑出→点按」两段确认、
// 全 app 语义一致、不与导航手势冲突（dragDirectionLock）、操作钮保留为可聚焦 button（无 signifier 兜底）。
export type SwipeAction = {
  key: string
  label: string
  icon?: ReactNode
  /** 底色 class（如 'bg-catFail' 危险 / 'bg-pri' 主色 / 'bg-t3' 中性）。 */
  color: string
  /** 触发触感档位，默认 light；破坏性建议 warning/error。 */
  hapticStyle?: HapticStyle
  onAction: () => void | Promise<void>
}

type SwipeableCardProps = {
  /** 内容右滑（手指→）时，左缘露出的操作。 */
  leftActions?: SwipeAction[]
  /** 内容左滑（手指←）时，右缘露出的操作。 */
  rightActions?: SwipeAction[]
  children: ReactNode
  className?: string
  /** 内容点按（仅在未展开时触发）。 */
  onClick?: () => void
}

const ACTION_W = 76
const OPEN_RATIO = 0.4
const VELOCITY_OPEN = 500

export function SwipeableCard({
  leftActions = [],
  rightActions = [],
  children,
  className,
  onClick,
}: SwipeableCardProps) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const [openX, setOpenX] = useState(0) // 当前展开停驻位：0 | leftW | -rightW
  const dragging = useRef(false)

  const leftW = leftActions.length * ACTION_W
  const rightW = rightActions.length * ACTION_W

  const snapTo = (target: number) => {
    setOpenX(target)
    animate(
      x,
      target,
      reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 },
    )
  }

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    dragging.current = false
    const off = info.offset.x
    const vel = info.velocity.x
    if (off < 0) {
      // 左滑 → 展开右侧操作
      if (rightW === 0) return snapTo(0)
      if (off <= -rightW * OPEN_RATIO || vel < -VELOCITY_OPEN) {
        haptic('selection')
        snapTo(-rightW)
      } else snapTo(0)
    } else if (off > 0) {
      // 右滑 → 展开左侧操作
      if (leftW === 0) return snapTo(0)
      if (off >= leftW * OPEN_RATIO || vel > VELOCITY_OPEN) {
        haptic('selection')
        snapTo(leftW)
      } else snapTo(0)
    } else {
      snapTo(openX)
    }
  }

  const handleTap = () => {
    if (dragging.current) return
    if (openX !== 0) snapTo(0)
    else onClick?.()
  }

  const runAction = (a: SwipeAction) => {
    haptic(a.hapticStyle ?? 'light')
    snapTo(0)
    void a.onAction()
  }

  return (
    <div className={cn('relative overflow-hidden rounded-card', className)}>
      {leftW > 0 && (
        <div className="absolute inset-y-0 left-0 flex" style={{ width: leftW }} aria-hidden={openX <= 0}>
          {leftActions.map((a) => (
            <ActionButton key={a.key} action={a} edge="left" onTap={() => runAction(a)} />
          ))}
        </div>
      )}
      {rightW > 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: rightW }} aria-hidden={openX >= 0}>
          {rightActions.map((a) => (
            <ActionButton key={a.key} action={a} edge="right" onTap={() => runAction(a)} />
          ))}
        </div>
      )}
      <motion.div
        className="relative bg-card"
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -rightW, right: leftW }}
        dragElastic={{ left: 0.05, right: 0.05 }}
        dragMomentum={false}
        onDragStart={() => {
          dragging.current = true
        }}
        onDragEnd={handleDragEnd}
        onTap={handleTap}
      >
        {children}
      </motion.div>
    </div>
  )
}

function ActionButton({
  action,
  edge,
  onTap,
}: {
  action: SwipeAction
  edge: 'left' | 'right'
  onTap: () => void
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={action.label}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 text-white transition duration-base ease-out active:brightness-90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset',
        action.color,
        edge === 'left' ? 'rounded-l-card' : 'rounded-r-card',
      )}
    >
      {action.icon}
      <span className="text-[11px] font-medium leading-none">{action.label}</span>
    </button>
  )
}
