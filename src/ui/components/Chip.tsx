import type { HTMLAttributes } from 'react'
import { cn } from './cn'

type Tone = 'default' | 'idea' | 'project' | 'pending' | 'fail'

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const TONES: Record<Tone, string> = {
  default: 'bg-page text-t2 border-brd',
  idea: 'bg-priS text-pri border-transparent',
  project: 'bg-catProject/10 text-catProject border-transparent',
  pending: 'bg-catPending/10 text-catPending border-transparent',
  fail: 'bg-catFail/10 text-catFail border-transparent',
}

export function Chip({ tone = 'default', className, ...rest }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-chip border px-2 py-0.5 text-[11px] font-medium',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  )
}
