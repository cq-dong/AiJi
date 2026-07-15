import { Outlet } from 'react-router-dom'
import { Fab, NavBottom, Statusbar } from '@/ui/components'

// 主 tab 层：状态栏 + 内容 + 采集 FAB + 底部导航
export function MainLayout() {
  return (
    <div className="aji-frame flex flex-col bg-page">
      <Statusbar />
      <main className="flex-1 overflow-y-auto pb-[100px]">
        <Outlet />
      </main>
      <Fab />
      <NavBottom />
    </div>
  )
}

// 裸层（采集 / 详情 / Onboarding）：状态栏 + 内容，无导航无 FAB
export function BareLayout() {
  return (
    <div className="aji-frame flex flex-col bg-page">
      <Statusbar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
