import { useMemo } from 'react'
import type { Category, Entry, EntryAi, Facets } from '@/domain/types'
import { Card, EmptyState } from '@/ui/components'
import { EntryRow } from './EntryRow'

// Which facet dimension to cluster by.
export type FacetKind = 'mood' | 'project' | 'person' | 'place'

const FACET_LABEL: Record<FacetKind, string> = {
  mood: '心情',
  project: '项目',
  person: '人物',
  place: '地点',
}

interface FacetLensProps {
  kind: FacetKind
  entries: Entry[]
  aiByEntry: Record<string, EntryAi>
  categories: Category[]
}

// For a given entry+ai, return the facet value(s) for this kind.
// person is multi-valued → entry can appear in multiple clusters.
function facetValues(ai: EntryAi | undefined, kind: FacetKind): string[] {
  if (!ai) return []
  const f: Facets = ai.facets
  if (kind === 'mood') return f.mood ? [f.mood] : []
  if (kind === 'project') return f.project ? [f.project] : []
  if (kind === 'place') return f.place ? [f.place] : []
  return f.person ?? []
}

// Cluster entries by facet value. Each cluster = facet value + entries sorted newest-first.
// Clusters sorted by entry count desc then newest entry time desc (most active cluster first).
export function FacetLens({ kind, entries, aiByEntry, categories }: FacetLensProps) {
  const catMap = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories])

  const clusters = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of entries) {
      const ai = aiByEntry[e.id]
      for (const val of facetValues(ai, kind)) {
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
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return new Date(b.newest).getTime() - new Date(a.newest).getTime()
      })
  }, [entries, aiByEntry, kind])

  if (clusters.length === 0) {
    return (
      <EmptyState title={`暂无${FACET_LABEL[kind]}相关条目`} subtitle="记几条带该侧面的内容，AI 会自动聚合" />
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
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
              const cat = ai ? catMap.get(ai.category) : undefined
              return <EntryRow key={e.id} entry={e} ai={ai} category={cat} />
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}
