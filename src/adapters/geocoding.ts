import type { GeoPoint } from '@/domain/types'

// D5/D24: Reverse geocoding adapter — converts lat/lng to human-readable address.
// 双通道：
//   1) 高德（Gaode）web 服务 REST —— 国内稳定可靠，需 BYOK Key（settings.geocodingKeyRef）。
//      浏览器/WebView 直连，CORS 友好。配了 Key 时首选。
//   2) Nominatim（OpenStreetMap）—— 免费、无需 Key，但国内网络常超时/不可达（OSM 服务器在境外，
//      移动网络丢包严重）。未配高德 Key 时回落，并放宽超时 + 一次重试提高成功率。
// 接口（reverseGeocode / enrichLocation）不变，只增 opts.key 透传高德 Key。

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse'
const GAODE_REVERSE = 'https://restapi.amap.com/v3/geocode/regeo'

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
 * Reverse-geocode lat/lng to a display address string. Returns null on any
 * failure (network/timeout/parse) — callers fall back to raw coordinates.
 *
 * @param opts.key 高德 web 服务 Key。提供 → 走高德（国内稳定）；否则回落 Nominatim
 *                 （超时放宽到 8s + 一次重试，境内仍可能失败）。
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  opts?: { signal?: AbortSignal; timeoutMs?: number; key?: string },
): Promise<string | null> {
  if (opts?.key) {
    const addr = await reverseGeocodeGaode(lat, lng, opts.key, opts)
    if (addr) return addr
    // 高德失败（配额/Key 非法/网络）→ 再试 Nominatim 兜底，别让用户看到坐标。
  }
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
