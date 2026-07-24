import { motion } from 'framer-motion'
import { cn } from '@/ui/components'
import { haptic } from '@/ui/lib/haptics'

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  className?: string
}

// iOS 式开关：knob 弹簧滑动（stiffness 550/damping 32，轻微过冲）+ light 触感。
// reducedMotion 由全局 MotionConfig="user" 兜为瞬切；iOS Safari 无 Vibration API 静默降级。
export function Toggle({ checked, onChange, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic('light')
        onChange(!checked)
      }}
      className={cn(
        'flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        className,
      )}
    >
      <span
        className={cn(
          'relative h-[26px] w-[46px] rounded-full transition-colors duration-200 ease-out',
          checked ? 'bg-pri shadow-glowPriSm' : 'bg-brd',
        )}
      >
        <motion.span
          animate={{ x: checked ? 20 : 0 }}
          whileTap={{ scale: 1.12 }}
          transition={{ type: 'spring', stiffness: 550, damping: 32 }}
          className="absolute left-[4px] top-[4px] h-[18px] w-[18px] rounded-full bg-card shadow-sm"
        />
      </span>
    </button>
  )
}
