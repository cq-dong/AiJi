import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Category, Entry, EntryAi, EntryPart, Tag } from '@/domain/types'
import { Button, Card, Chip, EmptyState, cn } from '@/ui/components'

// Local pure helpers — kept here so the categories screen stays self-contained
// (mirrors the per-screen helpers pattern used by home/ and detail/).

function firstText(parts: EntryPart[]): string {
  for (const p of parts) {
    if (p.type === 'text') return p.content
    if (p.type === 'audio' && p.transcript) return p.transcript
    if (p.type === 'video' && p.transcript) return p.transcript
  }
  return ''
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const min = String(d.getMinutes()).padStart(2, '0')
  const h = d.getHours()
  return h + ':' + min
}

function modalityLabel(parts: EntryPart[]): string {
  if (parts.length > 1) return '多模态'
  const p = parts[0]
  if (!p) return '文本'
  if (p.type === 'audio') return '语音'
  if (p.type === 'video') return '视频'
  return '文本'
}

const BAR: Record<NonNullable<Category['accent']>, string> = {
  catIdea: 'bg-catIdea',
  catProject: 'bg-catProject',
  catPending: 'bg-catPending',
  catFail: 'bg-catFail',
}

interface CategoryDetailProps {
  category: Category
  entries: Entry[]
  aiByEntry: Record<string, EntryAi>
  tags: Tag[]
  onBack: () => void
}

// Inline category-detail view: lists entries whose AI category === category.slug,
// each showing AI titleSuggestion (or body preview) + summary + resolved tags.
// Replaces the grid when a CategoryCard is clicked (PRD intent — see task brief).
export function CategoryDetail({
  category,
  entries,
  aiByEntry,
  tags,
  onBack,
}: CategoryDetailProps) {
  const navigate = useNavigate()

  const items = useMemo(
    () =>
      entries
        .filter((e) => aiByEntry[e.id]?.category === category.slug)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [entries, aiByEntry, category.slug],
  )

  const tagLabel = (slug: string): string =>
    tags.find((t) => t.slug === slug)?.label ?? slug

  const bar = category.accent ? BAR[category.accent] : 'bg-t3'
  const dot = bar

  if (items.length === 0) {
    return (
      <div>
        <DetailHeader label={category.label} dot={dot} count={0} onBack={onBack} />
        <EmptyState
          title="该类别下还没有条目"
          subtitle="记几条相关内容，AI 会自动归到这个类别"
        />
      </div>
    )
  }

  return (
    <div>
      <DetailHeader
        label={category.label}
        dot={dot}
        count={items.length}
        onBack={onBack}
      />
      <div className="mt-3 flex flex-col gap-3">
        {items.map((entry) => {
          const ai = aiByEntry[entry.id]
          const title = ai?.titleSuggestion || firstText(entry.parts) || '未命名'
          const preview = firstText(entry.parts)
          return (
            <Card
              key={entry.id}
              padded={false}
              role="button"
              tabIndex={0}
              onClick={() => navigate('/detail/' + entry.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate('/detail/' + entry.id)
                }
              }}
              className="relative cursor-pointer p-4 pl-5 transition active:scale-[0.99]"
            >
              <span className={cn('absolute left-0 top-0 bottom-0 w-1', bar)} />
              <h3 className="line-clamp-2 text-[14px] font-medium leading-tight text-ink">
                {title}
              </h3>
              {preview && preview !== title && (
                <p className="mt-1 line-clamp-2 text-[13px] leading-tight text-t2">
                  {preview}
                </p>
              )}
              {ai?.summary && (
                <p className="mt-2 line-clamp-3 rounded-chip bg-page px-2.5 py-1.5 text-[12px] leading-relaxed text-t2">
                  {ai.summary}
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {ai?.tags?.map((slug) => (
                  <Chip key={slug} tone="default">
                    {tagLabel(slug)}
                  </Chip>
                ))}
                <span className="ml-auto text-[11px] text-t3">
                  {timeLabel(entry.createdAt)} · {modalityLabel(entry.parts)}
                </span>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function DetailHeader({
  label,
  dot,
  count,
  onBack,
}: {
  label: string
  dot: string
  count: number
  onBack: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        ‹ 返回
      </Button>
      <span className={cn('size-3 rounded-full', dot)} />
      <span className="text-[17px] font-bold text-ink">{label}</span>
      <span className="text-[12px] text-t3">{count} 条</span>
    </div>
  )
}
