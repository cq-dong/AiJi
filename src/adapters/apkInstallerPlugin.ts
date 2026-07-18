import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// 自定义 Capacitor 插件 ApkInstaller 的 TS 绑定。原生侧（ApkInstallerPlugin.java）
// 实现 downloadAndInstall：HttpURLConnection 下载 APK 到 app cache → FileProvider 取 content://
// → ACTION_VIEW + application/vnd.android.package-archive 拉起系统安装器。
//
// 为什么自定义而不在 WebView 里 fetch APK：GitHub release 资产下载经
// github.com→objects.githubusercontent.com 重定向，后者不发 CORS 头，WebView fetch
// 必失败；原生 HttpURLConnection 不受 CORS 限，且避免大文件 base64 膨胀内存。
//
// 下载进度：原生侧在下载循环里 notifyListeners("downloadProgress", {received,total,percent})；
// JS 侧 addListener 监听并转发给 UI 层（capacitorAppUpdate 适配器注册 + 清理）。
// total = -1 表示服务端未返回 Content-Length（percent 同样 -1，UI 仅显示已下载字节数）。
//
// web impl：PWA 不需要此插件（PWA 靠 SW 自更新），调到直接抛错（PWA 走 webAppUpdate
// 的 window.open 分支，根本不会调到这里——此抛错只是兜底防误调）。
export interface ApkInstallerPlugin {
  downloadAndInstall(opts: { url: string }): Promise<void>
  addListener(
    eventName: 'downloadProgress',
    listener: (p: { received: number; total: number; percent: number }) => void,
  ): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

export const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller', {
  web: {
    async downloadAndInstall() {
      throw new Error('APK 安装仅在 Android 原生壳内可用')
    },
  },
})
