import { useNavigate } from 'react-router-dom'

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
        className="flex items-center gap-2.5 rounded-card bg-priS p-3 text-left transition active:scale-[0.99]"
      >
        <span className="grid size-9 place-items-center rounded-btn bg-pri/10 text-pri">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">草稿</p>
          <p className="text-[11px] text-t3">{draftCount} 条未完成</p>
        </div>
      </button>
      <button
        type="button"
        onClick={() => navigate('/trash')}
        className="flex items-center gap-2.5 rounded-card bg-priS p-3 text-left transition active:scale-[0.99]"
      >
        <span className="grid size-9 place-items-center rounded-btn bg-pri/10 text-pri">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">回收站</p>
          <p className="text-[11px] text-t3">{trashCount} 条已删</p>
        </div>
      </button>
    </div>
  )
}
