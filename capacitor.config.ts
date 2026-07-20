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
  // CapacitorHttp：不启用 enabled:true（默认 false）。
  // appUpdateShared 的更新检查直接调 CapacitorHttp.get() helper——helper 无论 enabled
  // 与否都可用，直接走原生 OkHttp（自带 UA + 绕 CORS），不依赖全局 fetch patch。
  // 实测 enabled:true 会全局 patch window.fetch/XMLHttpRequest，反而在部分设备引入
  // 回归（rc14 报 403，rc13 helper 直调正常）。保持默认 false，只用 helper 路径最稳。
};

export default config;
