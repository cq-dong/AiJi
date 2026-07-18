import type { AppUpdatePort, DownloadProgress, UpdateInfo } from '@/ports'
import { fetchLatestRelease, compareSemver } from './appUpdateShared'
import { ApkInstaller } from './apkInstallerPlugin'
import type { PluginListenerHandle } from '@capacitor/core'

// Android 原生壳实现：checkForUpdate 与 web 共享内核（fetch api.github.com 带 CORS）；
// downloadAndInstall 调原生 ApkInstaller 插件——HttpURLConnection 下载 APK 到 cache，
// FileProvider 取 content:// 后拉起系统安装器。绕过 assets.githubusercontent.com 的 CORS。
//
// 下载进度：onProgress 提供时注册 "downloadProgress" 监听器，原生侧每 64KB/1% 上报一次；
// promise resolve/reject 后 removeAllListeners 清理，避免 listener 泄漏累积致内存涨。
export const capacitorAppUpdate: AppUpdatePort = {
  async checkForUpdate(): Promise<UpdateInfo> {
    const current = __APP_VERSION__
    const latest = await fetchLatestRelease()
    if (!latest) {
      return { current, latest: '—', hasUpdate: false }
    }
    const hasUpdate = compareSemver(latest.version, current) > 0
    return {
      current,
      latest: latest.version,
      hasUpdate,
      apkUrl: latest.apkUrl,
      releaseUrl: latest.releaseUrl,
      releaseNotes: latest.releaseNotes,
      prerelease: latest.prerelease,
    }
  },
  async downloadAndInstall(
    info: UpdateInfo,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<void> {
    if (!info.apkUrl) {
      // 当前 release 无 .apk 资产（可能只有源码包）→ 回退浏览器打 release 页。
      const url = info.releaseUrl ?? 'https://github.com/cq-dong/AiJi/releases/latest'
      window.open(url, '_blank', 'noopener')
      return
    }
    // 有回调才注册 listener——无回调走原路径，避免空 listener 累积。
    let handle: PluginListenerHandle | undefined
    if (onProgress) {
      handle = await ApkInstaller.addListener('downloadProgress', (p) => {
        onProgress({ received: p.received, total: p.total, percent: p.percent })
      })
    }
    try {
      await ApkInstaller.downloadAndInstall({ url: info.apkUrl })
    } finally {
      // 无论 resolve/reject 都清理 listener，防止重复下载时旧 listener 残留误触发。
      if (handle) await handle.remove()
      await ApkInstaller.removeAllListeners()
    }
  },
}
