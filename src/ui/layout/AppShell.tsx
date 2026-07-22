import { Outlet, useNavigate } from 'react-router-dom'
import { Search, Sparkles } from 'lucide-react'
import { Fab, FiringReminderPopup, NavBottom, ReminderPopup, Statusbar } from '@/ui/components'
import { useT } from '@/app/i18n/useT'

// Wave 3: 顶栏搜索入口（搜索从底栏移出，放大镜置顶，点击进 /search）。
// AI Chat（纯读检索）：问 AI 入口置顶，点击进 /chat。
function TopBar() {
  const navigate = useNavigate()
  const t = useT()
  return (
    <div className="flex h-10 shrink-0 items-center justify-end gap-2 px-4">
      <button
        type="button"
        onClick={() => navigate('/chat')}
        className="flex h-8 items-center gap-1.5 rounded-full border border-pri/15 bg-priS px-3.5 text-[12px] font-medium text-pri shadow-sm transition-all duration-base ease-out hover:border-pri/25 active:scale-95"
      >
        <Sparkles size={14} strokeWidth={2.2} />
        {t('comp.topbar.askAi')}
      </button>
      <button
        type="button"
        onClick={() => navigate('/search')}
        aria-label={t('nav.search')}
        className="flex size-8 items-center justify-center rounded-full border border-brd/80 bg-card text-t2 shadow-sm transition-all duration-base ease-out hover:text-ink active:scale-90"
      >
        <Search size={17} strokeWidth={2.2} />
      </button>
    </div>
  )
}

// 主 tab 层：状态栏 + 顶栏(搜索) + 内容 + 采集 FAB + 底部导航
export function MainLayout() {
  return (
    <div
      className="aji-frame flex flex-col bg-page"
      // D1/D2: 顶部留系统状态栏高度。Android WebView 不支持 env(safe-area-inset-*)（iOS 特性），
      // MainActivity 在原生层把 systemBars.top 注入为 --safe-top；PWA fallback 0（由 Statusbar 模拟层占位）。
      style={{ paddingTop: 'var(--safe-top, 0px)' }}
    >
      <Statusbar />
      <TopBar />
      {/* D11: 内容区底部留 NavBottom(79) + safe-bottom 的空间，与 NavBottom 等高消除灰带。
          --safe-bottom 由 MainActivity 注入，PWA fallback 0。 */}
      <main
        className="aji-frame-main flex-1 overflow-y-auto"
        style={{ paddingBottom: 'calc(79px + var(--safe-bottom, 0px))' }}
      >
        <Outlet />
      </main>
      <Fab />
      <NavBottom />
      <ReminderPopup />
      {/* D20: 到点触发的前台弹窗（全生命周期，主路由+裸路由都挂） */}
      <FiringReminderPopup />
    </div>
  )
}

// 裸层（采集 / 详情 / Onboarding）：状态栏 + 内容，无导航无 FAB
export function BareLayout() {
  return (
    <div
      className="aji-frame flex flex-col bg-page"
      style={{ paddingTop: 'var(--safe-top, 0px)' }}
    >
      <Statusbar />
      {/* D1: 裸层内容区底部留安全区空间，避免采集页底部操作 / 详情页底部按钮被系统导航栏遮挡。 */}
      <main
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: 'var(--safe-bottom, 0px)' }}
      >
        <Outlet />
      </main>
      {/* D20: 到点弹窗在裸路由也生效（用户可能在采集/详情页时提醒到点） */}
      <FiringReminderPopup />
    </div>
  )
}
