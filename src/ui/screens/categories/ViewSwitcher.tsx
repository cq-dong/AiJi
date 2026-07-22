import { cn } from '@/ui/components'
import { useT } from '@/app/i18n/useT'
import type { I18nKey } from '@/app/i18n'
import { LENS_KEYS, type LensKind } from './helpers'

// The 6 lenses of 类别地图. Default 'category'.
export type CategoryView = LensKind

const VIEWS: { key: CategoryView; labelKey: I18nKey }[] = [
  { key: 'category', labelKey: LENS_KEYS.category },
  { key: 'time', labelKey: LENS_KEYS.time },
  { key: 'mood', labelKey: LENS_KEYS.mood },
  { key: 'project', labelKey: LENS_KEYS.project },
  { key: 'person', labelKey: LENS_KEYS.person },
  { key: 'place', labelKey: LENS_KEYS.place },
]

interface ViewSwitcherProps {
  view: CategoryView
  onChange: (v: CategoryView) => void
}

// Segmented control — 6 equal tabs in one row (2-char labels fit 390px viewport).
export function ViewSwitcher({ view, onChange }: ViewSwitcherProps) {
  const t = useT()
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
          {t(v.labelKey)}
        </button>
      ))}
    </div>
  )
}
