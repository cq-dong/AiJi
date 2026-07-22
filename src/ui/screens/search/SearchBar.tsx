import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useT } from '@/app/i18n/useT'
import { cn } from '@/ui/components'

interface SearchBarProps {
  value: string
  onChange: (v: string) => void
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  const t = useT()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div
      className={cn(
        'flex h-11 items-center gap-2 rounded-full border border-brd/80 bg-card px-4 shadow-card transition-all duration-base',
        'focus-within:border-pri/50 focus-within:shadow-glowPriSm focus-within:ring-2 focus-within:ring-pri/20',
      )}
    >
      <SearchIcon className="size-4 shrink-0 text-t3" />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('search.placeholder')}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-t3"
      />
      {value && (
        <button
          type="button"
          aria-label={t('search.clearAria')}
          onClick={() => onChange('')}
          className="-mr-2 flex size-8 shrink-0 items-center justify-center rounded-full bg-page text-t3 transition-all duration-base ease-out hover:text-t2 active:scale-90 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <X size={15} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}
