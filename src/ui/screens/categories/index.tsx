import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import type { Entry, EntryAi } from '@/domain/types'
import { CategoryCard } from './CategoryCard'
import { CategoryDetail } from './CategoryDetail'
import { CategoryEditSheet } from './CategoryEditSheet'
import { ViewSwitcher, type CategoryView } from './ViewSwitcher'
import { PinnedCards } from './PinnedCards'
import { TimeLens } from './TimeLens'
import { FacetLens } from './FacetLens'

// Snippet = the latest entry's AI summary within this category.
function latestSummaryFor(
  slug: string,
  entries: Entry[],
  aiByEntry: Record<string, EntryAi>,
): string {
  const latest = entries
    .filter((e) => aiByEntry[e.id]?.category === slug)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
  return latest ? (aiByEntry[latest.id]?.summary ?? '') : ''
}

function HubIcon() {
  return (
    <div className="grid grid-cols-2 place-items-center gap-2 rounded-full bg-priS p-5 size-24">
      <span className="size-[22px] rounded-[6px] bg-pri" />
      <span className="size-[22px] rounded-[6px] bg-pri" />
      <span className="size-[22px] rounded-[6px] bg-pri" />
      <span className="size-[22px] rounded-[6px] bg-pri" />
    </div>
  )
}

export default function Categories() {
  const navigate = useNavigate()
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [view, setView] = useState<CategoryView>('category')

  const entries = useUiStore((s) => s.entries)
  const categories = useUiStore((s) => s.categories)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const tags = useUiStore((s) => s.tags)
  const drafts = useUiStore((s) => s.drafts)
  const trashed = useUiStore((s) => s.trashed)
  const saveCategory = useUiStore((s) => s.saveCategory)
  const deleteCategory = useUiStore((s) => s.deleteCategory)

  const cards = useMemo(
    () =>
      categories.map((c) => ({
        category: c,
        snippet: latestSummaryFor(c.slug, entries, aiByEntry),
        liveCount: entries.filter((e) => aiByEntry[e.id]?.category === c.slug).length,
      })),
    [categories, entries, aiByEntry],
  )
  const totalCount = cards.reduce((n, c) => n + c.liveCount, 0)
  const isEmpty = categories.length === 0
  const selected = selectedSlug
    ? categories.find((c) => c.slug === selectedSlug)
    : undefined
  const editing = editingSlug
    ? categories.find((c) => c.slug === editingSlug)
    : undefined
  const editingCount = editing
    ? entries.filter((e) => aiByEntry[e.id]?.category === editing.slug).length
    : 0

  return (
    <div className="px-4 pt-4 pb-6">
      {isEmpty ? (
        <EmptyState
          icon={<HubIcon />}
          title="类别会随你记的内容自动涌现"
          subtitle="先记几条，AI 会帮你归类"
          action={<Button size="sm" onClick={() => navigate('/capture')}>记一笔</Button>}
        />
      ) : selected ? (
        <CategoryDetail
          category={selected}
          entries={entries}
          aiByEntry={aiByEntry}
          tags={tags}
          onBack={() => setSelectedSlug(null)}
        />
      ) : (
        <>
          <div className="animate-fade-in-up">
            <h1 className="text-[24px] font-bold leading-tight text-ink">类别地图</h1>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-t3">
              <span className="font-medium tabular-nums text-t2">{categories.length}</span> 个涌现类别
              <span aria-hidden="true" className="inline-block size-[3px] rounded-full bg-t3/50" />
              <span className="font-medium tabular-nums text-t2">{totalCount}</span> 条
              <span aria-hidden="true" className="inline-block size-[3px] rounded-full bg-t3/50" />
              LLM 自动发现
            </p>
          </div>
          <div className="mt-3">
            <ViewSwitcher view={view} onChange={setView} />
          </div>
          {view === 'category' && (
            <>
              <div className="mt-4">
                <PinnedCards draftCount={drafts.length} trashCount={trashed.length} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {cards.map(({ category, snippet, liveCount }) => (
                  <CategoryCard
                    key={category.slug}
                    category={category}
                    snippet={snippet}
                    liveCount={liveCount}
                    onClick={() => setSelectedSlug(category.slug)}
                    onLongPress={() => setEditingSlug(category.slug)}
                  />
                ))}
              </div>
            </>
          )}
          {view === 'time' && (
            <TimeLens entries={entries} aiByEntry={aiByEntry} categories={categories} />
          )}
          {(view === 'mood' || view === 'project' || view === 'person' || view === 'place') && (
            <FacetLens
              kind={view}
              entries={entries}
              aiByEntry={aiByEntry}
              categories={categories}
            />
          )}
        </>
      )}
      {editing && (
        <CategoryEditSheet
          category={editing}
          liveCount={editingCount}
          onClose={() => setEditingSlug(null)}
          onSave={(cat) => {
            void saveCategory(cat)
            setEditingSlug(null)
          }}
          onDelete={(slug) => {
            void deleteCategory(slug)
            setEditingSlug(null)
          }}
        />
      )}
    </div>
  )
}
