import { useMemo } from 'react'
import type { Category, Entry, EntryAi } from '@/domain/types'
import { EmptyState } from '@/ui/components'
import { useT } from '@/app/i18n/useT'
import { useUiStore } from '@/app/store'
import { dateKey, groupLabel, todayKeyFrom } from './helpers'
import { EntryRow } from './EntryRow'

interface TimeLensProps {
  entries: Entry[]
  aiByEntry: Record<string, EntryAi>
  categories: Category[]
}

// 时间 view: timeline grouped by date, newest first. Each section lists entries
// (preview, time, category chip resolved from categories + aiByEntry).
export function TimeLens({ entries, aiByEntry, categories }: TimeLensProps) {
  const t = useT()
  const lang = useUiStore((s) => s.settings.language)
  const catMap = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories])
  const todayKey = useMemo(() => todayKeyFrom(entries), [entries])

  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of entries) {
      const k = dateKey(e.createdAt)
      const arr = map.get(k)
      if (arr) arr.push(e)
      else map.set(k, [e])
    }
    // sort entries within each group newest-first; sort groups newest-first.
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    return [...map.keys()]
      .sort((a, b) => b.localeCompare(a))
      .map((k) => ({ key: k, label: groupLabel(k, todayKey), entries: map.get(k)! }))
    // lang 入依赖：groupLabel 内部走 t() 本地化日期头（今天/昨天），切语言需重算。
  }, [entries, todayKey, lang])

  if (entries.length === 0) {
    return (
      <EmptyState title={t('categories.time.empty.title')} subtitle={t('categories.time.empty.subtitle')} />
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-t3">{g.label}</h2>
          <div className="flex flex-col gap-2">
            {g.entries.map((e) => {
              const ai = aiByEntry[e.id]
              const cat = ai ? catMap.get(ai.category) : undefined
              return <EntryRow key={e.id} entry={e} ai={ai} category={cat} />
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
