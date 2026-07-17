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
};

export default config;
