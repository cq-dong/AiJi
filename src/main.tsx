import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from '@/app/query'
import { useUiStore } from '@/app/store'
import { seedDevDefaults } from '@/app/devSeed'

// DEV-only：从 .env.local（gitignored）灌 BYOK 默认到 localStorage+Dexie，再 hydrate——
// 手机走隧道加载同一 bundle 即自动拿到 key，免每台设备手填。seed 失败不阻断载入。
void seedDevDefaults()
  .catch((e) => console.error('[devSeed] failed', e))
  .finally(() => useUiStore.getState().hydrate())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
