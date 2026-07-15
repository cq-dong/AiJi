import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn, EmptyState } from '@/ui/components'
import { seedCategories, seedTags } from '@/data/seed'
import { SearchBar } from './SearchBar'
import { SearchResultCard } from './SearchResultCard'
import { searchEntries, type SearchResult } from './helpers'

const SUGGESTIONS = [
  ...seedCategories.slice(0, 4).map((c) => c.label),
  ...seedTags.slice(0, 2).map((t) => t.label),
]

const FILTER_CHIPS = [
  { slug: 'all', label: '全部' },
  ...seedCategories.map((c) => ({ slug: c.slug, label: c.label })),
]

function DocIcon() {
  return (
    <div className="grid size-24 place-items-center rounded-full bg-priS">
      <svg viewBox="0 0 24 24" fill="none" className="size-10 text-pri" aria-hidden="true">
        <path d="M6 3h8l4 4v14H6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 12h6M9 16h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function EmptySearch({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="mt-2">
      <p className="text-[13px] font-medium text-ink">最近搜索</p>
      <p className="mt-3 text-[12px] text-t3">还没有搜索记录</p>
      <p className="mt-6 text-[12px] text-t3">试试</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="h-8 rounded-full bg-priS px-4 text-[12px] font-medium text-pri active:opacity-70"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Search() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState('all')

  const hasQuery = query.trim().length > 0

  const results = useMemo<SearchResult[]>(() => {
    const all = searchEntries(query)
    if (activeCat === 'all') return all
    return all.filter((r) => r.ai?.category === activeCat)
  }, [query, activeCat])

  return (
    <div className="px-4 pb-6 pt-4">
      <SearchBar value={query} onChange={setQuery} />

      {hasQuery && (
        <div className="mt-3 flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {FILTER_CHIPS.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => setActiveCat(c.slug)}
              className={cn(
                'h-7 shrink-0 rounded-full border px-3 text-[12px] font-medium transition',
                activeCat === c.slug
                  ? 'border-transparent bg-pri text-card'
                  : 'border-brd bg-card text-t2',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {!hasQuery && <EmptySearch onPick={setQuery} />}

        {hasQuery && results.length === 0 && (
          <EmptyState
            icon={<DocIcon />}
            title="没有匹配的条目"
            subtitle={`没有匹配「${query.trim()}」的条目，试试别的关键词或换个类别`}
          />
        )}

        {hasQuery &&
          results.map((r) => (
            <SearchResultCard
              key={r.entry.id}
              entry={r.entry}
              ai={r.ai}
              category={r.category}
              onClick={() => navigate(`/detail/${r.entry.id}`)}
            />
          ))}
      </div>
    </div>
  )
}
