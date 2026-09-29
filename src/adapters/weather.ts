// 高德实况天气（2026-09-29 问 AI 能力大补 · 天气分支）。浏览器直连 CORS 友好
//（与 geocoding.ts 高德通道同族）；key 复用 BYOK 高德 Web 服务 key（secrets 'geocoding:key'）。
// 任何失败（HTTP 非 200 / status='0' / 超时 / 解析异常 / lives 空）→ null，
// 由调用方（store weather 分支）写降级数据块，不抛错打断对话。

export interface WeatherLive {
  city: string
  weather: string
  temperature: string
  winddirection: string
  windpower: string
  humidity: string
  reporttime: string
}

const GAODE_WEATHER = 'https://restapi.amap.com/v3/weather/weatherInfo'

export async function getWeatherLive(cityOrAdcode: string, key: string): Promise<WeatherLive | null> {
  // 超时/解析模式照抄 geocoding.ts reverseGeocodeGaode（8s AbortController）。
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const params = new URLSearchParams({
      key,
      city: cityOrAdcode,
      extensions: 'base', // base=实况；all=预报（本期不用）
    })
    const res = await fetch(`${GAODE_WEATHER}?${params}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const data = await res.json()
    // 高德 status: "1" 成功 / "0" 失败（配额/Key 非法等）。lives[0] 是实况行。
    const live = data?.status === '1' && Array.isArray(data?.lives) ? data.lives[0] : undefined
    if (!live || typeof live !== 'object') {
      if (data?.status !== '1') console.warn('[weather] gaode non-success', data?.info, data?.infocode)
      return null
    }
    const l = live as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
    return {
      city: str(l.city),
      weather: str(l.weather),
      temperature: str(l.temperature),
      winddirection: str(l.winddirection),
      windpower: str(l.windpower),
      humidity: str(l.humidity),
      reporttime: str(l.reporttime),
    }
  } catch (e) {
    console.warn('[weather] gaode getWeatherLive failed', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}
