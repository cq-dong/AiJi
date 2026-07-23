import { useT } from '@/app/i18n/useT'
import type { Category, Entry, EntryAi } from '@/domain/types'
import { Card, Chip } from '@/ui/components'
import { accentTone, formatRelativeTime, highlightParts, modality, previewText } from './helpers'

interface SearchResultCardProps {
  entry: Entry
  ai?: EntryAi
  category?: Category
  now: Date
  onClick?: () => void
  /** 当前查询词——命中片段高亮（priS 底 pri 字）。空串不高亮。 */
  query?: string
}

// 高亮段渲染：命中词包 <mark>（bg-priS/text-pri，与 chip 同族视觉）。
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const segs = highlightParts(text, query)
  return (
    <>
      {segs.map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-[3px] bg-priS px-0.5 font-medium text-pri">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

export function SearchResultCard({ entry, ai, category, now, onClick, query = '' }: SearchResultCardProps) {
  // 订阅语言切换：本卡片的翻译文案走 helpers（formatRelativeTime/modality）里的模块级 t()，
  // 组件本身不直接调 t，但需在语言变更时重渲以重算这些 helper 输出。
  useT()
  const title = ai?.titleSuggestion
  const preview = previewText(entry, ai)
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
          <Highlight text={title} query={query} />
        </p>
      )}
      <p className="line-clamp-2 text-[12px] leading-relaxed text-t2">
        <Highlight text={preview} query={query} />
      </p>
      <div className="mt-1 flex items-center gap-2">
        {category && <Chip tone={accentTone(category.accent)}>{category.label}</Chip>}
        <span className="text-[11px] tabular-nums text-t3">
          {formatRelativeTime(entry.createdAt, now)} · {modality(entry)}
        </span>
      </div>
    </Card>
  )
}
