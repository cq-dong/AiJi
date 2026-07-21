import type { HTMLAttributes } from 'react'
import { cn } from './cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
}

export function Card({ className, padded = true, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-brd/80 bg-card shadow-card',
        padded && 'p-4',
        className,
      )}
      {...rest}
    />
  )
}
