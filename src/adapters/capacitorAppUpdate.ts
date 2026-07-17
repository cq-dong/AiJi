import type { AppUpdatePort, UpdateInfo } from '@/ports'
import { fetchLatestRelease, compareSemver } from './appUpdateShared'
import { ApkInstaller } from './apkInstallerPlugin'

// Android 原生壳实现：checkForUpdate 与 web 共享内核（fetch api.github.com 带 CORS）；
// downloadAndInstall 调原生 ApkInstaller 插件——HttpURLConnection 下载 APK 到 cache，
// FileProvider 取 content:// 后拉起系统安装器。绕过 assets.githubusercontent.com 的 CORS。
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
    }
  },
  async downloadAndInstall(info: UpdateInfo): Promise<void> {
    if (!info.apkUrl) {
      // 当前 release 无 .apk 资产（可能只有源码包）→ 回退浏览器打 release 页。
      const url = info.releaseUrl ?? 'https://github.com/cq-dong/AiJi/releases/latest'
      window.open(url, '_blank', 'noopener')
      return
    }
    // 调原生插件：OkHttp 下载 + 系统安装器。插件内部已处理下载进度与安装 Intent。
    await ApkInstaller.downloadAndInstall({ url: info.apkUrl })
  },
}
