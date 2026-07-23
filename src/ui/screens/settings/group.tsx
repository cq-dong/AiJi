// 设置页分组列表原语（iOS grouped-list 模式，对齐 design tokens）。
// SettingsGroup = 组标签 + 圆角卡片容器 + 可选页脚说明；
// SettingsRow = 组内统一行（图标盒 + 标题/副标题 + 右侧值/控件 + chevron）；
// RowDivider = 行间发丝分隔线（左侧缩进对齐标题文字，不切断图标列）。
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/ui/components'

export function SettingsGroup({
  label,
  footer,
  children,
}: {
  label: string
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-6">
      <p className="mb-2 px-1 text-[12px] font-semibold tracking-wide text-t3">{label}</p>
      <div className="overflow-hidden rounded-card border border-brd/80 bg-card shadow-card">
        {children}
      </div>
      {footer ? <div className="mt-2 px-1 text-[11px] leading-relaxed text-t3">{footer}</div> : null}
    </section>
  )
}

// 图标盒：28px 圆角方块，priS 底 pri 图标——全设置页统一视觉锚点。
export function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-priS text-pri">
      {children}
    </span>
  )
}

export function RowDivider() {
  // 16(px-4) + 28(icon) + 12(gap-3) = 56px，分隔线对齐标题起始。
  return <div aria-hidden className="ml-14 h-px bg-brd/80" />
}

export function SettingsRow({
  icon,
  label,
  help,
  value,
  onClick,
  right,
  disabled,
}: {
  icon: ReactNode
  label: ReactNode
  help?: ReactNode
  value?: ReactNode
  onClick?: () => void
  /** 右侧自定义控件（Toggle/输入框）。给了它行就不是 button。 */
  right?: ReactNode
  disabled?: boolean
}) {
  const body = (
    <>
      <RowIcon>{icon}</RowIcon>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">{label}</span>
        {help ? <span className="mt-0.5 block text-[11px] leading-snug text-t3">{help}</span> : null}
      </span>
      <span className="ml-3 flex shrink-0 items-center gap-1.5">
        {value ? <span className="max-w-[140px] truncate text-[12px] text-t3">{value}</span> : null}
        {right}
        {onClick && !right ? (
          <ChevronRight size={16} strokeWidth={2.2} className="text-t3" />
        ) : null}
      </span>
    </>
  )
  const cls = cn(
    'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-base ease-out',
    disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer active:bg-page/70',
  )
  if (onClick && !right) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          cls,
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pri/40',
        )}
      >
        {body}
      </button>
    )
  }
  return <div className={cn(cls, disabled && 'cursor-default')}>{body}</div>
}
