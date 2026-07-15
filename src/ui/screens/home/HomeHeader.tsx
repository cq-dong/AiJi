// 首页头部：「记」标题 + 日期摘要 + 头像环（右上角）
// 对应 Figma 1:6 / 1:7 / 1:8-10

export function AvatarRing() {
  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-brd">
      <div className="flex size-9 items-center justify-center rounded-full bg-pri">
        <span className="text-[15px] font-medium text-white">我</span>
      </div>
    </div>
  )
}

interface HeaderProps {
  topDateLabel: string
  todayCount: number
}

export function HomeHeader({ topDateLabel, todayCount }: HeaderProps) {
  return (
    <header className="flex items-start justify-between">
      <div>
        <h1 className="text-[34px] font-bold leading-none text-ink">记</h1>
        <p className="mt-[8px] text-[13px] text-t3">
          {topDateLabel} · 今天 {todayCount} 条
        </p>
      </div>
      <AvatarRing />
    </header>
  )
}
