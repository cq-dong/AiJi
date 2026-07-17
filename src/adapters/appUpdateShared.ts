// checkForUpdate 的平台无关内核：fetch GitHub Releases API + semver 比较。
// 两适配器（web/capacitor）共享——只是 downloadAndInstall 走向不同。
//
// GitHub API：GET https://api.github.com/repos/{owner}/{repo}/releases/latest
// 公开仓免鉴权 + 带 Access-Control-Allow-Origin: *，WebView 里能直连 fetch。
// 注意：版本检查走 api.github.com（CORS 开）；APK 资产下载在 github.com→objects.githubusercontent.com
// 重定向，CORS 不开——所以下载必须走原生插件，不能在 WebView 里 fetch。

export const GITHUB_OWNER = 'cq-dong'
export const GITHUB_REPO = 'AiJi'
const API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

type GithubAsset = { name: string; browser_download_url: string }
type GithubRelease = {
  tag_name?: string
  body?: string
  html_url?: string
  assets?: GithubAsset[]
  message?: string // API error body, e.g. "Not Found" when no release yet
}

export interface LatestRelease {
  version: string // tag_name 去 v 前缀
  apkUrl?: string // 第一个 .apk 资产直链
  releaseUrl: string // release 页（fallback）
  releaseNotes?: string
}

// 抓最新 release。无 release（404 "Not Found"）时返 null——首发前 About sheet 显示「尚未发布」。
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const res = await fetch(API_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    // GitHub API 无鉴权有速率限制（60/h/IP），About sheet 手动触发检查，非轮询，够用。
    cache: 'no-store',
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`)
  }
  const data = (await res.json()) as GithubRelease
  const tag = data.tag_name ?? ''
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  if (!version) return null
  const apk = data.assets?.find((a) => a.name.endsWith('.apk'))
  return {
    version,
    apkUrl: apk?.browser_download_url,
    releaseUrl: data.html_url ?? RELEASES_PAGE,
    releaseNotes: data.body?.trim() || undefined,
  }
}

// major.minor.patch 数值比较。MVP 不处理 prerelease（-beta 等）——tag 都是正式版。
// 返回：>0 a 新于 b，<0 a 旧于 b，0 相等。非数字段当 0。
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0)
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  return 0
}
