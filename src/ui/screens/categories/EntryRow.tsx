import { useNavigate } from 'react-router-dom'
import type { Category, Entry, EntryAi } from '@/domain/types'
import { Card, Chip, cn } from '@/ui/components'
import { firstText, modalityLabel, timeLabel } from './helpers'

type Accent = Category['accent']

const BAR: Record<NonNullable<Accent>, string> = {
  catIdea: 'bg-catIdea',
  catProject: 'bg-catProject',
  catPending: 'bg-catPending',
  catFail: 'bg-catFail',
}

const CHIP_TONE: Record<NonNullable<Accent>, 'idea' | 'project' | 'pending' | 'fail'> = {
  catIdea: 'idea',
  catProject: 'project',
  catPending: 'pending',
  catFail: 'fail',
}

// Compact entry row: accent bar + title + preview + time + category chip.
// Shared across TimeLens / FacetLens / CategoryDetail so rendering is consistent.
interface EntryRowProps {
  entry: Entry
  ai?: EntryAi
  category?: Category
}

export function EntryRow({ entry, ai, category }: EntryRowProps) {
  const navigate = useNavigate()
  const title = ai?.titleSuggestion || firstText(entry.parts) || '未命名'
  const preview = firstText(entry.parts)
  const bar = category?.accent ? BAR[category.accent] : 'bg-t3'
  const tone = category?.accent ? CHIP_TONE[category.accent] : 'default'

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/detail/${entry.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/detail/${entry.id}`)
        }
      }}
      padded={false}
      className="relative cursor-pointer p-3 pl-4 transition active:scale-[0.99]"
    >
      <span className={cn('absolute left-0 top-0 bottom-0 w-1', bar)} />
      <h3 className="line-clamp-1 text-[14px] font-medium leading-tight text-ink">{title}</h3>
      {preview && preview !== title && (
        <p className="mt-0.5 line-clamp-1 text-[12px] leading-tight text-t2">{preview}</p>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        {category && <Chip tone={tone}>{category.label}</Chip>}
        <span className="ml-auto text-[11px] text-t3">
          {timeLabel(entry.createdAt)} · {modalityLabel(entry.parts)}
        </span>
      </div>
    </Card>
  )
}
