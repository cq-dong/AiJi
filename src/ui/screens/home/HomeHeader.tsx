// 首页头部：「记」标题 + 日期摘要 + 头像环（右上角）
// 对应 Figma 1:6 / 1:7 / 1:8-10

import { useT } from '@/app/i18n/useT'

export function AvatarRing() {
  const t = useT()
  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-priS to-priS/60 ring-1 ring-pri/15 shadow-sm">
      <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-b from-pri to-pri/85 shadow-glowPriSm">
        <span className="text-[15px] font-medium text-white">{t('comp.avatar.me')}</span>
      </div>
    </div>
  )
}

interface HeaderProps {
  topDateLabel: string
  todayCount: number
}

export function HomeHeader({ topDateLabel, todayCount }: HeaderProps) {
  const t = useT()
  return (
    <header className="flex items-start justify-between animate-fade-in-up">
      <div>
        <h1 className="text-[34px] font-bold leading-none tracking-[-0.01em] text-ink">{t('home.title')}</h1>
        <p className="mt-[8px] flex items-center gap-1.5 text-[13px] text-t3">
          <span>{topDateLabel}</span>
          <span aria-hidden="true" className="inline-block size-[3px] rounded-full bg-t3/50" />
          <span>{t('date.today')} <span className="font-medium tabular-nums text-t2">{todayCount}</span> {t('home.header.unit')}</span>
        </p>
      </div>
      <AvatarRing />
    </header>
  )
}
