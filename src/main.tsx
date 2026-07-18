import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from '@/app/query'
import { useUiStore } from '@/app/store'
import { useAccountStore } from '@/app/accountStore'
import { seedDevDefaults } from '@/app/devSeed'
import { initReminderFire } from '@/app/reminderFire'

// Slice A: 账号身份从 localStorage 同步载入（快，无 I/O）。AccountGate 判定前 hydrated 须为 true。
useAccountStore.getState().hydrate()

// DEV-only：从 .env.local（gitignored）灌 BYOK 默认到 localStorage+Dexie，再 hydrate——
// 手机走隧道加载同一 bundle 即自动拿到 key，免每台设备手填。seed 失败不阻断载入。
void seedDevDefaults()
  .catch((e) => console.error('[devSeed] failed', e))
  .finally(() => useUiStore.getState().hydrate())

// D20: 提醒到点「弹窗+声音」初始化——注册原生 LocalNotifications listener + web
// webNotify handler + audio unlock。必须在 React render 前注册，保证 whole-app
// 生命周期有效（监听器不依赖 React 挂载）。
initReminderFire()

// online 接 navigator.onLine + 事件。store.online 之前恒 true（setOnline 零调用），
// chat 离线禁用 + reminders 离线·待补跑都依赖它。此处正本清源，全模块受益。
useUiStore.getState().setOnline(navigator.onLine)
window.addEventListener('online', () => useUiStore.getState().setOnline(true))
window.addEventListener('offline', () => useUiStore.getState().setOnline(false))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
