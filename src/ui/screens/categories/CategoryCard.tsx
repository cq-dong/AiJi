import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Category } from '@/domain/types'
import { Card, cn } from '@/ui/components'

interface CategoryCardProps {
  category: Category
  snippet: string
  liveCount: number
  onClick?: () => void
  onLongPress?: () => void
}

const DOT: Record<NonNullable<Category['accent']>, string> = {
  catIdea: 'from-catIdea to-catIdea/60 ring-catIdea/25',
  catProject: 'from-catProject to-catProject/60 ring-catProject/25',
  catPending: 'from-catPending to-catPending/60 ring-catPending/25',
  catFail: 'from-catFail to-catFail/60 ring-catFail/25',
}

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

// Per Figma 5:2 — a small accent dot (not a bar) sits beside the label.
// Tap → drill into category (onClick); long-press → edit sheet (onLongPress).
export function CategoryCard({ category, snippet, liveCount, onClick, onLongPress }: CategoryCardProps) {
  const dot = category.accent ? DOT[category.accent] : 'bg-catIdea'
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

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    startPosRef.current = { x: e.clientX, y: e.clientY }
    if (!onLongPress) return
    clearTimer()
    timerRef.current = setTimeout(() => {
      suppressClickRef.current = true
      onLongPress()
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = startPosRef.current
    if (!start || timerRef.current === null) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) clearTimer()
  }

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onClick?.()
  }

  return (
    <Card
      padded={false}
      onClick={onClick || onLongPress ? handleClick : undefined}
      onPointerDown={handlePointerDown}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      onPointerMove={handlePointerMove}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'h-[140px] p-4 flex flex-col gap-2.5 transition-all duration-base ease-out select-none hover:border-t3/30 hover:shadow-cardHover focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        onClick && 'cursor-pointer active:scale-[0.98]',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('size-3.5 rounded-full bg-gradient-to-br ring-2 ring-offset-1 ring-offset-card', dot)} />
        <span className="text-[15px] font-bold text-ink">{category.label}</span>
      </div>
      <p className="text-[12px] font-medium text-t3">
        <span className="text-[13px] font-semibold tabular-nums text-t2">{liveCount}</span> 条
      </p>
      <p className="text-[12px] leading-snug text-t2 line-clamp-2">{snippet || '——'}</p>
    </Card>
  )
}
