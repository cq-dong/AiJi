import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { Button, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import type { Entry } from '@/domain/types'
import { dateKey, groupLabel, todayKeyFrom, topDateLabel } from './helpers'
import { HomeHeader } from './HomeHeader'
import { JustSavedToast, OfflineBanner } from './Banners'
import { TimelineCard } from './TimelineCard'

export default function Home() {
  const navigate = useNavigate()
  const online = useUiStore((s) => s.online)
  const entries = useUiStore((s) => s.entries)
  const justSaved = useUiStore((s) => s.justSaved)
  const clearJustSaved = useUiStore((s) => s.clearJustSaved)
  const categories = useUiStore((s) => s.categories)
  const aiByEntry = useUiStore((s) => s.aiByEntry)

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

  const sorted = [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const groups = (() => {
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
  })()

  const catMap = new Map(categories.map((c) => [c.slug, c]))
  const aiMap = new Map(Object.entries(aiByEntry))

  const banner = showOffline ? <OfflineBanner /> : showJustSaved ? <JustSavedToast /> : null
  const hasTop = banner !== null

  return (
    <div className="px-4 pt-4 pb-6">
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
            title="还没有记下任何东西"
            subtitle="点下方的麦克风，记一笔"
            action={
              <Button size="lg" onClick={() => navigate('/capture')}>
                记一笔
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((g, gi) => (
              <section key={g.key}>
                <h2 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-t3">
                  {g.label}
                  <span className="h-px flex-1 bg-gradient-to-r from-brd to-transparent" aria-hidden="true" />
                </h2>
                <div className="flex flex-col gap-2.5">
                  {g.entries.map((e, ei) => {
                    const ai = aiMap.get(e.id)
                    const cat = ai ? catMap.get(ai.category) : undefined
                    return (
                      <TimelineCard
                        key={e.id}
                        entry={e}
                        ai={ai}
                        catLabel={cat?.label}
                        catAccent={cat?.accent}
                        index={gi * 3 + ei}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
