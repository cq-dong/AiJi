import { describe, it, expect, vi, afterEach } from 'vitest'

// 与 geocoding.ts 的 import 图隔离：di/accountStore/session 只服务旧三通道反查，
// reverseGeocodeCity 是高德直连纯函数，mock 掉避免拉起整个 DI 图（IndexedDB 等副作用）。
vi.mock('@/app/di', () => ({ di: {} }))
vi.mock('@/app/accountStore', () => ({ useAccountStore: { getState: () => ({ account: null }) } }))
vi.mock('@/app/session', () => ({ localSession: { get: () => null, set: () => {}, clear: () => {} } }))

import { reverseGeocodeCity } from '@/adapters/geocoding'

// 反查城市（2026-09-29 问 AI 天气定位兜底）：addressComponent.city 非空直收；
// 直辖市 city 为空串/空数组 → province 兜底；adcode 必收。任何失败 → null。

afterEach(() => vi.unstubAllGlobals())

function mockFetch(res: Partial<Response> | (() => never)) {
  vi.stubGlobal('fetch', typeof res === 'function' ? vi.fn(res) : vi.fn(async () => res))
}

describe('reverseGeocodeCity', () => {
  it('普通城市：city 直收 + adcode', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        status: '1',
        regeocode: { addressComponent: { city: '杭州市', province: '浙江省', adcode: '330100' } },
      }),
    } as Response)
    expect(await reverseGeocodeCity(30.27, 120.15, 'test-key')).toEqual({ city: '杭州市', adcode: '330100' })
  })

  it('直辖市：city 为空数组 → province 兜底', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        status: '1',
        regeocode: { addressComponent: { city: [], province: '北京市', adcode: '110000' } },
      }),
    } as Response)
    expect(await reverseGeocodeCity(39.9, 116.4, 'test-key')).toEqual({ city: '北京市', adcode: '110000' })
  })

  it('直辖市：city 为空串 → province 兜底', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        status: '1',
        regeocode: { addressComponent: { city: '', province: '上海市', adcode: '310000' } },
      }),
    } as Response)
    expect(await reverseGeocodeCity(31.23, 121.47, 'test-key')).toEqual({ city: '上海市', adcode: '310000' })
  })

  it('请求 URL：location=经度,纬度（高德顺序）', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        status: '1',
        regeocode: { addressComponent: { city: '杭州市', adcode: '330100' } },
      }),
    } as Response)
    await reverseGeocodeCity(30.27, 120.15, 'test-key')
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('https://restapi.amap.com/v3/geocode/regeo?')
    expect(url).toContain('location=120.15%2C30.27')
    expect(url).toContain('key=test-key')
  })

  it("status='0' → null", async () => {
    mockFetch({ ok: true, json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }) } as Response)
    expect(await reverseGeocodeCity(30.27, 120.15, 'bad-key')).toBeNull()
  })

  it('缺 adcode → null', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ status: '1', regeocode: { addressComponent: { city: '杭州市' } } }),
    } as Response)
    expect(await reverseGeocodeCity(30.27, 120.15, 'test-key')).toBeNull()
  })

  it('HTTP 非 200 / fetch 抛异常 → null', async () => {
    mockFetch({ ok: false, status: 500 } as Response)
    expect(await reverseGeocodeCity(30.27, 120.15, 'test-key')).toBeNull()
    mockFetch(() => Promise.reject(new Error('aborted')) as never)
    expect(await reverseGeocodeCity(30.27, 120.15, 'test-key')).toBeNull()
  })
})
