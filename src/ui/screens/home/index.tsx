import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { Button, EmptyState } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { seedCategories, seedEntryAi } from '@/data/seed'
import type { Entry } from '@/domain/types'
import { dateKey, groupLabel, todayKeyFrom, topDateLabel } from './helpers'
import { HomeHeader } from './HomeHeader'
import { FailBanner, JustSavedToast, OfflineBanner, RefreshIndicator } from './Banners'
import { TimelineCard } from './TimelineCard'

type DemoMode = 'empty' | 'justsaved' | 'refresh' | 'failed' | 'offline' | ''

function isDemo(v: string | null): DemoMode {
  if (v === 'empty' || v === 'justsaved' || v === 'refresh' || v === 'failed' || v === 'offline') return v
  return ''
}

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const online = useUiStore((s) => s.online)
  const entries = useUiStore((s) => s.entries)
  const justSaved = useUiStore((s) => s.justSaved)
  const clearJustSaved = useUiStore((s) => s.clearJustSaved)

  const demo = isDemo(searchParams.get('demo'))
  const todayKey = todayKeyFrom(entries)
  const todayCount = entries.filter((e) => dateKey(e.createdAt) === todayKey).length

  const showOffline = !online || demo === 'offline'
  const showFail = demo === 'failed'
  const showJustSaved = justSaved || demo === 'justsaved'
  const showRefresh = demo === 'refresh'
  const isEmpty = entries.length === 0 || demo === 'empty'

  // 真实保存路径：toast ~3.5s 后自动收起（demo 路径不自动收起，便于审阅）
  useEffect(() => {
    if (!justSaved) return
    const id = window.setTimeout(() => clearJustSaved(), 3500)
    return () => window.clearTimeout(id)
  }, [justSaved, clearJustSaved])

  const justSavedEntry: Entry = {
    id: 'just-saved',
    createdAt: `${todayKey}T09:05:00+08:00`,
    updatedAt: `${todayKey}T09:05:00+08:00`,
    status: 'processing',
    parts: [{ type: 'text', content: '刚记下的一笔，AI 正在分类…' }],
  }

  const sorted = [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  // 真实保存的新条目已在 entries 里（置顶），无需再加；demo 路径补一条示意卡片。
  const list = demo === 'justsaved' ? [justSavedEntry, ...sorted] : sorted

  const groups = (() => {
    const map = new Map<string, Entry[]>()
    for (const e of list) {
      const k = dateKey(e.createdAt)
      const arr = map.get(k)
      if (arr) arr.push(e)
      else map.set(k, [e])
    }
    return [...map.keys()]
      .sort((a, b) => b.localeCompare(a))
      .map((k) => ({ key: k, label: groupLabel(k, todayKey), entries: map.get(k)! }))
  })()

  const catMap = new Map(seedCategories.map((c) => [c.slug, c]))
  const aiMap = new Map(seedEntryAi.map((a) => [a.entryId, a]))

  const banner = showFail ? (
    <FailBanner onRetry={() => setSearchParams({})} />
  ) : showOffline ? (
    <OfflineBanner />
  ) : showJustSaved ? (
    <JustSavedToast />
  ) : null
  const hasTop = showRefresh || banner !== null

  return (
    <div className="px-4 pt-4 pb-6">
      <HomeHeader topDateLabel={topDateLabel(todayKey)} todayCount={todayCount} />

      {hasTop && (
        <div className="mt-3 flex flex-col gap-3">
          {showRefresh && <RefreshIndicator />}
          {banner}
        </div>
      )}

      <div className={hasTop ? 'mt-6' : 'mt-8'}>
        {isEmpty ? (
          <EmptyState
            icon={
              <div className="flex size-24 items-center justify-center rounded-full bg-priS">
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
            {groups.map((g) => (
              <section key={g.key}>
                <h2 className="mb-2 text-[12px] font-medium text-t3">{g.label}</h2>
                <div className="flex flex-col gap-2.5">
                  {g.entries.map((e) => {
                    const ai = aiMap.get(e.id)
                    const cat = ai ? catMap.get(ai.category) : undefined
                    return (
                      <TimelineCard
                        key={e.id}
                        entry={e}
                        ai={ai}
                        catLabel={cat?.label}
                        catAccent={cat?.accent}
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
