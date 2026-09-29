import { describe, it, expect, vi, afterEach } from 'vitest'
import { webSearch } from '@/adapters/webSearch'

// Tavily 网络搜索（2026-09-29 问 AI 搜索分支，唯一 provider，BYOK 自配 key）：
// POST api.tavily.com/search → results map {title,snippet,url} 取前 5；
// 非 200 / 异常 / 缺 results → null（调用方走降级文案，不抛错）。

afterEach(() => vi.unstubAllGlobals())

function mockFetch(res: Partial<Response> | (() => never)) {
  vi.stubGlobal('fetch', typeof res === 'function' ? vi.fn(res) : vi.fn(async () => res))
}

describe('webSearch', () => {
  it('正常结果：title/content/url 映射为 title/snippet/url，截断到前 5 条', async () => {
    const results = Array.from({ length: 6 }, (_, i) => ({
      title: `标题${i}`,
      content: `摘要${i}`,
      url: `https://example.com/${i}`,
    }))
    mockFetch({ ok: true, json: async () => ({ results }) } as Response)
    const r = await webSearch('SpaceX 最新发射', 'tvly-key')
    expect(r).toHaveLength(5)
    expect(r![0]).toEqual({ title: '标题0', snippet: '摘要0', url: 'https://example.com/0' })
  })

  it('字段缺失容错：title/content/url 非 string → 空串', async () => {
    mockFetch({ ok: true, json: async () => ({ results: [{ title: null, url: 'https://a.com' }] }) } as Response)
    const r = await webSearch('q', 'tvly-key')
    expect(r).toEqual([{ title: '', snippet: '', url: 'https://a.com' }])
  })

  it('请求形状：POST + JSON header + body {api_key, query, max_results:5}', async () => {
    mockFetch({ ok: true, json: async () => ({ results: [] }) } as Response)
    await webSearch('SpaceX 最新发射', 'tvly-key')
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.tavily.com/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ api_key: 'tvly-key', query: 'SpaceX 最新发射', max_results: 5 })
  })

  it('HTTP 非 200 → null', async () => {
    mockFetch({ ok: false, status: 401 } as Response)
    expect(await webSearch('q', 'bad-key')).toBeNull()
  })

  it('fetch 抛异常（断网/超时 abort）→ null', async () => {
    mockFetch(() => Promise.reject(new Error('aborted')) as never)
    expect(await webSearch('q', 'tvly-key')).toBeNull()
  })

  it('响应缺 results 数组 → null', async () => {
    mockFetch({ ok: true, json: async () => ({}) } as Response)
    expect(await webSearch('q', 'tvly-key')).toBeNull()
  })
})
