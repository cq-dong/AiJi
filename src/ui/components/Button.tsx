import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  // 主按钮：品牌发光影 + 顶部内高光（shadow-glowPri），按压时发光收敛、亮度下沉
  primary:
    'bg-pri text-card shadow-glowPriSm hover:brightness-[1.06] active:brightness-95 active:shadow-sm',
  secondary:
    'bg-card text-ink border border-brd shadow-sm hover:border-t3/40 active:bg-page',
  ghost: 'bg-transparent text-pri hover:bg-priS/60 active:bg-priS',
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-4 text-[12px]',
  md: 'h-10 px-5 text-[13px]',
  lg: 'h-11 px-6 text-[14px]',
}

export function Button({ variant = 'primary', size = 'md', className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-btn font-medium transition-all duration-base ease-out active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
