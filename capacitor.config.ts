import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cqdong.aiji',
  appName: 'AiJi',
  webDir: 'dist',
  // androidScheme: https → WebView 走 https://localhost，secure context。
  // getUserMedia / IndexedDB / crypto.subtle / OPFS 在 WebView 里均要求 secure context，
  // http://localhost 在部分 WebView 上不算 secure，https 最稳。
  server: {
    androidScheme: 'https',
  },
  // D31: 启用 CapacitorHttp 原生网络层。应用内更新检查走 api.github.com，Android
  // WebView 的 fetch 缺可被 GitHub 接受的 User-Agent → 403（User-Agent 是浏览器 fetch
  // forbidden header，加头被静默剥）。CapacitorHttp 走原生 OkHttp 自带 UA + 绕 CORS。
  // Capacitor 8 默认不启用，须显式 enabled: true（否则 appUpdateShared 的
  // CapacitorHttp.get 在原生层 no-op，回退 fetch 仍 403）。
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
