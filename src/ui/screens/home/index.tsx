import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useTransform } from 'framer-motion'
import { Mic, Trash2 } from 'lucide-react'
import { Button, EmptyState, SwipeableCard } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import type { Entry } from '@/domain/types'
import { dateKey, groupLabel, todayKeyFrom, topDateLabel, windowGroups } from './helpers'
import { HomeHeader } from './HomeHeader'
import { JustSavedToast, OfflineBanner, PullIndicator } from './Banners'
import { TimelineCard } from './TimelineCard'
import { usePullToRefresh } from './usePullToRefresh'

// 增量渲染页大小：首屏 30 条足够填满视口数倍，之后每次滚动到底再 +30。
const PAGE = 30

export default function Home() {
  const navigate = useNavigate()
  const t = useT()
  const online = useUiStore((s) => s.online)
  const entries = useUiStore((s) => s.entries)
  const justSaved = useUiStore((s) => s.justSaved)
  const clearJustSaved = useUiStore((s) => s.clearJustSaved)
  const categories = useUiStore((s) => s.categories)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const rehydrate = useUiStore((s) => s.rehydrate)
  const trashEntry = useUiStore((s) => s.trashEntry)

  // 下拉刷新：重读 Dexie（local-first 语义下的 refresh）。指示器高度=pull 手势值。
  const handleRefresh = useCallback(() => rehydrate(), [rehydrate])
  const { ref: ptrRef, pull, refreshing } = usePullToRefresh(handleRefresh)
  const indicatorOpacity = useTransform(pull, [0, 40], [0, 1])

  // 空库时 todayKeyFrom 返 ''，topDateLabel('') 会渲出「NaN月undefined日」——回落系统今天。
  const todayKey = todayKeyFrom(entries) || dateKey(new Date().toISOString())
  const todayCount = entries.filter((e) => dateKey(e.createdAt) === todayKey).length

  const showOffline = !online
  const showJustSaved = justSaved
  const isEmpty = entries.length === 0

  // 真实保存路径：toast ~3.5s 后自动收起
  useEffect(() => {
    if (!justSaved) return
    const id = window.setTimeout(() => clearJustSaved(), 3500)
    return () => window.clearTimeout(id)
  }, [justSaved, clearJustSaved])

  // P-A 性能（2026-10-03）：排序/分组/索引 useMemo——此前每次 render 全量重算。
  const sorted = useMemo(
    () => [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [entries],
  )

  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of sorted) {
      const k = dateKey(e.createdAt)
      const arr = map.get(k)
      if (arr) arr.push(e)
      else map.set(k, [e])
    }
    return [...map.keys()]
      .sort((a, b) => b.localeCompare(a))
      .map((k) => ({ key: k, label: groupLabel(k, todayKey), entries: map.get(k)! }))
  }, [sorted, todayKey])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories])
  const aiMap = useMemo(() => new Map(Object.entries(aiByEntry)), [aiByEntry])

  // P-A 性能（2026-10-03）：哨兵式增量渲染。首屏 PAGE 条，哨兵进视口再加载 PAGE 条；
  // 无 IntersectionObserver 的环境（老 WebView / jsdom）回落「加载更多」按钮。
  const [limit, setLimit] = useState(PAGE)
  const { visible, rendered } = windowGroups(groups, limit)
  const hasMore = rendered < sorted.length
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (list) => {
        if (list.some((x) => x.isIntersecting)) setLimit((l) => l + PAGE)
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore])

  const banner = showOffline ? <OfflineBanner /> : showJustSaved ? <JustSavedToast /> : null
  const hasTop = banner !== null

  return (
    <div ref={ptrRef} className="px-4 pt-4 pb-6">
      {/* 下拉刷新指示器：高度随手势 pull 生长（0→阈值），refreshing 时停驻 48px。 */}
      <motion.div
        style={{ height: pull, opacity: indicatorOpacity }}
        className="overflow-hidden"
        aria-live="polite"
        aria-busy={refreshing}
      >
        <div className="flex h-12 w-full flex-col justify-center">
          <PullIndicator pull={pull} refreshing={refreshing} />
        </div>
      </motion.div>

      <HomeHeader topDateLabel={topDateLabel(todayKey)} todayCount={todayCount} />

      {hasTop && (
        <div className="mt-3 flex flex-col gap-3">
          {banner}
        </div>
      )}

      <div className={hasTop ? 'mt-6' : 'mt-8'}>
        {isEmpty ? (
          <EmptyState
            icon={
              <div className="flex size-24 items-center justify-center rounded-full bg-gradient-to-b from-priS to-priS/50 ring-1 ring-pri/10 shadow-glowPriSm">
                <Mic size={36} className="text-pri" />
              </div>
            }
            title={t('home.empty.title')}
            subtitle={t('home.empty.subtitle')}
            action={
              <Button size="lg" onClick={() => navigate('/capture')}>
                {t('home.empty.action')}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {visible.map((g, gi) => (
              <section key={g.key}>
                <h2 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-t3">
                  {g.label}
                  <span className="h-px flex-1 bg-gradient-to-r from-brd to-transparent" aria-hidden="true" />
                </h2>
                <div className="flex flex-col gap-2.5">
                  {/* 左滑删除（软删进回收站，30 天可恢复——非不可逆，swipe+点按两段确认）。
                      AnimatePresence 收移除退场（SwipeableCard 外层高度收拢+淡出）。 */}
                  <AnimatePresence initial={false}>
                    {g.entries.map((e, ei) => {
                      const ai = aiMap.get(e.id)
                      const cat = ai ? catMap.get(ai.category) : undefined
                      return (
                        <SwipeableCard
                          key={e.id}
                          rightActions={[
                            {
                              key: 'trash',
                              label: t('common.delete'),
                              icon: <Trash2 size={16} />,
                              color: 'bg-catFail',
                              hapticStyle: 'warning',
                              onAction: () => trashEntry(e.id),
                            },
                          ]}
                        >
                          <TimelineCard
                            entry={e}
                            ai={ai}
                            catLabel={cat?.label}
                            catAccent={cat?.accent}
                            index={gi * 3 + ei}
                          />
                        </SwipeableCard>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </section>
            ))}
          </div>
        )}
          {hasMore &&
            (typeof IntersectionObserver === 'undefined' ? (
              <Button variant="ghost" size="sm" className="mx-auto" onClick={() => setLimit((l) => l + PAGE)}>
                {t('home.loadMore')}
              </Button>
            ) : (
              <div ref={sentinelRef} className="h-1" aria-hidden="true" />
            ))}
      </div>
    </div>
  )
}
