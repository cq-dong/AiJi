import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center animate-fade-in-up">
      {icon && <div className="text-t3 drop-shadow-sm">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {subtitle && <p className="max-w-[260px] text-[12px] leading-relaxed text-t3">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
