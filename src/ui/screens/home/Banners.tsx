// 首页顶部瞬态横幅：刚保存 toast / 处理失败 / 离线 / 刷新中
// 对应 Figma 38:60 / 38:184 / 38:247 / 38:123-125

export function JustSavedToast() {
  return (
    <div className="flex h-[44px] items-center justify-between rounded-btn border border-pri bg-priS px-[19px]">
      <span className="text-[13px] font-medium text-pri">✓ 已保存 · AI 正在分类…</span>
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
  return (
    <div className="flex h-[56px] items-center rounded-btn border border-[#e56666] bg-[#fff2f2] pl-[19px] pr-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[#e56666]">AI 处理失败</p>
        <p className="text-[11px] text-t3">网络或模型异常，原始条目已保存</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="h-[30px] w-[88px] shrink-0 rounded-[8px] bg-[#e56666] text-[12px] font-medium text-white active:scale-[0.98]"
      >
        重试
      </button>
    </div>
  )
}

export function OfflineBanner() {
  return (
    <div className="flex h-[40px] items-center rounded-btn bg-brd pl-5">
      <span className="text-[12px] font-medium text-t2">◎ 离线 · 待联网补跑</span>
    </div>
  )
}

export function RefreshIndicator() {
  return (
    <div>
      <div className="h-[3px] w-full overflow-hidden rounded-[2px] bg-brd">
        <div className="h-full w-[42%] rounded-[2px] bg-pri" />
      </div>
      <p className="mt-1 text-center text-[11px] font-medium text-pri">AI 已分类 · 正在刷新</p>
    </div>
  )
}
