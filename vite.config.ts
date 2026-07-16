import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'AiJi · AI 记',
        short_name: 'AiJi',
        description: '通用的「记」的工具',
        theme_color: '#4f46e5',
        background_color: '#f7f7fa',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    // '@/' key (not bare '@') so scoped npm packages like @tanstack are untouched.
    alias: { '@/': `${path.resolve(process.cwd(), 'src')}/` },
  },
  // allowedHosts: 允许 cloudflared/ngrok 隧道随机子域（手机 HTTPS 真机测试用）。
  // true = 放行所有 Host 头（仅影响 vite dev/preview，不影响 build 产物）。
  server: { host: true, port: 5173, allowedHosts: true },
})
