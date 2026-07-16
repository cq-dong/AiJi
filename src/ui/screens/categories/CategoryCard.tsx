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
  catIdea: 'bg-catIdea',
  catProject: 'bg-catProject',
  catPending: 'bg-catPending',
  catFail: 'bg-catFail',
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
        'h-[140px] p-4 flex flex-col gap-2.5 transition select-none',
        onClick && 'cursor-pointer active:scale-[0.99]',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('size-3 rounded-full', dot)} />
        <span className="text-[15px] font-bold text-ink">{category.label}</span>
      </div>
      <p className="text-[12px] font-medium text-t3">{liveCount} 条</p>
      <p className="text-[12px] text-t2 line-clamp-1">{snippet || '——'}</p>
    </Card>
  )
}
