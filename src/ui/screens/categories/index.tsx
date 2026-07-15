import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '@/ui/components'
import { seedCategories, seedEntryAi } from '@/data/seed'
import { useUiStore } from '@/app/store'
import type { Entry } from '@/domain/types'
import { CategoryCard } from './CategoryCard'

// Snippet = the latest entry's AI summary within this category.
// Walk entries (which carry createdAt), keep those whose AI is filed under `slug`,
// pick the newest, and return its summary.
function latestSummaryFor(slug: string, entries: Entry[]): string {
  const aiByEntry = new Map(seedEntryAi.map((a) => [a.entryId, a]))
  const latest = entries
    .filter((e) => aiByEntry.get(e.id)?.category === slug)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
  return latest ? (aiByEntry.get(latest.id)?.summary ?? '') : ''
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

  const entries = useUiStore((s) => s.entries)
  const cards = useMemo(
    () => seedCategories.map((c) => ({ category: c, snippet: latestSummaryFor(c.slug, entries) })),
    [entries],
  )
  const totalCount = seedCategories.reduce((n, c) => n + c.usageCount, 0)
  const isEmpty = demoEmpty || seedCategories.length === 0

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[24px] font-bold leading-tight text-ink">类别地图</h1>
          {!isEmpty && (
            <p className="mt-1 text-[12px] text-t3">
              {seedCategories.length} 个涌现类别 · {totalCount} 条 · LLM 自动发现
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDemoEmpty((v) => !v)}
          className="mt-1 shrink-0 text-[11px] text-pri active:opacity-70"
        >
          {isEmpty ? '返回' : '演示空态'}
        </button>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={<HubIcon />}
          title="类别会随你记的内容自动涌现"
          subtitle="先记几条，AI 会帮你归类"
          action={<Button size="sm" onClick={() => navigate('/capture')}>记一笔</Button>}
        />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {cards.map(({ category, snippet }) => (
            <CategoryCard
              key={category.slug}
              category={category}
              snippet={snippet}
              onClick={() => navigate('/')}
            />
          ))}
        </div>
      )}
    </div>
  )
}
