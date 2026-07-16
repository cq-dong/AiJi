import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { BareLayout, MainLayout } from '@/ui/layout/AppShell'
import { Spinner } from '@/ui/components'
import { useUiStore } from '@/app/store'

const Home = lazy(() => import('@/ui/screens/home'))
const Categories = lazy(() => import('@/ui/screens/categories'))
const Summary = lazy(() => import('@/ui/screens/summary'))
const Search = lazy(() => import('@/ui/screens/search'))
const Settings = lazy(() => import('@/ui/screens/settings'))
const Reminders = lazy(() => import('@/ui/screens/reminders'))
const Capture = lazy(() => import('@/ui/screens/capture'))
const Detail = lazy(() => import('@/ui/screens/detail'))
const Onboarding = lazy(() => import('@/ui/screens/onboarding'))
const Drafts = lazy(() => import('@/ui/screens/drafts'))
const Trash = lazy(() => import('@/ui/screens/trash'))

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size={28} />
    </div>
  )
}

// A2: 首次运行 gating。hydrate 完成后若未 onboarding 过且不在 /onboarding → 重定向。
// hydrate 前不重定向（seed.onboarded=false 会误闪 onboarding，hydrate 后存量用户行 onboarded
// 若缺也视作未完成——引入 gating 的预期是存量用户首次也见一次 onboarding）。
function OnboardingGate({ children }: { children: ReactNode }) {
  const hydrated = useUiStore((s) => s.hydrated)
  const onboarded = useUiStore((s) => s.settings.onboarded)
  const location = useLocation()
  if (hydrated && !onboarded && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <>{children}</>
}

export function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
      <OnboardingGate>
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
          <Route path="drafts" element={<Drafts />} />
          <Route path="trash" element={<Trash />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </OnboardingGate>
    </Suspense>
  )
}
