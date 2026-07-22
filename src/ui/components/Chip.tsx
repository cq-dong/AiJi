import type { HTMLAttributes } from 'react'
import { cn } from './cn'

type Tone = 'default' | 'idea' | 'project' | 'pending' | 'fail'

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const TONES: Record<Tone, string> = {
  default: 'bg-page text-t2 border-brd',
  idea: 'bg-priS text-pri border-pri/10',
  project: 'bg-catProject/10 text-catProject border-catProject/10',
  pending: 'bg-catPending/10 text-catPending border-catPending/10',
  fail: 'bg-catFail/10 text-catFail border-catFail/10',
}

export function Chip({ tone = 'default', className, ...rest }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-chip border px-2 py-0.5 text-[11px] font-medium leading-[1.4] tracking-[0.01em]',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  )
}
