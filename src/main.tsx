import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from '@/app/query'
import { useUiStore } from '@/app/store'

// 启动即从 Dexie 载入真实条目（首屏空库由 adapter 灌 seed）；fire-and-forget，store 解析后自替换。
void useUiStore.getState().hydrate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
