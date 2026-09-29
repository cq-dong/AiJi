// Tavily 网络搜索（2026-09-29 问 AI 能力大补 · 搜索分支）。唯一 provider（用户拍板），
// BYOK 自配 key（secrets 'search:key'）；浏览器直连 CORS 友好。
// 任何失败（HTTP 非 200 / 超时 / 异常 / 缺 results）→ null，由调用方写降级数据块，不抛错。

export interface SearchResult {
  title: string
  snippet: string
  url: string
}

const TAVILY_SEARCH = 'https://api.tavily.com/search'

export async function webSearch(query: string, key: string): Promise<SearchResult[] | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetch(TAVILY_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: 5 }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data?.results)) return null
    return (data.results as Record<string, unknown>[]).slice(0, 5).map((r) => ({
      title: typeof r?.title === 'string' ? r.title : '',
      snippet: typeof r?.content === 'string' ? r.content : '',
      url: typeof r?.url === 'string' ? r.url : '',
    }))
  } catch (e) {
    console.warn('[webSearch] tavily search failed', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}
