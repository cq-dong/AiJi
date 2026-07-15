import type { Category, Entry, EntryAi } from '@/domain/types'
import { Card, Chip } from '@/ui/components'
import { accentTone, formatRelativeTime, modality, previewText } from './helpers'

interface SearchResultCardProps {
  entry: Entry
  ai?: EntryAi
  category?: Category
  onClick?: () => void
}

export function SearchResultCard({ entry, ai, category, onClick }: SearchResultCardProps) {
  const title = ai?.titleSuggestion
  return (
    <Card
      padded={false}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="flex cursor-pointer flex-col gap-1 p-4 transition active:scale-[0.99]"
    >
      {title && <p className="line-clamp-1 text-[13px] font-medium text-ink">{title}</p>}
      <p className="line-clamp-2 text-[12px] text-t2">{previewText(entry, ai)}</p>
      <div className="mt-1 flex items-center gap-2">
        {category && <Chip tone={accentTone(category.accent)}>{category.label}</Chip>}
        <span className="text-[11px] text-t3">
          {formatRelativeTime(entry.createdAt)} · {modality(entry)}
        </span>
      </div>
    </Card>
  )
}
