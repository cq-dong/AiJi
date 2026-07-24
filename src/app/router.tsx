import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { BareLayout, MainLayout } from '@/ui/layout/AppShell'
import { Spinner } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useAccountStore } from '@/app/accountStore'
import { deviceOnboarded } from '@/app/onboardedFlag'

const Home = lazy(() => import('@/ui/screens/home'))
const Categories = lazy(() => import('@/ui/screens/categories'))
const Summary = lazy(() => import('@/ui/screens/summary'))
const Search = lazy(() => import('@/ui/screens/search'))
const Settings = lazy(() => import('@/ui/screens/settings'))
const Reminders = lazy(() => import('@/ui/screens/reminders'))
const Capture = lazy(() => import('@/ui/screens/capture'))
const Detail = lazy(() => import('@/ui/screens/detail'))
const Onboarding = lazy(() => import('@/ui/screens/onboarding'))
const Login = lazy(() => import('@/ui/screens/login'))
const Drafts = lazy(() => import('@/ui/screens/drafts'))
const Trash = lazy(() => import('@/ui/screens/trash'))
const Chat = lazy(() => import('@/ui/screens/chat'))
const Feedback = lazy(() => import('@/ui/screens/feedback'))

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size={28} />
    </div>
  )
}

// A2: 首次运行 gating（OnboardingGate 在最外层，先于 AccountGate）。hydrate 完成后若未
// onboarding 过且不在 /onboarding → 重定向 /onboarding。意图：首次先看功能引导，完成后
// 才轮到账号 gating。hydrate 前不重定向（seed.onboarded=false 会误闪）。
// 放过 /login：onboarding 完成后若无 account，AccountGate 会导向 /login；此处若也把
// /login→/onboarding 会与 AccountGate 形成死循环（/login↔/onboarding）致空白。
function OnboardingGate({ children }: { children: ReactNode }) {
  const hydrated = useUiStore((s) => s.hydrated)
  const storeOnboarded = useUiStore((s) => s.settings.onboarded)
  const location = useLocation()
  // 设备级标志兜底：游客/新账号 rehydrate 重置 per-owner settings.onboarded 时，
  // 设备已看过引导则不再重复弹 onboarding。
  const onboarded = storeOnboarded || deviceOnboarded.get()
  if (hydrated && !onboarded && location.pathname !== '/onboarding' && location.pathname !== '/login') {
    return <Navigate to="/onboarding" replace />
  }
  return <>{children}</>
}

// Slice A: 账号 gating（内层，OnboardingGate 之后）。hydrate 完成后若无 account 且不在
// /login → 重定向 /login。放过 /onboarding：首次未 onboarding 时 OnboardingGate 已导向
// /onboarding，此处须放行让 onboarding 页在无 account 下也能渲染，否则 /onboarding→/login 死循环。
function AccountGate({ children }: { children: ReactNode }) {
  const hydrated = useAccountStore((s) => s.hydrated)
  const account = useAccountStore((s) => s.account)
  const location = useLocation()
  if (hydrated && !account && location.pathname !== '/login' && location.pathname !== '/onboarding') {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
      <OnboardingGate>
        <AccountGate>
          <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<Home />} />
          <Route path="categories" element={<Categories />} />
          <Route path="summary" element={<Summary />} />
          <Route path="search" element={<Search />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route element={<BareLayout />}>
          <Route path="capture" element={<Capture />} />
          <Route path="detail/:id" element={<Detail />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="login" element={<Login />} />
          <Route path="drafts" element={<Drafts />} />
          <Route path="trash" element={<Trash />} />
          <Route path="chat" element={<Chat />} />
          <Route path="feedback" element={<Feedback />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </AccountGate>
      </OnboardingGate>
    </Suspense>
  )
}
