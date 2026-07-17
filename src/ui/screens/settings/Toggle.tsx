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
          'relative h-[22px] w-[40px] rounded-full transition-colors',
          checked ? 'bg-pri' : 'bg-brd',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-[18px] w-[18px] rounded-full bg-card transition-transform',
            checked ? 'translate-x-[20px]' : 'translate-x-[2px]',
          )}
        />
      </span>
    </button>
  )
}
