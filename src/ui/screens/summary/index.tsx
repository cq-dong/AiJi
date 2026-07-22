import { useEffect, useMemo, useRef, useState } from 'react'
import type { Aggregate, AggregateScopeType } from '@/domain/types'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import type { I18nKey } from '@/app/i18n'
import { DigestCard } from './DigestCard'
import { lastRanges, scopeRange } from './aggregate'
import * as summaryCache from '@/adapters/summaryCache'

type Scope = AggregateScopeType

const SCOPES: { key: Scope; labelKey: I18nKey }[] = [
  { key: 'day', labelKey: 'summary.scope.day' },
  { key: 'week', labelKey: 'summary.scope.week' },
  { key: 'month', labelKey: 'summary.scope.month' },
]

const DETAIL_LEVELS: { level: 1 | 2 | 3 | 4 | 5; labelKey: I18nKey }[] = [
  { level: 1, labelKey: 'summary.detailLevel.1' },
  { level: 2, labelKey: 'summary.detailLevel.2' },
  { level: 3, labelKey: 'summary.detailLevel.3' },
  { level: 4, labelKey: 'summary.detailLevel.4' },
  { level: 5, labelKey: 'summary.detailLevel.5' },
]

// Limited-concurrency enqueue: avoid LLM stampede when many periods need recompute.
const RECOMPUTE_CONCURRENCY = 2

export default function Summary() {
  const t = useT()
  // lang 作为 periods useMemo 依赖：切换语言时 lastRanges 内的 t()/Intl 标签须重算，
  // 否则 memo 命中旧语言标签（今日/昨日/本周… / Today/Yesterday/…）。
  const lang = useUiStore((s) => s.settings.language)
  const [scope, setScope] = useState<Scope>('week')
  const aggregates = useUiStore((s) => s.aggregates)
  const recalculatingMap = useUiStore((s) => s.recalculating)
  const recomputeAggregate = useUiStore((s) => s.recomputeAggregate)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const categories = useUiStore((s) => s.categories)
  const entries = useUiStore((s) => s.entries)
  const detailLevel = useUiStore((s) => s.settings.aggregateDetailLevel)
  const setSettings = useUiStore((s) => s.setSettings)
  const hydrated = useUiStore((s) => s.hydrated)

  const entryAi = useMemo(() => Object.values(aiByEntry), [aiByEntry])
  // Precompute entryIds by range key for the active scope (avoids O(n×m) per render
  // and gives both count + ids for cache freshness + synthesis).
  const entryIdsByRange = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of entries) {
      const r = scopeRange(scope, new Date(e.createdAt))
      const arr = m.get(r)
      if (arr) arr.push(e.id)
      else m.set(r, [e.id])
    }
    return m
  }, [entries, scope])
  const periods = useMemo(() => lastRanges(scope), [scope, lang])

  // Refs to scan latest aggregates/recalculating without re-subscribing the effect
  // (avoids recompute loop — failure leaves stale, effect doesn't re-fire on aggregates change).
  const aggregatesRef = useRef(aggregates)
  aggregatesRef.current = aggregates
  const recalculatingRef = useRef(recalculatingMap)
  recalculatingRef.current = recalculatingMap

  // Sweep: on scope / detailLevel / hydrate change, enqueue recompute for every
  // visible period that is missing OR stale OR generated at a different detail level.
  // D6: skip recompute when no Dexie aggregate exists BUT the localStorage cache is
  // fresh (shouldRefresh false + detailLevel matches) — 秒开 from cache, no wasted
  // LLM call. The sweep still recomputes genuinely-stale periods (new entries filed,
  // cross-day/cross-week rollover, detail-level change).
  useEffect(() => {
    if (!hydrated) return
    const missing: string[] = []
    for (const { range } of periods) {
      const cur = aggregatesRef.current.find(
        (a) => a.scope.type === scope && a.scope.range === range,
      )
      const key = `${scope}:${range}`
      if (recalculatingRef.current[key] === true) continue
      const needsRecompute = !cur || cur.stale || (cur.detailLevel ?? 3) !== detailLevel
      if (!needsRecompute) continue
      // D6/D18: no Dexie aggregate OR stale but cache fresh → skip LLM recompute (秒开 from cache).
      // D18 关键修复：原先只在 `!cur` 时查缓存，stale 时直接 push missing → recomputeAggregate
      // → LLM 失败 → catch restore stale=true → 下次进页面又 stale 又不查缓存 → 死循环「生成中」。
      // 扩展到 `!cur || cur.stale` 后，stale 时也查缓存：shouldRefresh 对 day scope 比较 entryCount，
      // 新条目 entryCount 变 → shouldRefresh=true → fresh=false → 仍重算（设计意图保留）；LLM 失败后
      // entryCount 未变 → shouldRefresh=false → fresh=true → continue 跳过 LLM，显示旧摘要。
      // D27: 缓存按 detailLevel 分桶——cur 是别的 lvl（切换 3→4→3 回到 3）时也查本 lvl 缓存，
      // 命中即秒开跳过付费 LLM。条件从 `(!cur || cur.stale)` 放宽到 needsRecompute 即查。
      if (needsRecompute) {
        const count = entryIdsByRange.get(range)?.length ?? 0
        const cached = summaryCache.get(scope, range, detailLevel)
        const fresh =
          cached !== null &&
          !summaryCache.shouldRefresh(scope, range, count, detailLevel)
        if (fresh) continue
      }
      missing.push(range)
    }
    if (missing.length === 0) return
    void (async () => {
      for (let i = 0; i < missing.length; i += RECOMPUTE_CONCURRENCY) {
        const batch = missing.slice(i, i + RECOMPUTE_CONCURRENCY)
        await Promise.all(
          batch.map((range) => recomputeAggregate(scope, range, detailLevel)),
        )
      }
    })()
  }, [scope, detailLevel, hydrated, periods, recomputeAggregate, entryIdsByRange])

  // D6: persist fresh aggregates to localStorage cache. When recompute completes and
  // a fresh aggregate lands in store, mirror it to the cache so the next page entry
  // reads from cache (秒开) without re-hitting the LLM. Also backfills the cache
  // from pre-existing fresh Dexie aggregates on scope switch / entries change.
  // D27: 缓存按 detailLevel 分桶——用 ag 自身的 detailLevel 作 key，每档各自保留。
  useEffect(() => {
    for (const ag of aggregates) {
      if (ag.scope.type !== scope) continue
      if (ag.stale) continue
      if (ag.summary.trim().length === 0) continue
      const count = entryIdsByRange.get(ag.scope.range)?.length ?? 0
      const lvl = ag.detailLevel ?? 3
      summaryCache.set(scope, ag.scope.range, lvl, {
        content: ag.summary,
        generatedAt: ag.createdAt,
        entryCount: count,
        highlights: ag.highlights,
        modelUsed: ag.modelUsed,
        detailLevel: lvl,
      })
    }
  }, [aggregates, scope, entryIdsByRange])

  const onScopeChange = (s: Scope) => setScope(s)
  const onLevelChange = (lvl: 1 | 2 | 3 | 4 | 5) => {
    setSettings({ aggregateDetailLevel: lvl })
  }

  // D6: manual refresh — clear cache (无视缓存) + trigger recompute. The store's
  // fresh-skip guard may still short-circuit if the Dexie aggregate is fresh; that's
  // the store's prerogative (out of this file's scope). Clearing the cache ensures
  // the next entry re-evaluates freshness from scratch and the watch effect backfills
  // from the latest Dexie aggregate.
  // D27: clear 按 detailLevel 分桶——只清当前 lvl，其它 lvl 的缓存保留。
  const onRegen = (range: string) => {
    summaryCache.clear(scope, range, detailLevel)
    void recomputeAggregate(scope, range, detailLevel)
  }

  return (
    <div className="px-4 pb-6 pt-4">
      <h1 className="text-[24px] font-bold text-ink">{t('summary.title')}</h1>

      {/* scope tabs: 日/周/月 —— 与 categories ViewSwitcher 同款分段控件，全局一致 */}
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-[14px] border border-brd/60 bg-page p-1 shadow-inner">
        {SCOPES.map((s) => {
          const active = s.key === scope
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onScopeChange(s.key)}
              className={[
                'h-10 cursor-pointer rounded-[10px] text-[13px] transition-all duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                active
                  ? 'bg-card font-semibold text-ink shadow-sm'
                  : 'font-medium text-t3 hover:text-t2 active:scale-95',
              ].join(' ')}
            >
              {t(s.labelKey)}
            </button>
          )
        })}
      </div>

      {/* detail level selector: 极简/简洁/标准/详细/详尽 */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-t3">{t('summary.detailLevel')}</div>
        <div className="flex gap-1 rounded-[14px] border border-brd/60 bg-page p-1 shadow-inner">
          {DETAIL_LEVELS.map(({ level, labelKey }) => {
            const active = level === detailLevel
            return (
              <button
                key={level}
                type="button"
                onClick={() => onLevelChange(level)}
                className={[
                  'h-9 flex-1 cursor-pointer rounded-[9px] text-[11px] transition-all duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                  active
                    ? 'bg-card font-semibold text-ink shadow-sm'
                    : 'font-medium text-t3 hover:text-t2 active:scale-95',
                ].join(' ')}
              >
                {t(labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      {/* reverse-chrono period list (newest-on-top) */}
      <div className="mt-4 flex flex-col gap-3">
        {periods.map((p) => {
          const key = `${scope}:${p.range}`
          const current = aggregates.find(
            (a) => a.scope.type === scope && a.scope.range === p.range,
          ) ?? null
          const isRecalculating = recalculatingMap[key] === true
          const entryIds = entryIdsByRange.get(p.range) ?? []
          const hasEntries = entryIds.length > 0

          // D6: cache fallback for 秒开. When the Dexie aggregate is missing or stale,
          // consult the localStorage cache. If the cache is fresh (shouldRefresh false
          // + detailLevel matches), synthesize an Aggregate from it and show content
          // immediately — no spinner, no wasted LLM call.
          // D27: 缓存按 detailLevel 分桶，get/shouldRefresh 传当前 detailLevel。
          const cached = summaryCache.get(scope, p.range, detailLevel)
          const cacheFresh =
            cached !== null &&
            !summaryCache.shouldRefresh(scope, p.range, entryIds.length, detailLevel)

          // Display priority: fresh Dexie aggregate (同 lvl) > fresh cache > stale/wrong-lvl Dexie aggregate > null.
          // D27: Dexie 聚合是别的 lvl 时不算 fresh——回落到本 lvl 缓存秒开，避免显错 lvl 内容。
          let display: Aggregate | null
          let recalculating = isRecalculating
          if (current && !current.stale && (current.detailLevel ?? 3) === detailLevel) {
            display = current
          } else if (cacheFresh && cached) {
            // 秒开: show cached content, suppress spinner (recompute may still run
            // in the background for stale Dexie aggregate — when it lands, it replaces).
            display = synthesizeFromCache(scope, p.range, cached, entryIds)
            recalculating = false
          } else {
            display = current // may be stale (shows 已过期 chip) or null
          }

          const showSkeleton = !display && (isRecalculating || hasEntries)

          if (display) {
            return (
              <DigestCard
                key={key}
                aggregate={display}
                entryAi={entryAi}
                categories={categories}
                recalculating={recalculating}
                onRegen={() => onRegen(p.range)}
                label={p.label}
                rangeLabel={p.dateLabel}
              />
            )
          }
          if (showSkeleton) {
            return (
              <DigestCard
                key={key}
                aggregate={placeholderAggregate(scope, p.range)}
                entryAi={entryAi}
                categories={categories}
                recalculating={isRecalculating}
                onRegen={() => onRegen(p.range)}
                label={p.label}
                rangeLabel={p.dateLabel}
              />
            )
          }
          return (
            <DigestCard
              key={key}
              aggregate={placeholderAggregate(scope, p.range)}
              entryAi={entryAi}
              categories={categories}
              empty
              label={p.label}
              rangeLabel={p.dateLabel}
            />
          )
        })}
      </div>
    </div>
  )
}

// D6: synthesize a display-only Aggregate from a cache hit. entryIds come from the
// current entries list (not cached) so the card's "{n} 条 · 挂链" count stays live.
function synthesizeFromCache(
  scope: Scope,
  range: string,
  cached: summaryCache.CachedSummary,
  entryIds: string[],
): Aggregate {
  return {
    id: `cache-${scope}-${range}`,
    scope: { type: scope, range },
    summary: cached.content,
    highlights: cached.highlights ?? [],
    entryIds,
    modelUsed: cached.modelUsed ?? '',
    createdAt: cached.generatedAt,
    stale: false,
    detailLevel: cached.detailLevel ?? 3,
  }
}

// Placeholder lets the recalculating skeleton render before the real aggregate
// arrives (covers the gap when current is undefined but recompute is in-flight).
function placeholderAggregate(scope: Scope, range: string): Aggregate {
  return {
    id: `placeholder-${scope}-${range}`,
    scope: { type: scope, range },
    summary: '',
    entryIds: [],
    modelUsed: '',
    createdAt: new Date().toISOString(),
    stale: false,
  }
}
