// checkForUpdate 的平台无关内核：取最新 GitHub Release + semver 比较。
// 两适配器（web/capacitor）共享——只是 downloadAndInstall 走向不同。
//
// GitHub API：GET https://api.github.com/repos/{owner}/{repo}/releases
// 用 /releases（列表，含 prerelease）而非 /releases/latest——后者排除 prerelease，
// rc 阶段 About 会误显「尚未发布」。取数组首个即最新（按创建时间倒序）。
// 公开仓免鉴权 + 带 Access-Control-Allow-Origin: *，web 上 fetch 直连可用。
//
// 平台分流（D31 GitHub API 403 修复）：
// - web：fetch（浏览器自动带 User-Agent，GitHub 接受）
// - native（Android Capacitor WebView）：WebView 的 fetch 不带 GitHub 可接受的
//   User-Agent → GitHub 返 403。改走 CapacitorHttp（原生 OkHttp，自带 UA + 绕 CORS）。
//   User-Agent 是浏览器 fetch 的 forbidden header，设了也被静默剥，所以 web 侧不能
//   靠加头修；必须原生层走 CapacitorHttp。
import { Capacitor, CapacitorHttp } from '@capacitor/core'

export const GITHUB_OWNER = 'cq-dong'
export const GITHUB_REPO = 'AiJi'
const API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=10`
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

type GithubAsset = { name: string; browser_download_url: string }
type GithubRelease = {
  tag_name?: string
  body?: string
  html_url?: string
  prerelease?: boolean
  assets?: GithubAsset[]
  message?: string // API error body, e.g. "Not Found" when no release yet
}

export interface LatestRelease {
  version: string // tag_name 去 v 前缀
  apkUrl?: string // 第一个 .apk 资产直链
  releaseUrl: string // release 页（fallback）
  releaseNotes?: string
  prerelease?: boolean
}

// 抓最新 release（含 prerelease）。无 release（空数组）时返 null——About sheet 显示「尚未发布」。
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  // GitHub API 无鉴权有速率限制（60/h/IP），About sheet 手动触发检查，非轮询，够用。
  let list: GithubRelease[]
  if (Capacitor.isNativePlatform()) {
    // 原生 WebView fetch 缺可被 GitHub 接受的 User-Agent → 403。CapacitorHttp 走原生
    // OkHttp，自带 UA 且绕 CORS。data 在 json content-type 下已自动 parse。
    const res = await CapacitorHttp.get({
      url: API_URL,
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (res.status === 404) return null
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GitHub API ${res.status}`)
    }
    const body = res.data
    list = (typeof body === 'string' ? JSON.parse(body) : body) as GithubRelease[]
  } else {
    const res = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}`)
    }
    list = (await res.json()) as GithubRelease[]
  }
  const data = list[0]
  if (!data) return null
  const tag = data.tag_name ?? ''
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  if (!version) return null
  const apk = data.assets?.find((a) => a.name.endsWith('.apk'))
  return {
    version,
    apkUrl: apk?.browser_download_url,
    releaseUrl: data.html_url ?? RELEASES_PAGE,
    releaseNotes: data.body?.trim() || undefined,
    prerelease: data.prerelease,
  }
}

// semver 比较，支持 prerelease 后缀（-rc1 / -beta.2 等）。
// 规则：major.minor.patch 数值比；相等时——有 prerelease 的旧于无 prerelease 的
// （0.1.0-rc2 < 0.1.0 正式）；同为 prerelease 时比 prerelease 标识（rc2 > rc1）。
// 返回：>0 a 新于 b，<0 a 旧于 b，0 相等。非数字段当 0。
export function compareSemver(a: string, b: string): number {
  const splitVer = (v: string) => {
    const [core, pre] = v.split('-', 2)
    const nums = core.split('.').map((s) => parseInt(s, 10) || 0)
    return { nums, pre: pre ?? '' }
  }
  const { nums: pa, pre: preA } = splitVer(a)
  const { nums: pb, pre: preB } = splitVer(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  // core 相等：无 prerelease（正式版）新于有 prerelease
  if (!preA && preB) return 1
  if (preA && !preB) return -1
  if (!preA && !preB) return 0
  // 都有 prerelease：按字符串比（rc2 > rc1，beta.2 > beta.1）。提取尾数字辅助比较，
  // 让 rc10 > rc9（纯字符串比会 rc9 > rc10）。
  const numA = parseInt(preA.match(/\d+$/)?.[0] ?? '0', 10) || 0
  const numB = parseInt(preB.match(/\d+$/)?.[0] ?? '0', 10) || 0
  if (numA !== numB) return numA - numB
  return preA < preB ? -1 : preA > preB ? 1 : 0
}
