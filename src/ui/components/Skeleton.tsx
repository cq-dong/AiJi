import { cn } from './cn'

interface SkeletonProps {
  className?: string
  rounded?: string
}

export function Skeleton({ className, rounded = 'rounded-card' }: SkeletonProps) {
  return <div className={cn('animate-pulse bg-t3/15', rounded, className)} />
}
