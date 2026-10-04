import { useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { Search, Sparkles } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Fab, FiringReminderPopup, NavBottom, ReminderPopup, Statusbar, Toast } from '@/ui/components'
import { useT } from '@/app/i18n/useT'
import { useUiStore } from '@/app/store'

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
function PageTransition({ bottomPad }: { bottomPad: string }) {
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
      {/* 底部垫层承重（必须在 motion.div 内、跟随内容流）：main 的 padding-bottom
          在「h-full 包裹 + 内容溢出传播」路径下被 Chrome 从 scrollable overflow
          丢弃（实测 scrollHeight 不含 padding）→ 长内容最后一块沉到 NavBottom 下。
          垫层在内容流末尾占位，滚到底时最后真实内容恰好停在导航上方；h-full 屏
          （capture/chat/detail）root=内容盒高，垫层+root 恰填满 main，不多出滚动。 */}
      <div aria-hidden style={{ height: bottomPad }} />
    </motion.div>
  )
}

// 主路由内容底部净空：NavBottom(79) + FAB 悬浮区 + 余量。
// m3 修复：FAB 默认悬浮于 bottom 93（= 79 导航 + 14 间距）、高 56 → 顶沿距 frame 底 149px。
// 底部净空若只留导航高(79)，滚到底时末行 trailing 内容（设置「关于 AiJi」版本号等）
// 恰好压在 FAB 下且无法再滚动露出（390×844 实测）。净空 = 149 + 12 余量 = 161，
// 也覆盖 FAB 可拖拽的最低位（底沿贴导航 = 135）——一处改，全主路由滚到底都不被 FAB 遮。
const MAIN_BOTTOM_CLEARANCE = 'calc(161px + var(--safe-bottom, 0px))'

// A1 ②（2026-10-05）：硬件返回键「再按一次退出」Toast——仿 FiringReminderPopup 模式，
// MainLayout + BareLayout 共享此私有组件（不导出）。exitArmed 由 a1-app 加进 UiState；
// backButton.ts 首页首按 armed=true（2s 窗）→ 本 Toast 可见。Toast 3.5s 自消 vs 2s 武装窗
// 的 1.5s 视觉尾巴无害（窗外再按只重置武装不退出），契约 §范围② 记录在案不另做。
function ExitToast() {
  const t = useT()
  const exitArmed = useUiStore((s) => s.exitArmed)
  return (
    <AnimatePresence>
      {exitArmed && (
        <Toast
          message={t('common.exitConfirm')}
          ok
          onDismiss={() => useUiStore.setState({ exitArmed: false })}
        />
      )}
    </AnimatePresence>
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
      {/* D11: 内容区底部留 NavBottom + FAB 净空 + safe-bottom 的空间（见 MAIN_BOTTOM_CLEARANCE）。
          --safe-bottom 由 MainActivity 注入，PWA fallback 0。
          overscroll-behavior: 拦 Android Chrome 原生下拉刷新/过度滚动辉光（home 自实现 PTR）。 */}
      <main
        className="aji-frame-main flex-1 overflow-y-auto overscroll-behavior-y-contain"
        style={{ paddingBottom: MAIN_BOTTOM_CLEARANCE }}
      >
        <PageTransition bottomPad={MAIN_BOTTOM_CLEARANCE} />
      </main>
      <Fab />
      <NavBottom />
      <ReminderPopup />
      {/* D20: 到点触发的前台弹窗（全生命周期，主路由+裸路由都挂） */}
      <FiringReminderPopup />
      {/* A1 ②: 首页双击退出 Toast（主路由） */}
      <ExitToast />
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
      {/* D1: 裸层内容区底部留安全区空间，避免采集页底部操作 / 详情页底部按钮被系统导航栏遮挡。
          A1 ①：paddingBottom 升级为 max(--safe-bottom, --safe-ime)——软键盘顶起时 in-flow
          底部输入面（chat composer / capture 文本区+浮动操作条 / detail 底部按钮）随 main
          内缩顶起不被遮。--safe-ime 由 MainActivity 注入（键盘收起报 0 天然回落），
          web 端缺省 0 → 零行为变化。 */}
      <main
        className="flex-1 overflow-y-auto overscroll-behavior-y-contain"
        style={{ paddingBottom: 'max(var(--safe-bottom, 0px), var(--safe-ime, 0px))' }}
      >
        <PageTransition bottomPad="max(var(--safe-bottom, 0px), var(--safe-ime, 0px))" />
      </main>
      {/* D20: 到点弹窗在裸路由也生效（用户可能在采集/详情页时提醒到点） */}
      <FiringReminderPopup />
      {/* A1 ②: 首页双击退出 Toast（裸路由——采集/详情/chat 页 exitArmed 同样可见） */}
      <ExitToast />
    </div>
  )
}
