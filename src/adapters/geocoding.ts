import type { GeoPoint } from '@/domain/types'
// 后端代理路径：network 账号（有 JWT）走 {BASE}/api/geocode/reverse，服务端持高德 Key，
// 不再烘 APK。accountStore/session/di 均不反向 import geocoding，故无环（store→geocoding 单向）。
import { useAccountStore } from '@/app/accountStore'
import { localSession } from '@/app/session'
import { di } from '@/app/di'

// D5/D24: Reverse geocoding adapter — converts lat/lng to human-readable address.
// 三通道（按优先级）：
//   1) 高德（Gaode）web 服务 REST —— 用户自配 BYOK Key（settings.geocodingKeyRef → opts.key）。
//      国内稳定可靠，浏览器/WebView 直连 CORS 友好。配了 Key 时首选。
//   2) 后端代理 /api/geocode/reverse —— 无自配 Key 且当前为 network 账号（有 JWT）时走。
//      服务端持高德 Key + 扣账号配额；前端只持 JWT，401→refresh 重试一次（模式照 builtinLlm.chatFetch）。
//      免去把 Key 烘进 APK 的风险；guest / 未登录回落 Nominatim。
//   3) Nominatim（OpenStreetMap）—— 免费、无需 Key，但国内网络常超时/不可达（OSM 服务器在境外，
//      移动网络丢包严重）。兜底，并放宽超时 + 一次重试提高成功率。
// 接口（reverseGeocode / enrichLocation）不变，只增 opts.key 透传高德 Key。

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse'
const GAODE_REVERSE = 'https://restapi.amap.com/v3/geocode/regeo'
const BACKEND_REVERSE_PATH = '/api/geocode/reverse'

async function reverseGeocodeGaode(
  lat: number,
  lng: number,
  key: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 6000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  if (opts?.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  try {
    // 高德 regeo 的 location 参数顺序是 `经度,纬度`（lng,lat），与 OSM 相反。
    const params = new URLSearchParams({
      key,
      location: `${lng},${lat}`,
      output: 'json',
      extensions: 'base',
    })
    const res = await fetch(`${GAODE_REVERSE}?${params}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const data = await res.json()
    // 高德 status: "1" 成功 / "0" 失败（配额/Key 非法等）。formatted_address 是完整单行地址。
    if (data?.status === '1' && typeof data?.regeocode?.formatted_address === 'string') {
      const addr = data.regeocode.formatted_address.trim()
      return addr || null
    }
    console.warn('[geocoding] gaode non-success', data?.info, data?.infocode)
    return null
  } catch (e) {
    console.warn('[geocoding] gaode reverseGeocode failed', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function reverseGeocodeNominatim(
  lat: number,
  lng: number,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 8000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  if (opts?.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  try {
    const params = new URLSearchParams({
      format: 'json',
      lat: String(lat),
      lon: String(lng),
      zoom: '18',
      'accept-language': 'zh-CN',
    })
    const res = await fetch(`${NOMINATIM_REVERSE}?${params}`, {
      signal: ctrl.signal,
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data?.display_name === 'string' && data.display_name.trim()) {
      return data.display_name.trim()
    }
    return null
  } catch (e) {
    console.warn('[geocoding] nominatim reverseGeocode failed', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 后端代理反向地理编码：network 账号（有 JWT）走 {BASE}/api/geocode/reverse。
 * 服务端持高德 Key + 扣账号配额；前端只持 JWT。401 → refresh 重试一次（模式照 builtinLlm.chatFetch）。
 * 返 {address: string}；任何失败返 null（调用方回落 Nominatim）。
 */
async function reverseGeocodeViaBackend(
  lat: number,
  lng: number,
  jwt: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string | null> {
  const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''
  if (!BASE) return null
  const timeoutMs = opts?.timeoutMs ?? 6000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  if (opts?.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) })
  const doFetch = (token: string) =>
    fetch(`${BASE}${BACKEND_REVERSE_PATH}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    })
  try {
    let res = await doFetch(jwt)
    if (res.status === 401) {
      let newSession
      try {
        newSession = await di.auth.refresh()
        localSession.set(newSession)
      } catch {
        // refresh 失败（401/网络）→ 会话过期清 session，回落 Nominatim 不打扰用户。
        localSession.clear()
        return null
      }
      res = await doFetch(newSession.jwt)
    }
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data?.address === 'string' && data.address.trim()) return data.address.trim()
    return null
  } catch (e) {
    console.warn('[geocoding] backend reverseGeocode failed', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reverse-geocode lat/lng to a display address string. Returns null on any
 * failure (network/timeout/parse) — callers fall back to raw coordinates.
 *
 * 优先级：① opts.key（用户自配高德 Key）→ 高德直连；② 无自配 Key 且当前 network 账号
 * （有 JWT）→ 后端代理（服务端持 Key，401→refresh 重试）；③ 都不满足 → Nominatim 兜底。
 * 任一主通道失败都回落 Nominatim，别让用户看到坐标。
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  opts?: { signal?: AbortSignal; timeoutMs?: number; key?: string },
): Promise<string | null> {
  // ① 用户自配 Key → 高德直连。
  if (opts?.key) {
    const addr = await reverseGeocodeGaode(lat, lng, opts.key, opts)
    if (addr) return addr
    // 高德失败（配额/Key 非法/网络）→ 落到 Nominatim 兜底。
  } else {
    // ② 无自配 Key + network 账号（有 JWT）→ 后端代理。
    const a = useAccountStore.getState().account
    const session = localSession.get()
    if (a?.type === 'network' && session?.jwt) {
      const addr = await reverseGeocodeViaBackend(lat, lng, session.jwt, opts)
      if (addr) return addr
      // 后端失败（配额/网络/服务端 Key 故障）→ 落到 Nominatim 兜底。
    }
  }
  // ③ Nominatim 兜底（不变）。
  const addr = await reverseGeocodeNominatim(lat, lng, opts)
  if (addr) return addr
  // D24: Nominatim 一次重试——境内移动网络首次请求常因 DNS/TLS 握手慢而超时，二次往往能过。
  if (!opts?.signal?.aborted) {
    return reverseGeocodeNominatim(lat, lng, opts)
  }
  return null
}

/**
 * Enrich a GeoPoint with a reverse-geocoded address. Non-mutating — returns
 * a new object with `address` set, or the original if geocode fails or address
 * already present. Does NOT block capture save: callers fire this async after
 * `primeLocation` returns coordinates; if the user saves before the address
 * arrives, the entry persists with lat/lng only (address backfilled on next
 * capture or display-time enrichment).
 */
export async function enrichLocation(
  loc: GeoPoint,
  opts?: { signal?: AbortSignal; timeoutMs?: number; key?: string },
): Promise<GeoPoint> {
  if (loc.address) return loc
  const addr = await reverseGeocode(loc.lat, loc.lng, opts)
  if (!addr) return loc
  return { ...loc, address: addr }
}
