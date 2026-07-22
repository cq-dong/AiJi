import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
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
  const t = useT()
  return (
    <div className="mt-2 animate-fade-in-up">
      <p className="text-[13px] font-semibold text-ink">{t('search.recentTitle')}</p>
      <p className="mt-3 text-[12px] text-t3">{t('search.recentEmpty')}</p>
      <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.06em] text-t3">{t('search.tryLabel')}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="min-h-10 cursor-pointer rounded-chip border border-brd/80 bg-card px-4 text-[12px] font-medium text-pri shadow-sm transition-all duration-base ease-out hover:border-pri/30 hover:shadow-glowPriSm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
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
  const t = useT()
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] font-medium text-t3">{label}</span>
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => onPick('all')}
          className={cn(
            'min-h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-[12px] font-medium transition-all duration-base ease-out active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            active === 'all'
              ? 'border-transparent bg-pri text-card shadow-glowPriSm'
              : 'border-brd/80 bg-card text-t2 shadow-sm hover:border-t3/40',
          )}
        >
          {t('search.filter.all')}
        </button>
        {chips.map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => onPick(c.slug)}
            className={cn(
              'min-h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-[12px] font-medium transition-all duration-base ease-out active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              active === c.slug
                ? 'border-transparent bg-pri text-card shadow-glowPriSm'
                : 'border-brd/80 bg-card text-t2 shadow-sm hover:border-t3/40',
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
  const t = useT()
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

  // Modality / date chip labels are i18n keys on the static arrays; resolve them
  // here each render so they follow the active language (helpers can't, they
  // run before the store hydrates and `t` would freeze the first-seen language).
  const modalityChips = MODALITY_CHIPS.map((c) => ({ slug: c.slug, label: t(c.label) }))
  const dateChips = QUICK_DATE_CHIPS.map((c) => ({ slug: c.slug, label: t(c.label) }))

  return (
    <div className="px-4 pb-6 pt-4">
      <SearchBar value={query} onChange={setQuery} />

      {hasQuery && (
        <div className="mt-3 flex flex-col gap-2">
          <ChipRow
            label={t('search.filter.category')}
            chips={catChips}
            active={filters.category}
            onPick={setFilter('category')}
          />
          <ChipRow
            label={t('search.filter.tag')}
            chips={tagChips}
            active={filters.tag}
            onPick={setFilter('tag')}
          />
          <ChipRow
            label={t('search.filter.mood')}
            chips={moodChips}
            active={filters.mood}
            onPick={setFilter('mood')}
          />
          <ChipRow
            label={t('search.filter.modality')}
            chips={modalityChips}
            active={filters.modality}
            onPick={setFilter('modality')}
          />
          <ChipRow
            label={t('search.filter.date')}
            chips={dateChips}
            active={filters.date}
            onPick={pickQuickDate}
          />
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-medium text-t3">
              {t('search.filter.custom')}
            </span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label={t('search.filter.dateFromAria')}
              className="h-9 min-w-0 flex-1 cursor-text rounded-btn border border-brd bg-card px-2 text-[12px] text-ink transition duration-base ease-out focus:border-pri/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            />
            <span className="shrink-0 text-t3">–</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label={t('search.filter.dateToAria')}
              className="h-9 min-w-0 flex-1 cursor-text rounded-btn border border-brd bg-card px-2 text-[12px] text-ink transition duration-base ease-out focus:border-pri/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            />
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-start min-h-11 cursor-pointer px-2 text-[11px] font-medium text-pri transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              {t('search.clearFilters')}
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {!hasQuery && <EmptySearch onPick={setQuery} suggestions={suggestions} />}

        {hasQuery && results.length === 0 && (
          <EmptyState
            icon={<DocIcon />}
            title={t('search.emptyTitle')}
            subtitle={t('search.emptySubtitle', { query: query.trim() })}
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
