import { cn } from '@/ui/components'

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  className?: string
}

export function Toggle({ checked, onChange, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        className,
      )}
    >
      <span
        className={cn(
          'relative h-[26px] w-[46px] rounded-full transition-all duration-200 ease-out',
          checked ? 'bg-pri shadow-glowPriSm' : 'bg-brd',
        )}
      >
        <span
          className={cn(
            'absolute top-[4px] h-[18px] w-[18px] rounded-full bg-card shadow-sm transition-all duration-200 ease-out',
            checked ? 'left-[24px]' : 'left-[4px]',
          )}
        />
      </span>
    </button>
  )
}
