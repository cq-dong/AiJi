import { useT } from '@/app/i18n/useT'
import { cn } from './cn'

interface SpinnerProps {
  size?: number
  className?: string
}

export function Spinner({ size = 20, className }: SpinnerProps) {
  const t = useT()
  return (
    <span
      className={cn('inline-block animate-spin rounded-full border-2 border-pri/25 border-t-pri', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label={t('common.loading')}
    />
  )
}
