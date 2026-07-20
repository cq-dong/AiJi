import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { readFileSync } from 'node:fs'

export default defineConfig({
  // 版本单一真源 = package.json version。config 时 Node 端 readFileSync 读出，
  // define 烘焙成运行时常量 __APP_VERSION__——app 内无需 fetch 自报版本，
  // About sheet 与 GitHub Release tag 比对以此为准（不依赖原生 App.getInfo，
  // 后者可能与 package.json 漂移）。JSON.stringify 保证注入是合法字符串字面量。
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')).version,
    ),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // D38: 不自动注入 SW 注册脚本（原 'auto' 会把脚本写进 index.html，原生壳无法
      // 条件跳过 → 与 main.tsx 的 native unregister 竞态，SW 会被重注册回控页面）。
      // 改为 main.tsx 手动注册：web (PROD) 注册 SW 走离线缓存；原生壳跳过注册 +
      // 注销存量 SW，每次从 APK 文件系统加载最新 bundle（修更新后首启显旧版 bug）。
      injectRegister: false,
      manifest: {
        name: 'AiJi · AI 记',
        short_name: 'AiJi',
        description: '通用的「记」的工具',
        // 与 meta theme-color (#f7f7fa) + background_color 对齐 —— 原此处 #4f46e5 与 meta 不一致（minor）。
        theme_color: '#f7f7fa',
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
