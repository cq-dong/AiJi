import { useT } from '@/app/i18n/useT'
import type { Category, Entry, EntryAi } from '@/domain/types'
import { Card, Chip } from '@/ui/components'
import { accentTone, formatRelativeTime, modality, previewText } from './helpers'

interface SearchResultCardProps {
  entry: Entry
  ai?: EntryAi
  category?: Category
  now: Date
  onClick?: () => void
}

export function SearchResultCard({ entry, ai, category, now, onClick }: SearchResultCardProps) {
  // 订阅语言切换：本卡片的翻译文案走 helpers（formatRelativeTime/modality）里的模块级 t()，
  // 组件本身不直接调 t，但需在语言变更时重渲以重算这些 helper 输出。
  useT()
  const title = ai?.titleSuggestion
  return (
    <Card
      padded={false}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="group flex cursor-pointer flex-col gap-1.5 p-4 transition-all duration-base ease-out hover:border-t3/30 hover:shadow-cardHover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    >
      {title && (
        <p className="line-clamp-1 text-[13px] font-semibold text-ink transition-colors duration-base group-hover:text-pri">
          {title}
        </p>
      )}
      <p className="line-clamp-2 text-[12px] leading-relaxed text-t2">{previewText(entry, ai)}</p>
      <div className="mt-1 flex items-center gap-2">
        {category && <Chip tone={accentTone(category.accent)}>{category.label}</Chip>}
        <span className="text-[11px] tabular-nums text-t3">
          {formatRelativeTime(entry.createdAt, now)} · {modality(entry)}
        </span>
      </div>
    </Card>
  )
}
