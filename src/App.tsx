import { useEffect } from 'react'
import { AppRouter } from '@/app/router'
import { useUiStore } from '@/app/store'

function App() {
  const theme = useUiStore((s) => s.settings.theme)
  // A1: 应用主题到 documentElement —— 原 setSettings({theme}) 只更 store+Dexie，DOM 无 classList /
  // tailwind 无 darkMode → 切换 no-op。token 走 CSS 变量（index.css :root/.dark），此处只 toggle .dark。
  useEffect(() => {
    const root = document.documentElement
    const apply = (dark: boolean) => root.classList.toggle('dark', dark)
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches)
      const onChange = (e: MediaQueryListEvent) => apply(e.matches)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    apply(theme === 'dark')
  }, [theme])
  return <AppRouter />
}

export default App
