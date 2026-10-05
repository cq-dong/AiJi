// E2 eng-debt 测试补差（契约 docs/acceptance/e2-eng-debt.md §范围③）。
// geocoding.ts 的 reverseGeocodeCity 已由 reverseGeocodeCity.test.ts 全覆盖（含直辖市
// province 兜底 7 例），本文件只补**剩余未测面**，不重复：
// - reverseGeocode 三通道优先级：① opts.key → 高德直连（status='1' 取 formatted_address；
//   status='0'/reject/空地址 → 回落 Nominatim）；② 无 key + network 账号（有 JWT + BASE）
//   → 后端代理（Bearer 头 / 401→refresh 重试一次 / refresh 失败清 session 回落）；
//   ③ 都不满足 → Nominatim 兜底，失败重试一次（已 abort 不重试）。
// - enrichLocation：已有 address → 原对象直返；成功 → 新对象带 address（不改原对象）；
//   失败 → 原对象。
// 超时与 reject 同走 catch 分支（AbortController.abort → fetch reject），以 reject +
// aborted-signal 两例覆盖该机制，不跑真 6s 计时器。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 与 geocoding.ts 的 import 图隔离：di/accountStore/session 换成可控桩，避免拉起整个
// DI 图（IndexedDB 等副作用）。模式照 reverseGeocodeCity.test.ts，但状态按用例可变。
const state = vi.hoisted(() => ({
  account: null as { type: string } | null,
  session: null as { jwt: string } | null,
  refresh: vi.fn(),
  sessionSet: vi.fn(),
  sessionClear: vi.fn(),
}))
vi.mock('@/app/di', () => ({ di: { auth: { refresh: state.refresh } } }))
vi.mock('@/app/accountStore', () => ({ useAccountStore: { getState: () => ({ account: state.account }) } }))
vi.mock('@/app/session', () => ({
  localSession: { get: () => state.session, set: state.sessionSet, clear: state.sessionClear },
}))

import { reverseGeocode, enrichLocation } from '@/adapters/geocoding'

beforeEach(() => {
  state.account = null
  state.session = null
  state.refresh.mockReset()
  state.sessionSet.mockReset()
  state.sessionClear.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// 按 URL 路由的假 fetch：高德 / Nominatim / 后端代理各自返回预定响应或抛错。
type Res = Partial<Response> | (() => Promise<never>)
function mockFetchRouter(routes: { gaode?: Res; nominatim?: Res; backend?: Res }) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input)
    const pick = url.includes('amap.com') ? routes.gaode : url.includes('nominatim') ? routes.nominatim : routes.backend
    if (!pick) throw new Error('unexpected url: ' + url)
    if (typeof pick === 'function') return pick()
    return pick as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const callsTo = (fn: ReturnType<typeof vi.fn>, marker: string) =>
  fn.mock.calls.filter((c) => String(c[0]).includes(marker))

const GAODE_OK = {
  ok: true,
  json: async () => ({ status: '1', regeocode: { formatted_address: '北京市朝阳区望京街道' } }),
} as Response
const NOMINATIM_OK = {
  ok: true,
  json: async () => ({ display_name: '望京街道, 朝阳区, 北京市' }),
} as Response

describe('reverseGeocode · ① 高德直连（opts.key）', () => {
  it("status='1' → 取 regeocode.formatted_address；请求 location=经度,纬度", async () => {
    const fn = mockFetchRouter({ gaode: GAODE_OK })
    const addr = await reverseGeocode(39.99, 116.48, { key: 'k1' })
    expect(addr).toBe('北京市朝阳区望京街道')
    expect(fn).toHaveBeenCalledTimes(1)
    const url = String(fn.mock.calls[0][0])
    expect(url).toContain('restapi.amap.com/v3/geocode/regeo')
    expect(url).toContain('location=116.48%2C39.99')
  })

  it("status='0'（Key 非法/配额）→ 回落 Nominatim", async () => {
    const fn = mockFetchRouter({
      gaode: { ok: true, json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }) } as Response,
      nominatim: NOMINATIM_OK,
    })
    expect(await reverseGeocode(39.99, 116.48, { key: 'bad' })).toBe('望京街道, 朝阳区, 北京市')
    expect(callsTo(fn, 'amap.com')).toHaveLength(1)
    expect(callsTo(fn, 'nominatim')).toHaveLength(1)
  })

  it('高德 fetch reject（网络异常）→ 回落 Nominatim', async () => {
    mockFetchRouter({ gaode: () => Promise.reject(new Error('network down')), nominatim: NOMINATIM_OK })
    expect(await reverseGeocode(39.99, 116.48, { key: 'k1' })).toBe('望京街道, 朝阳区, 北京市')
  })

  it("formatted_address 为空白串 → 视为失败，回落 Nominatim", async () => {
    mockFetchRouter({
      gaode: { ok: true, json: async () => ({ status: '1', regeocode: { formatted_address: '  ' } }) } as Response,
      nominatim: NOMINATIM_OK,
    })
    expect(await reverseGeocode(39.99, 116.48, { key: 'k1' })).toBe('望京街道, 朝阳区, 北京市')
  })

  it('高德 HTTP 非 200 → 回落 Nominatim', async () => {
    mockFetchRouter({ gaode: { ok: false, status: 503 } as Response, nominatim: NOMINATIM_OK })
    expect(await reverseGeocode(39.99, 116.48, { key: 'k1' })).toBe('望京街道, 朝阳区, 北京市')
  })
})

describe('reverseGeocode · ② 后端代理（无 key + network 账号 + JWT + BASE）', () => {
  function asNetwork() {
    state.account = { type: 'network' }
    state.session = { jwt: 'jwt-1' }
    vi.stubEnv('VITE_AIJI_BACKEND_BASE', 'https://api.test')
  }

  it('成功 → 返回 {address}；Authorization: Bearer <jwt>', async () => {
    asNetwork()
    const fn = mockFetchRouter({ backend: { ok: true, json: async () => ({ address: '上海市黄浦区' }) } as Response })
    expect(await reverseGeocode(31.23, 121.47)).toBe('上海市黄浦区')
    expect(fn).toHaveBeenCalledTimes(1)
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://api.test/api/geocode/reverse?')
    expect(url).toContain('lat=31.23')
    expect(url).toContain('lng=121.47')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1')
  })

  it('401 → refresh 换新 JWT 重试一次 → 成功；localSession.set 被调', async () => {
    asNetwork()
    state.refresh.mockResolvedValue({ jwt: 'jwt-2' })
    const backend = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ address: '广州市天河区' }) })
    vi.stubGlobal('fetch', vi.fn(async () => backend()))
    expect(await reverseGeocode(23.13, 113.26)).toBe('广州市天河区')
    expect(state.refresh).toHaveBeenCalledTimes(1)
    expect(state.sessionSet).toHaveBeenCalledWith({ jwt: 'jwt-2' })
    expect(backend).toHaveBeenCalledTimes(2)
  })

  it('401 + refresh 失败 → 清 session，回落 Nominatim', async () => {
    asNetwork()
    state.refresh.mockRejectedValue(new Error('refresh 401'))
    const fn = mockFetchRouter({ backend: { ok: false, status: 401 } as Response, nominatim: NOMINATIM_OK })
    expect(await reverseGeocode(39.99, 116.48)).toBe('望京街道, 朝阳区, 北京市')
    expect(state.sessionClear).toHaveBeenCalledTimes(1)
    expect(callsTo(fn, 'nominatim')).toHaveLength(1)
  })

  it('非 401 错误（500）→ 不 refresh，直接回落 Nominatim', async () => {
    asNetwork()
    const fn = mockFetchRouter({ backend: { ok: false, status: 500 } as Response, nominatim: NOMINATIM_OK })
    expect(await reverseGeocode(39.99, 116.48)).toBe('望京街道, 朝阳区, 北京市')
    expect(state.refresh).not.toHaveBeenCalled()
    expect(callsTo(fn, '/api/geocode/reverse')).toHaveLength(1)
  })

  it('BASE 为空串 → 后端通道空转（不发请求），直接 Nominatim', async () => {
    state.account = { type: 'network' }
    state.session = { jwt: 'jwt-1' }
    // 显式置空：.env.local 里配了 VITE_AIJI_BACKEND_BASE，会经 vite env 加载渗入
    // import.meta.env，不 stub 就不是"未配置"分支。
    vi.stubEnv('VITE_AIJI_BACKEND_BASE', '')
    const fn = mockFetchRouter({ nominatim: NOMINATIM_OK })
    expect(await reverseGeocode(39.99, 116.48)).toBe('望京街道, 朝阳区, 北京市')
    expect(callsTo(fn, '/api/geocode/reverse')).toHaveLength(0)
    expect(callsTo(fn, 'nominatim')).toHaveLength(1)
  })
})

describe('reverseGeocode · ③ Nominatim 兜底与重试', () => {
  it('guest（无账号无 session）→ 直达 Nominatim，走高德/后端零请求', async () => {
    const fn = mockFetchRouter({ nominatim: NOMINATIM_OK })
    expect(await reverseGeocode(39.99, 116.48)).toBe('望京街道, 朝阳区, 北京市')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(String(fn.mock.calls[0][0])).toContain('nominatim.openstreetmap.org/reverse')
  })

  it('首次失败 → 重试一次成功', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n += 1
        if (n === 1) throw new Error('timeout')
        return NOMINATIM_OK
      }),
    )
    expect(await reverseGeocode(39.99, 116.48)).toBe('望京街道, 朝阳区, 北京市')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('两次都失败 → null（恰好两次，不再多重试）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))
    expect(await reverseGeocode(39.99, 116.48)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('display_name 缺失 → null（重试后仍 null）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response))
    expect(await reverseGeocode(39.99, 116.48)).toBeNull()
  })

  it('调用方 signal 已 abort → 失败后不重试（D24 重试被 abort 闸住）', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))
    expect(await reverseGeocode(39.99, 116.48, { signal: ctrl.signal })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('enrichLocation', () => {
  it('已有 address → 原对象直返，不发请求', async () => {
    const fn = mockFetchRouter({ nominatim: NOMINATIM_OK })
    const loc = { lat: 39.99, lng: 116.48, address: '已有地址' }
    expect(await enrichLocation(loc)).toBe(loc)
    expect(fn).not.toHaveBeenCalled()
  })

  it('无 address + 反查成功 → 返回新对象带 address，原对象不被改', async () => {
    mockFetchRouter({ nominatim: NOMINATIM_OK })
    const loc = { lat: 39.99, lng: 116.48 }
    const enriched = await enrichLocation(loc)
    expect(enriched).toEqual({ lat: 39.99, lng: 116.48, address: '望京街道, 朝阳区, 北京市' })
    expect(loc).toEqual({ lat: 39.99, lng: 116.48 })
    expect(enriched).not.toBe(loc)
  })

  it('反查全失败 → 原对象直返（不补 address）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))
    const loc = { lat: 39.99, lng: 116.48 }
    expect(await enrichLocation(loc)).toBe(loc)
  })
})
