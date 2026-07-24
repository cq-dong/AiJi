import { useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { Search, Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
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

// 页面转场：按 pathname key 重挂内容，入场 fade+rise（enter-only）。
// 无 exit——旧屏瞬切新屏淡入，换来 main 滚动语义不变（tab 往返不丢滚动位）；
// 跨 layout（主↔裸）整树重挂，新 layout 入场动画同样生效。reduced-motion 瞬切。
function PageTransition() {
  const location = useLocation()
  const outlet = useOutlet()
  const reduce = useReducedMotion()
  return (
    // h-full 承重：无高包裹会让下游 h-full/min-h-full 屏（capture/chat/detail/
    // onboarding/login）高度链断裂——footer 漂中、absolute 全屏层塌 0、内部滚动失效。
    // 对流式长内容屏（home 等），h-full+overflow:visible 不影响 main 滚动。
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
      className="h-full"
    >
      {outlet}
    </motion.div>
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
          --safe-bottom 由 MainActivity 注入，PWA fallback 0。
          overscroll-behavior: 拦 Android Chrome 原生下拉刷新/过度滚动辉光（home 自实现 PTR）。 */}
      <main
        className="aji-frame-main flex-1 overflow-y-auto overscroll-behavior-y-contain"
        style={{ paddingBottom: 'calc(79px + var(--safe-bottom, 0px))' }}
      >
        <PageTransition />
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
        className="flex-1 overflow-y-auto overscroll-behavior-y-contain"
        style={{ paddingBottom: 'var(--safe-bottom, 0px)' }}
      >
        <PageTransition />
      </main>
      {/* D20: 到点弹窗在裸路由也生效（用户可能在采集/详情页时提醒到点） */}
      <FiringReminderPopup />
    </div>
  )
}
