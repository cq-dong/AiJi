import { Capacitor } from '@capacitor/core'

// D2: 真机（Capacitor 原生）已有系统状态栏，App 内模拟层冗余 → 不渲染；
// PWA 浏览器环境（无系统状态栏）保留模拟层用于还原 390×844 原型视感。
export function Statusbar() {
  if (Capacitor.isNativePlatform()) return null
  return (
    <div className="flex h-11 shrink-0 items-center justify-between px-6 pt-1 text-ink">
      <span className="text-[15px] font-medium tabular-nums">9:41</span>
      <div className="flex items-center gap-1 text-[11px] font-medium text-t2">
        <span>●●● 5G</span>
        <span className="ml-1">▮▮▮▮ 100%</span>
      </div>
    </div>
  )
}
