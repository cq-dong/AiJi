import { useNavigate } from 'react-router-dom'
import { PenLine, Trash2 } from 'lucide-react'

// Pinned special cards (倒序 = at top of 类别 view), above the category grid.
// 草稿 → /drafts, 回收站 → /trash. Distinctive bg-priS styling.
interface PinnedCardsProps {
  draftCount: number
  trashCount: number
}

export function PinnedCards({ draftCount, trashCount }: PinnedCardsProps) {
  const navigate = useNavigate()
  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={() => navigate('/drafts')}
        className="flex items-center gap-2.5 rounded-card border border-pri/10 bg-gradient-to-br from-priS to-priS/60 p-3 text-left shadow-sm transition-all duration-base ease-out hover:border-pri/25 hover:shadow-card active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <span className="grid size-9 place-items-center rounded-btn bg-pri/12 text-pri">
          <PenLine size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink">草稿</p>
          <p className="text-[11px] text-t3">{draftCount} 条未完成</p>
        </div>
      </button>
      <button
        type="button"
        onClick={() => navigate('/trash')}
        className="flex items-center gap-2.5 rounded-card border border-pri/10 bg-gradient-to-br from-priS to-priS/60 p-3 text-left shadow-sm transition-all duration-base ease-out hover:border-pri/25 hover:shadow-card active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <span className="grid size-9 place-items-center rounded-btn bg-pri/12 text-pri">
          <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink">回收站</p>
          <p className="text-[11px] text-t3">{trashCount} 条已删</p>
        </div>
      </button>
    </div>
  )
}
