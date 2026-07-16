import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { BareLayout, MainLayout } from '@/ui/layout/AppShell'
import { Spinner } from '@/ui/components'

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

export function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
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
    </Suspense>
  )
}
