// 首页顶部瞬态横幅：刚保存 toast / 处理失败 / 离线 / 刷新中
// 对应 Figma 38:60 / 38:184 / 38:247 / 38:123-125

import { Check, WifiOff } from 'lucide-react'

export function JustSavedToast() {
  return (
    <div className="flex h-[44px] items-center justify-between rounded-btn border border-pri bg-priS px-[19px]">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-pri"><Check size={14} strokeWidth={2.5} />已保存 · AI 正在分类…</span>
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
    <div className="flex h-[56px] items-center rounded-btn border border-catFail/30 bg-catFail/10 pl-[19px] pr-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-catFail">AI 处理失败</p>
        <p className="text-[11px] text-t3">网络或模型异常，原始条目已保存</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="h-[30px] w-[88px] shrink-0 rounded-[8px] bg-catFail text-[12px] font-medium text-card transition duration-base ease-out active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        重试
      </button>
    </div>
  )
}

export function OfflineBanner() {
  return (
    <div className="flex h-[40px] items-center rounded-btn bg-brd pl-5">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-t2"><WifiOff size={13} strokeWidth={2} />离线 · 待联网补跑</span>
    </div>
  )
}

export function RefreshIndicator() {
  return (
    <div>
      <div className="h-[3px] w-full overflow-hidden rounded-[2px] bg-brd">
        <div className="h-full w-2/5 rounded-[2px] bg-pri animate-indeterminate" />
      </div>
      <p className="mt-1 text-center text-[11px] font-medium text-pri">AI 已分类 · 正在刷新</p>
    </div>
  )
}
