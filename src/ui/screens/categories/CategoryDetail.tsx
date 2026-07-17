import { useMemo, useState } from 'react'
import { ChevronLeft, Download } from 'lucide-react'
import type { Category, Entry, EntryAi, Facets, Tag } from '@/domain/types'
import { Button, Card, EmptyState, cn } from '@/ui/components'
import { exportCategoryZip } from '@/adapters/zipExport'
import { EntryRow } from './EntryRow'

// Group-by dimension within a category's detail list.
type GroupBy = 'time' | 'project' | 'person' | 'place'

const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: 'time', label: '时间' },
  { key: 'project', label: '项目' },
  { key: 'person', label: '人物' },
  { key: 'place', label: '地点' },
]

const BAR: Record<NonNullable<Category['accent']>, string> = {
  catIdea: 'bg-catIdea',
  catProject: 'bg-catProject',
  catPending: 'bg-catPending',
  catFail: 'bg-catFail',
}

function facetValues(ai: EntryAi | undefined, kind: Exclude<GroupBy, 'time'>): string[] {
  if (!ai) return []
  const f: Facets = ai.facets
  if (kind === 'project') return f.project ? [f.project] : []
  if (kind === 'place') return f.place ? [f.place] : []
  return f.person ?? []
}

interface CategoryDetailProps {
  category: Category
  entries: Entry[]
  aiByEntry: Record<string, EntryAi>
  tags: Tag[]
  onBack: () => void
}

// Inline category-detail view: lists entries whose AI category === category.slug,
// with a group-by toggle (时间 / 项目 / 人物 / 地点). Default 时间 = newest-first flat.
export function CategoryDetail({
  category,
  entries,
  aiByEntry,
  tags,
  onBack,
}: CategoryDetailProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('time')

  const items = useMemo(
    () =>
      entries
        .filter((e) => aiByEntry[e.id]?.category === category.slug)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [entries, aiByEntry, category.slug],
  )

  // unused param guard: tags are resolved by EntryRow via categories; kept for API compat.
  void tags

  const bar = category.accent ? BAR[category.accent] : 'bg-t3'
  const dot = bar

  if (items.length === 0) {
    return (
      <div>
        <DetailHeader label={category.label} dot={dot} count={0} slug={category.slug} onBack={onBack} />
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
        slug={category.slug}
        onBack={onBack}
      />
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-btn bg-page p-1">
        {GROUP_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setGroupBy(o.key)}
            aria-pressed={groupBy === o.key}
            className={cn(
              'rounded-btn py-1 text-[12px] font-medium transition duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              groupBy === o.key
                ? 'bg-card text-ink shadow-sm'
                : 'text-t3 active:scale-95',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {groupBy === 'time' ? (
          <div className="flex flex-col gap-2">
            {items.map((entry) => {
              const ai = aiByEntry[entry.id]
              return <EntryRow key={entry.id} entry={entry} ai={ai} category={category} />
            })}
          </div>
        ) : (
          <GroupedEntries
            items={items}
            aiByEntry={aiByEntry}
            category={category}
            kind={groupBy}
          />
        )}
      </div>
    </div>
  )
}

interface GroupedEntriesProps {
  items: Entry[]
  aiByEntry: Record<string, EntryAi>
  category: Category
  kind: Exclude<GroupBy, 'time'>
}

function GroupedEntries({ items, aiByEntry, category, kind }: GroupedEntriesProps) {
  const clusters = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of items) {
      for (const val of facetValues(aiByEntry[e.id], kind)) {
        if (!val) continue
        const arr = map.get(val)
        if (arr) arr.push(e)
        else map.set(val, [e])
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    return [...map.entries()]
      .map(([value, list]) => ({ value, list, count: list.length, newest: list[0]!.createdAt }))
      .sort((a, b) => new Date(b.newest).getTime() - new Date(a.newest).getTime())
  }, [items, aiByEntry, kind])

  if (clusters.length === 0) {
    return (
      <EmptyState
        title={`暂无${kind === 'project' ? '项目' : kind === 'person' ? '人物' : '地点'}侧面`}
        subtitle="该类别下的条目尚未识别该侧面"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {clusters.map((c) => (
        <Card key={c.value} padded={false} className="p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-pri" />
            <h3 className="text-[14px] font-medium text-ink">{c.value}</h3>
            <span className="text-[11px] text-t3">{c.count} 条</span>
          </div>
          <div className="flex flex-col gap-2">
            {c.list.map((e) => {
              const ai = aiByEntry[e.id]
              return <EntryRow key={e.id} entry={e} ai={ai} category={category} />
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}

function DetailHeader({
  label,
  dot,
  count,
  slug,
  onBack,
}: {
  label: string
  dot: string
  count: number
  slug: string
  onBack: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeft size={16} /> 返回
      </Button>
      <span className={cn('size-3 rounded-full', dot)} />
      <span className="text-[17px] font-bold text-ink">{label}</span>
      <span className="text-[12px] text-t3">{count} 条</span>
      <button
        type="button"
        aria-label="导出该类别"
        onClick={() => void exportCategoryZip(slug)}
        className="ml-auto grid size-11 cursor-pointer place-items-center rounded-btn text-t2 transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <Download size={18} strokeWidth={2} />
      </button>
    </div>
  )
}
