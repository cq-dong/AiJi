import { cn } from './cn'

interface SkeletonProps {
  className?: string
  rounded?: string
}

export function Skeleton({ className, rounded = 'rounded-card' }: SkeletonProps) {
  return <div className={cn('animate-shimmer bg-gradient-to-r from-t3/10 via-t3/20 to-t3/10 bg-[length:200%_100%]', rounded, className)} />
}
