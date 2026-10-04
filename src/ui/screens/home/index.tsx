import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useTransform } from 'framer-motion'
import { Mic, Trash2 } from 'lucide-react'
import { Button, EmptyState, SwipeableCard } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import type { Conversation, Entry } from '@/domain/types'
import { dateKey, groupLabel, todayKeyFrom, topDateLabel, windowGroups } from './helpers'
import { HomeHeader } from './HomeHeader'
import { CompanionCard } from './CompanionCard'
import { dismissGreeting, maybeGreeting } from '@/app/proactive'
import { lastWeekRange, maybeRunWeeklyReview, WR_SEEN_PREFIX } from '@/app/weeklyReview'
import { di } from '@/app/di'
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

  // P-D 主动触达（2026-10-03 spec §3）：开屏问候，唯一触发点 = home mount。
  // fire-and-forget——频控/当日缓存/dismiss/模板兜底全在 maybeGreeting 内（src/app/proactive.ts）；
  // 返 null（频控中/当日已 dismiss）不渲染卡。ref 守卫挡 StrictMode 双跑（双跑会重复调 LLM）。
  // 注意：不做「卸载后置 alive=false」cleanup——StrictMode dev 双跑会把 run1 的 alive 置 false，
  // promise resolve 时误杀 setGreeting（F-1：dev 下问候卡永不渲染）。React 18+ 对已卸载组件
  // setState 是静默 no-op（警告已移除），真卸载无危害。
  const [greeting, setGreeting] = useState<string | null>(null)
  const greetedRef = useRef(false)
  useEffect(() => {
    if (greetedRef.current) return
    greetedRef.current = true
    void maybeGreeting({
      now: new Date(),
      listEntries: () => di.storage.listEntries(),
      listMemories: () => di.storage.listMemories(),
      listReminders: () => di.storage.listReminders(),
      // W0（2026-10-04）：多会话上线后会话 id 是 randomUUID，旧死读 getConversation('1') 永远 miss。
      // 改取 updatedAt 最新会话（对齐 store.ts hydrate 的 chatList[0] 语义），其 rollingSummary 进
      // greeting context；无会话 → undefined。
      // F2（2026-10-05）：先过滤空会话（messages.length>0，逐字对齐 refreshChatList store.ts:1804）
      // 再取 max(updatedAt)——防旧版本残留空会话吃掉 rollingSummary。
      getConversation: async () => {
        const list = await di.storage.listConversations()
        let top: Conversation | undefined
        for (const c of list) {
          if (c.messages.length === 0) continue // 空会话不进历史（同 refreshChatList）
          if (!top || new Date(c.updatedAt).getTime() > new Date(top.updatedAt).getTime()) top = c
        }
        return top
      },
      // P-F ① 往日回响（2026-10-05）：标题摘录回退所需的 aiById 快照。读 live state
      // （getState 而非 render 作用域 aiMap——本 effect 只跑一次，闭包外的渲染值可能已旧）。
      getAiById: () => new Map(Object.entries(useUiStore.getState().aiByEntry)),
      greet: (ctx) => di.llm.proactiveGreeting(ctx),
      fallbackText: () => t('home.companion.fallback'),
    })
      .then((r) => {
        if (r) setGreeting(r.text)
      })
      .catch(() => {}) // maybeGreeting 内部已兜底，这里只防意外 rejection
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 mount 触发一次（spec §3 唯一触发点）
  }, [])

  const handleDismissGreeting = useCallback(() => {
    dismissGreeting(new Date()) // 当日不再出现（aiji.pd.dismissedDate=今天）
    setGreeting(null)
  }, [])

  // P-F ② 周回顾（2026-10-05 spec §②）：home mount 惰性触发上周 aggregate 重算。
  // fire-and-forget——频控（rate key）/开关/上周空料守卫全在 maybeRunWeeklyReview 内
  // （src/app/weeklyReview.ts）；失败不写 key，下次进首页重试。ref 守卫挡 StrictMode 双跑。
  const weeklyRanRef = useRef(false)
  useEffect(() => {
    if (weeklyRanRef.current) return
    weeklyRanRef.current = true
    void maybeRunWeeklyReview().catch(() => {}) // 内部已 console.warn 兜底，这里只防意外 rejection
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 mount 触发一次（spec §② 唯一触发点）
  }, [])

  // P-F ② 周回顾卡：问候缺席（频控中/已 dismiss/LLM 无料）时补位「上周回顾」。
  // range 挂 useState 初值——mount 时定死，跨零点长挂不漂；seen 初值同步读 localStorage
  // （读失败=未见过，宁可多展示一次）。recompute 落地后 aggregates 更新 → 卡自动出现。
  const settings = useUiStore((s) => s.settings)
  const aggregates = useUiStore((s) => s.aggregates)
  const [weeklyRange] = useState(() => lastWeekRange(new Date()))
  const [weeklySeen, setWeeklySeen] = useState(() => {
    try {
      return window.localStorage.getItem(WR_SEEN_PREFIX + weeklyRange) !== null
    } catch {
      return false
    }
  })
  // 上周 aggregate 新鲜（非 stale）且 summary 非空才展示——stale 说明重算未完成/失败。
  const weekAgg = useMemo(
    () =>
      aggregates.find(
        (a) => a.scope.type === 'week' && a.scope.range === weeklyRange && !a.stale && a.summary.trim().length > 0,
      ),
    [aggregates, weeklyRange],
  )
  // 写 seen key（本周内不再出现；写失败只失去记忆，不阻塞交互）。
  const markWeeklySeen = useCallback(() => {
    try {
      window.localStorage.setItem(WR_SEEN_PREFIX + weeklyRange, new Date().toISOString())
    } catch {}
  }, [weeklyRange])
  const showWeekly =
    greeting === null && !weeklySeen && settings.weeklyReviewEnabled !== false && weekAgg !== undefined

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

      {/* P-D 伙伴问候卡：问候语区之下、横幅之上（spec §4）。点卡片跳 /chat；× 当日 dismiss。
          P-F ②：问候缺席时同槽位补「上周回顾」卡（二选一，不同时出现）。 */}
      {greeting ? (
        <div className="mt-3">
          <CompanionCard text={greeting} onOpenChat={() => navigate('/chat')} onDismiss={handleDismissGreeting} />
        </div>
      ) : showWeekly && weekAgg ? (
        <div className="mt-3">
          {/* weekly 形态下 text/onOpenChat/onDismiss 三 prop 不被组件消费（CompanionCard 契约），传占位。 */}
          <CompanionCard
            text=""
            onOpenChat={() => {}}
            onDismiss={() => {}}
            weekly={{
              range: weeklyRange,
              summary: weekAgg.summary,
              onOpen: () => {
                markWeeklySeen()
                setWeeklySeen(true)
                navigate('/summary')
              },
              onDismiss: () => {
                markWeeklySeen()
                setWeeklySeen(true)
              },
            }}
          />
        </div>
      ) : null}

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
