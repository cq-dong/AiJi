import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useT } from '@/app/i18n/useT'

// 底部 sheet：编辑 AI 面板 / 手动编辑 parts 共用。fixed 覆盖整视口（含 statusbar，
// iOS sheet 惯例），backdrop 点击 = 关闭 + 毛玻璃虚化背景。内容超高可滚。
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-fade-in"
      />
      <div className="relative flex max-h-[88vh] flex-col rounded-t-[32px] border-t border-white/10 bg-card pb-4 pt-2 shadow-sheet animate-slide-up">
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-t3/40" />
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-[17px] font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-1 flex size-11 items-center justify-center rounded-full bg-page text-t2 transition duration-base ease-out hover:bg-brd active:scale-[0.97] cursor-pointer focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-2">{children}</div>
        {footer && <div className="flex items-center gap-2 px-4 pt-1">{footer}</div>}
      </div>
    </div>
  )
}
