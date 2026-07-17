import type { GeoPoint } from '@/domain/types'

// D5: Reverse geocoding adapter — converts lat/lng to human-readable address.
// Uses Nominatim (OpenStreetMap) — free, no API key required. Usage policy:
//   - Max 1 request/second (capture-time only, not bulk — fine for this use case)
//   - Must send a valid User-Agent or Referer. Browsers forbid setting User-Agent
//     via fetch; the WebView sends its own UA which satisfies the policy. We also
//     set Accept-Language=zh-CN to get Chinese addresses.
// For production scale, swap to a keyed provider (Gaode/Google) — the interface
// (reverseGeocode / enrichLocation) stays the same; only the URL + auth changes.

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse'

/**
 * Reverse-geocode lat/lng to a display address string. Returns null on any
 * failure (network/timeout/parse) — callers fall back to raw coordinates.
 *
 * @param timeoutMs default 3500ms — short enough not to block capture save,
 *                  long enough for a typical Nominatim response (~500-2000ms).
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 3500
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  // Chain external abort signal if provided.
  if (opts?.signal) {
    if (opts.signal.aborted) {
      ctrl.abort()
    } else {
      opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
    }
  }
  try {
    const params = new URLSearchParams({
      format: 'json',
      lat: String(lat),
      lon: String(lng),
      zoom: '18', // street-level detail
      'accept-language': 'zh-CN',
    })
    const res = await fetch(`${NOMINATIM_REVERSE}?${params}`, {
      signal: ctrl.signal,
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    })
    if (!res.ok) return null
    const data = await res.json()
    // Nominatim returns `display_name` (full address string) + `address` object.
    // display_name is the most complete single-line representation.
    if (typeof data?.display_name === 'string' && data.display_name.trim()) {
      return data.display_name.trim()
    }
    return null
  } catch {
    // AbortError / network / parse — all degrade to null (caller shows lat/lng)
    return null
  } finally {
    clearTimeout(timer)
  }
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
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<GeoPoint> {
  if (loc.address) return loc
  const addr = await reverseGeocode(loc.lat, loc.lng, opts)
  if (!addr) return loc
  return { ...loc, address: addr }
}
