// PRD trust pack t1（2026-10-05）：设置「数据出门」sheet（PRD F5/§6 JTBD 隐私标识）。
// 契约：docs/acceptance/prd-trust-pack.md §范围③b。
// 数据源纯内存（useUiStore 的 aiByEntry + aggregates，hydrate 后必有），零新存储。
// 仅渲染已记录事实（EntryAi.modelUsed / Aggregate.modelUsed），不推断、不新增数据模型。
// back-dismiss 由共享 Sheet 内部 useBackDismiss 承担（D1 先例已收口进 Sheet）。
import { Sheet } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import { getCurrentLang } from '@/app/currentLang'
import type { Aggregate, EntryAi } from '@/domain/types'

export interface UploadGroup {
  model: string
  count: number
  lastAt: string // ISO
}

// 按 modelUsed 聚合：条目 AI 元数据 + 日/周/月聚合各算一次「出门」。lastAt 取该模型最近使用时间。
// 纯函数（抽出供单测），按 lastAt 降序返回。
export function groupUploadsByModel(aiByEntry: Record<string, EntryAi>, aggregates: Aggregate[]): UploadGroup[] {
  const map = new Map<string, { count: number; lastAt: string }>()
  const add = (model: string, at: string) => {
    const g = map.get(model)
    if (!g) {
      map.set(model, { count: 1, lastAt: at })
      return
    }
    g.count++
    if (new Date(at).getTime() > new Date(g.lastAt).getTime()) g.lastAt = at
  }
  for (const ai of Object.values(aiByEntry)) add(ai.modelUsed, ai.createdAt)
  for (const ag of aggregates) add(ag.modelUsed, ag.createdAt)
  return [...map.entries()]
    .map(([model, g]) => ({ model, count: g.count, lastAt: g.lastAt }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

// 最近时间：今天 → HH:mm；更早 → 日期。随当前语言 zh-CN/en-US 分流。
function formatLastAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const locale = getCurrentLang() === 'zh' ? 'zh-CN' : 'en-US'
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' })
}

export function DataOutSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  const aggregates = useUiStore((s) => s.aggregates)
  const groups = groupUploadsByModel(aiByEntry, aggregates)
  return (
    <Sheet title={t('settings.dataOutTitle')} onClose={onClose}>
      <p className="text-[12px] leading-relaxed text-t2">{t('settings.dataOutDesc')}</p>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-t3">{t('settings.dataOutEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((g) => (
            <div
              key={g.model}
              className="flex items-center justify-between gap-3 rounded-card border border-brd bg-page px-3 py-2.5"
            >
              <span className="min-w-0 truncate text-[13px] font-medium text-ink">{g.model}</span>
              <span className="shrink-0 text-[12px] text-t3">
                {t('settings.dataOutRowMeta', { count: g.count, time: formatLastAt(g.lastAt) })}
              </span>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
