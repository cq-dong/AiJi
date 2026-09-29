import { describe, it, expect, vi, afterEach } from 'vitest'
import { getWeatherLive } from '@/adapters/weather'

// 高德实况天气（2026-09-29 问 AI 天气分支）：status='1' 且 lives[0] 存在 → 七字段；
// status='0' / HTTP 非 200 / fetch 异常 / lives 空 → null（调用方走降级文案，不抛错）。

afterEach(() => vi.unstubAllGlobals())

function mockFetch(res: Partial<Response> | (() => never)) {
  vi.stubGlobal('fetch', typeof res === 'function' ? vi.fn(res) : vi.fn(async () => res))
}

const livePayload = {
  status: '1',
  lives: [
    {
      city: '北京市',
      weather: '晴',
      temperature: '25',
      winddirection: '北',
      windpower: '3',
      humidity: '40',
      reporttime: '2026-09-29 10:00:00',
    },
  ],
}

describe('getWeatherLive', () => {
  it("status='1' → 返回七字段实况", async () => {
    mockFetch({ ok: true, json: async () => livePayload } as Response)
    const w = await getWeatherLive('北京', 'test-key')
    expect(w).toEqual({
      city: '北京市',
      weather: '晴',
      temperature: '25',
      winddirection: '北',
      windpower: '3',
      humidity: '40',
      reporttime: '2026-09-29 10:00:00',
    })
  })

  it('请求 URL：restapi.amap.com weatherInfo，含 key/city(编码)/extensions=base', async () => {
    mockFetch({ ok: true, json: async () => livePayload } as Response)
    await getWeatherLive('北京', 'test-key')
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('https://restapi.amap.com/v3/weather/weatherInfo?')
    expect(url).toContain('key=test-key')
    expect(url).toContain(`city=${encodeURIComponent('北京')}`)
    expect(url).toContain('extensions=base')
  })

  it("status='0'（key 非法/配额）→ null", async () => {
    mockFetch({ ok: true, json: async () => ({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }) } as Response)
    expect(await getWeatherLive('北京', 'bad-key')).toBeNull()
  })

  it('HTTP 非 200 → null', async () => {
    mockFetch({ ok: false, status: 500 } as Response)
    expect(await getWeatherLive('北京', 'test-key')).toBeNull()
  })

  it('fetch 抛异常（断网/超时 abort）→ null', async () => {
    mockFetch(() => Promise.reject(new Error('aborted')) as never)
    expect(await getWeatherLive('北京', 'test-key')).toBeNull()
  })

  it("status='1' 但 lives 空数组 → null", async () => {
    mockFetch({ ok: true, json: async () => ({ status: '1', lives: [] }) } as Response)
    expect(await getWeatherLive('北京', 'test-key')).toBeNull()
  })
})
