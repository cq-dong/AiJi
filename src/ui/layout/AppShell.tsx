import { Outlet, useNavigate } from 'react-router-dom'
import { Search, Sparkles } from 'lucide-react'
import { Fab, NavBottom, Statusbar } from '@/ui/components'

// Wave 3: 顶栏搜索入口（搜索从底栏移出，放大镜置顶，点击进 /search）。
// AI Chat（纯读检索）：问 AI 入口置顶，点击进 /chat。
function TopBar() {
  const navigate = useNavigate()
  return (
    <div className="flex h-9 shrink-0 items-center justify-end gap-2 px-4">
      <button
        type="button"
        onClick={() => navigate('/chat')}
        className="flex h-8 items-center gap-1 rounded-full bg-priS px-3 text-[12px] font-medium text-pri active:opacity-70"
      >
        <Sparkles size={14} strokeWidth={2} />
        问 AI
      </button>
      <button
        type="button"
        onClick={() => navigate('/search')}
        aria-label="搜索"
        className="flex size-8 items-center justify-center rounded-full text-t2 active:bg-page"
      >
        <Search size={20} strokeWidth={2} />
      </button>
    </div>
  )
}

// 主 tab 层：状态栏 + 顶栏(搜索) + 内容 + 采集 FAB + 底部导航
export function MainLayout() {
  return (
    <div className="aji-frame flex flex-col bg-page">
      <Statusbar />
      <TopBar />
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
