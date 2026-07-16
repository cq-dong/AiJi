import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import type { Entry, EntryAi } from '@/domain/types'
import { CategoryCard } from './CategoryCard'
import { CategoryDetail } from './CategoryDetail'

// Snippet = the latest entry's AI summary within this category.
// Walk entries (which carry createdAt), keep those whose AI is filed under `slug`,
// pick the newest, and return its summary.
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
  const [demoEmpty, setDemoEmpty] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

  const entries = useUiStore((s) => s.entries)
  const categories = useUiStore((s) => s.categories)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const tags = useUiStore((s) => s.tags)

  const cards = useMemo(
    () =>
      categories.map((c) => ({
        category: c,
        snippet: latestSummaryFor(c.slug, entries, aiByEntry),
      })),
    [categories, entries, aiByEntry],
  )
  const totalCount = categories.reduce((n, c) => n + c.usageCount, 0)
  const isEmpty = demoEmpty || categories.length === 0
  // selectedSlug may point to a slug that no longer exists after store hydrate
  // (LLM emerged/merged categories). Fall through to grid in that case.
  const selected = selectedSlug
    ? categories.find((c) => c.slug === selectedSlug)
    : undefined

  return (
    <div className="px-4 pt-4 pb-6">
      {isEmpty ? (
        <>
          <div className="flex items-start justify-end">
            <button
              type="button"
              onClick={() => setDemoEmpty((v) => !v)}
              className="mt-1 shrink-0 text-[11px] text-pri active:opacity-70"
            >
              返回
            </button>
          </div>
          <EmptyState
            icon={<HubIcon />}
            title="类别会随你记的内容自动涌现"
            subtitle="先记几条，AI 会帮你归类"
            action={<Button size="sm" onClick={() => navigate('/capture')}>记一笔</Button>}
          />
        </>
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
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-[24px] font-bold leading-tight text-ink">类别地图</h1>
              <p className="mt-1 text-[12px] text-t3">
                {categories.length} 个涌现类别 · {totalCount} 条 · LLM 自动发现
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDemoEmpty((v) => !v)}
              className="mt-1 shrink-0 text-[11px] text-pri active:opacity-70"
            >
              演示空态
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {cards.map(({ category, snippet }) => (
              <CategoryCard
                key={category.slug}
                category={category}
                snippet={snippet}
                onClick={() => setSelectedSlug(category.slug)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
