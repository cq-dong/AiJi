import type { Category } from '@/domain/types'
import { Card, cn } from '@/ui/components'

interface CategoryCardProps {
  category: Category
  snippet: string
  liveCount: number
  onClick?: () => void
}

const DOT: Record<NonNullable<Category['accent']>, string> = {
  catIdea: 'bg-catIdea',
  catProject: 'bg-catProject',
  catPending: 'bg-catPending',
  catFail: 'bg-catFail',
}

// Per Figma 5:2 — a small accent dot (not a bar) sits beside the label.
export function CategoryCard({ category, snippet, liveCount, onClick }: CategoryCardProps) {
  const dot = category.accent ? DOT[category.accent] : 'bg-catIdea'
  return (
    <Card
      padded={false}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'h-[140px] p-4 flex flex-col gap-2.5 transition',
        onClick && 'cursor-pointer active:scale-[0.99]',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('size-3 rounded-full', dot)} />
        <span className="text-[15px] font-bold text-ink">{category.label}</span>
      </div>
      <p className="text-[12px] font-medium text-t3">{liveCount} 条</p>
      <p className="text-[12px] text-t2 line-clamp-1">{snippet || '——'}</p>
    </Card>
  )
}
