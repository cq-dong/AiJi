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
        'relative h-[22px] w-[40px] rounded-full transition-colors',
        checked ? 'bg-pri' : 'bg-brd',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-[18px] w-[18px] rounded-full bg-card transition-transform',
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}
