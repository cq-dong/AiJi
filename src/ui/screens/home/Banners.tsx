// 首页顶部瞬态横幅：刚保存 toast / 处理失败 / 离线 / 刷新中
// 对应 Figma 38:60 / 38:184 / 38:247 / 38:123-125

import { Check, WifiOff } from 'lucide-react'
import { useT } from '@/app/i18n/useT'

export function JustSavedToast() {
  const t = useT()
  return (
    <div className="flex h-[46px] items-center justify-between rounded-btn border border-pri/25 bg-priS/90 px-4 shadow-glowPriSm backdrop-blur-sm animate-scale-in">
      <span className="flex items-center gap-2 text-[13px] font-medium text-pri">
        <span className="flex size-5 items-center justify-center rounded-full bg-pri text-white">
          <Check size={12} strokeWidth={3} />
        </span>
        {t('home.banner.saved')}
      </span>
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-[6px] animate-pulse rounded-full bg-pri"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </span>
    </div>
  )
}

export function FailBanner({ onRetry }: { onRetry?: () => void }) {
  const t = useT()
  return (
    <div className="flex h-[56px] items-center rounded-btn border border-catFail/25 bg-catFail/10 pl-4 pr-2 shadow-sm animate-scale-in">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-catFail">{t('home.banner.fail.title')}</p>
        <p className="text-[11px] text-t3">{t('home.banner.fail.subtitle')}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="h-[30px] w-[88px] shrink-0 rounded-[8px] bg-catFail text-[12px] font-medium text-card shadow-sm transition duration-base ease-out hover:brightness-105 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        {t('common.retry')}
      </button>
    </div>
  )
}

export function OfflineBanner() {
  const t = useT()
  return (
    <div className="flex h-[40px] items-center rounded-btn border border-brd/80 bg-brd/70 pl-4 backdrop-blur-sm animate-scale-in">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-t2">
        <WifiOff size={13} strokeWidth={2} />
        {t('home.banner.offline')}
      </span>
    </div>
  )
}

export function RefreshIndicator() {
  const t = useT()
  return (
    <div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-brd">
        <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-pri/60 to-pri animate-indeterminate" />
      </div>
      <p className="mt-1 text-center text-[11px] font-medium text-pri">{t('home.banner.refresh')}</p>
    </div>
  )
}
