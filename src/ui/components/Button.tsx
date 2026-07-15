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
  primary: 'bg-pri text-card',
  secondary: 'bg-card text-ink border border-brd',
  ghost: 'bg-transparent text-pri',
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
        'inline-flex items-center justify-center gap-1.5 rounded-btn font-medium transition active:scale-[0.98] disabled:opacity-50',
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
