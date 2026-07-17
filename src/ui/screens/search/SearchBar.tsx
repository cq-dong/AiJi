import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
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
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div
      className={cn(
        'flex h-11 items-center gap-2 rounded-full border border-brd bg-card px-4 transition',
        'focus-within:border-pri/40 focus-within:ring-2 focus-within:ring-pri/30',
      )}
    >
      <SearchIcon className="size-4 shrink-0 text-t3" />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜索条目、转写、标签…"
        className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-t3"
      />
      {value && (
        <button
          type="button"
          aria-label="清除"
          onClick={() => onChange('')}
          className="flex size-11 shrink-0 items-center justify-center rounded-btn text-t3 transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <X size={18} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
