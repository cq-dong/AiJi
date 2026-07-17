import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { SearchBar } from './SearchBar'
import { SearchResultCard } from './SearchResultCard'
import {
  EMPTY_FILTERS,
  filterResults,
  MODALITY_CHIPS,
  moodChipsFrom,
  QUICK_DATE_CHIPS,
  searchEntries,
  todayRefFrom,
  type SearchFilters,
  type SearchResult,
} from './helpers'

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

function EmptySearch({ onPick, suggestions }: { onPick: (s: string) => void; suggestions: string[] }) {
  return (
    <div className="mt-2">
      <p className="text-[13px] font-medium text-ink">最近搜索</p>
      <p className="mt-3 text-[12px] text-t3">还没有搜索记录</p>
      <p className="mt-6 text-[12px] text-t3">试试</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="min-h-11 cursor-pointer rounded-full bg-priS px-4 text-[12px] font-medium text-pri transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

interface ChipRowProps {
  label: string
  chips: ReadonlyArray<{ slug: string; label: string }>
  active: string
  onPick: (slug: string) => void
}

function ChipRow({ label, chips, active, onPick }: ChipRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] font-medium text-t3">{label}</span>
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => onPick('all')}
          className={cn(
            'min-h-11 shrink-0 cursor-pointer rounded-full border px-3 text-[12px] font-medium transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            active === 'all' ? 'border-transparent bg-pri text-card' : 'border-brd bg-card text-t2',
          )}
        >
          全部
        </button>
        {chips.map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => onPick(c.slug)}
            className={cn(
              'min-h-11 shrink-0 cursor-pointer rounded-full border px-3 text-[12px] font-medium transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              active === c.slug ? 'border-transparent bg-pri text-card' : 'border-brd bg-card text-t2',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Search() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)

  const hasQuery = query.trim().length > 0

  const entries = useUiStore((s) => s.entries)
  const categories = useUiStore((s) => s.categories)
  const tags = useUiStore((s) => s.tags)
  const aiByEntry = useUiStore((s) => s.aiByEntry)

  const suggestions = useMemo(
    () => [
      ...categories.slice(0, 4).map((c) => c.label),
      ...tags.slice(0, 2).map((t) => t.label),
    ],
    [categories, tags],
  )

  const catChips = useMemo(
    () => categories.map((c) => ({ slug: c.slug, label: c.label })),
    [categories],
  )
  const tagChips = useMemo(
    () => tags.map((t) => ({ slug: t.slug, label: t.label })),
    [tags],
  )
  const moodChips = useMemo(() => moodChipsFrom(aiByEntry), [aiByEntry])

  const hasFilters =
    filters.category !== 'all' ||
    filters.tag !== 'all' ||
    filters.mood !== 'all' ||
    filters.modality !== 'all' ||
    filters.date !== 'all'

  const todayRef = useMemo(() => todayRefFrom(entries), [entries])
  const now = useMemo(() => new Date(), [])

  const results = useMemo<SearchResult[]>(() => {
    const all = searchEntries(query, entries, categories, tags, aiByEntry)
    return filterResults(all, filters, aiByEntry, now)
  }, [query, filters, entries, categories, tags, aiByEntry, now])

  const setFilter = (key: keyof SearchFilters) => (slug: string) => {
    setFilters((prev) => ({ ...prev, [key]: slug }))
  }
  const pickQuickDate = (slug: string) => {
    setFilters((prev) => ({ ...prev, date: slug, dateFrom: '', dateTo: '' }))
  }
  const setCustomFrom = (v: string) => {
    setFilters((prev) => ({ ...prev, date: 'custom', dateFrom: v }))
  }
  const setCustomTo = (v: string) => {
    setFilters((prev) => ({ ...prev, date: 'custom', dateTo: v }))
  }
  const clearFilters = () => setFilters(EMPTY_FILTERS)

  return (
    <div className="px-4 pb-6 pt-4">
      <SearchBar value={query} onChange={setQuery} />

      {hasQuery && (
        <div className="mt-3 flex flex-col gap-2">
          <ChipRow
            label="类别"
            chips={catChips}
            active={filters.category}
            onPick={setFilter('category')}
          />
          <ChipRow label="标签" chips={tagChips} active={filters.tag} onPick={setFilter('tag')} />
          <ChipRow
            label="侧面"
            chips={moodChips}
            active={filters.mood}
            onPick={setFilter('mood')}
          />
          <ChipRow
            label="模态"
            chips={MODALITY_CHIPS}
            active={filters.modality}
            onPick={setFilter('modality')}
          />
          <ChipRow
            label="日期"
            chips={QUICK_DATE_CHIPS}
            active={filters.date}
            onPick={pickQuickDate}
          />
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-medium text-t3">自定义</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="起始日期"
              className="h-9 min-w-0 flex-1 cursor-text rounded-btn border border-brd bg-card px-2 text-[12px] text-ink transition duration-base ease-out focus:border-pri/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            />
            <span className="shrink-0 text-t3">–</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="结束日期"
              className="h-9 min-w-0 flex-1 cursor-text rounded-btn border border-brd bg-card px-2 text-[12px] text-ink transition duration-base ease-out focus:border-pri/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            />
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-start min-h-11 cursor-pointer px-2 text-[11px] font-medium text-pri transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {!hasQuery && <EmptySearch onPick={setQuery} suggestions={suggestions} />}

        {hasQuery && results.length === 0 && (
          <EmptyState
            icon={<DocIcon />}
            title="没有匹配的条目"
            subtitle={`没有匹配「${query.trim()}」的条目，试试别的关键词或换个筛选条件`}
          />
        )}

        {hasQuery &&
          results.map((r) => (
            <SearchResultCard
              key={r.entry.id}
              entry={r.entry}
              ai={r.ai}
              category={r.category}
              now={todayRef}
              onClick={() => navigate(`/detail/${r.entry.id}`)}
            />
          ))}
      </div>
    </div>
  )
}
