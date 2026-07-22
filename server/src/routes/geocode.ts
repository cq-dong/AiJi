import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { env } from '../env.js'
import { errorJson } from '../lib/http.js'

const geocode = new Hono<AppEnv>()

const AMAP_REGEO = 'https://restapi.amap.com/v3/geocode/regeo'

// GET /api/geocode/reverse?lat=<f>&lng=<f>
// 代理高德逆地理解码，key 服务端持有（不再烘进公开 APK 被提取滥用）。
//
// 不扣 quota 的决策：定位属工具型调用（采集时取地名落条目），非
// LLM/STT 等按量计费型；每次只产生一次轻量 HTTP 转发，成本可忽
// 略。如后续被滥用（同一用户高频刷取 / 脚本拉取），再加 per-user
// 限流或并入 quota——MVP 先放行，降低采集摩擦。
geocode.get('/reverse', async (c) => {
  const lat = Number.parseFloat(c.req.query('lat') ?? '')
  const lng = Number.parseFloat(c.req.query('lng') ?? '')
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return errorJson(c, 400, 'AUTH_400', 'lat 需为 [-90,90] 数值')
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return errorJson(c, 400, 'AUTH_400', 'lng 需为 [-180,180] 数值')
  }

  if (!env.gaodeKey) {
    return errorJson(c, 503, 'GEOCODE_503', '地点编码服务未配置')
  }

  // 高德 regeo 的 location=经度,纬度（lng 在前，与 lat/lng 顺序相反）。
  const url = new URL(AMAP_REGEO)
  url.searchParams.set('key', env.gaodeKey)
  url.searchParams.set('location', `${lng},${lat}`)
  url.searchParams.set('output', 'json')
  url.searchParams.set('extensions', 'base')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const upstream = await fetch(url, { signal: controller.signal })
    if (!upstream.ok) {
      // HTTP 层异常（非 200）→ 不读 body，统一 502；不透传上游细节防泄露 key 上下文。
      return errorJson(c, 502, 'GEOCODE_502', '地点解析失败')
    }
    const data = await upstream.json() as {
      status?: string
      infocode?: string
      regeocode?: { formatted_address?: string }
    }
    if (data.status === '1' && typeof data.regeocode?.formatted_address === 'string' && data.regeocode.formatted_address) {
      return c.json({ address: data.regeocode.formatted_address })
    }
    // 逻辑失败：status!=='1' 或缺 formatted_address；带 infocode 便于排查，但不泄露 key 相关细节。
    return errorJson(c, 502, `GEOCODE_${data.infocode || '502'}`, '地点解析失败')
  } catch {
    // 网络异常 / abort 超时 → 502。
    return errorJson(c, 502, 'GEOCODE_502', '地点解析失败')
  } finally {
    clearTimeout(timer)
  }
})

export default geocode
