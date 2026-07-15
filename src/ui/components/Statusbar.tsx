export function Statusbar() {
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
