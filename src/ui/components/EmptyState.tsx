import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      {icon && <div className="text-t3">{icon}</div>}
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {subtitle && <p className="max-w-[260px] text-[12px] leading-relaxed text-t3">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
