import type { AppUpdatePort, UpdateInfo } from '@/ports'
import { fetchLatestRelease, compareSemver } from './appUpdateShared'

// PWA 实现：checkForUpdate 走 fetch（平台无关内核）；downloadAndInstall 跳浏览器
// 打开 release 页——PWA 本身靠 vite-plugin-pwa 的 SW autoUpdate 自更新，APK 下载
// 这条路对 web 用户只是「手动下 APK 装到安卓」的引导，不是 web 自身更新。
export const webAppUpdate: AppUpdatePort = {
  async checkForUpdate(): Promise<UpdateInfo> {
    const current = __APP_VERSION__
    const latest = await fetchLatestRelease()
    if (!latest) {
      // 首发 release 尚未发布。About sheet 显示「尚未发布版本」。
      return { current, latest: '—', hasUpdate: false, releaseUrl: undefined }
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
  async downloadAndInstall(info: UpdateInfo): Promise<void> {
    // web 上无法直接装 APK——跳 release 页让用户手动下（典型场景：用户在 PC 上看，
    // 扫码到手机装）。PWA 自身的更新由 SW autoUpdate 负责，不经此端口。
    const url = info.releaseUrl ?? `https://github.com/cq-dong/AiJi/releases/latest`
    window.open(url, '_blank', 'noopener')
  },
}
