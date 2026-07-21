import { cn } from '@/ui/components'

// The 6 lenses of 类别地图. Default 'category'.
export type CategoryView = 'category' | 'time' | 'mood' | 'project' | 'person' | 'place'

const VIEWS: { key: CategoryView; label: string }[] = [
  { key: 'category', label: '类别' },
  { key: 'time', label: '时间' },
  { key: 'mood', label: '心情' },
  { key: 'project', label: '项目' },
  { key: 'person', label: '人物' },
  { key: 'place', label: '地点' },
]

interface ViewSwitcherProps {
  view: CategoryView
  onChange: (v: CategoryView) => void
}

// Segmented control — 6 equal tabs in one row (2-char labels fit 390px viewport).
export function ViewSwitcher({ view, onChange }: ViewSwitcherProps) {
  return (
    <div className="grid grid-cols-6 gap-1 rounded-[14px] border border-brd/60 bg-page p-1 shadow-inner">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onChange(v.key)}
          aria-pressed={view === v.key}
          className={cn(
            'rounded-[10px] py-1.5 text-[12px] transition-all duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            view === v.key
              ? 'bg-card font-semibold text-ink shadow-sm'
              : 'font-medium text-t3 hover:text-t2 active:scale-95',
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
