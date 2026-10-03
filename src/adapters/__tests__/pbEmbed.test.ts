import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openAiCompatLlm } from '@/adapters/openAiCompatLlm'

// P-B（2026-10-03）语义召回：openAiCompatLlm.embed（BYOK 唯一 embed 链路）。
// 降级语义（spec §1）：缺 key/url → null；HTTP 非 2xx → null（增强路径，HTTP 错误降级即可）；
// 响应形状坏 → null；llmUrl 非 /chat/completions 结尾 → null 且不发请求（不瞎猜路径）；
// fetch 抛错（网络层异常）→ 抛错（spec 明确：抛错=调用失败，调用方 catch 降级）。

const fixtures = vi.hoisted(() => ({
  settings: {
    llmUrl: 'https://api.deepseek.com/v1/chat/completions',
    llmModel: 'deepseek-v4-flash',
    embeddingModel: undefined as string | undefined,
  },
  apiKey: 'sk-test' as string | undefined,
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getSettings: vi.fn(async () => fixtures.settings),
    },
    secrets: { get: vi.fn(async () => fixtures.apiKey) },
  },
}))

const okEmbeddings = (vectors: number[][]) =>
  (globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ data: vectors.map((v, i) => ({ index: i, embedding: v })) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as never)

const lastFetchUrl = (): string => {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  return String(calls[calls.length - 1][0])
}
const lastFetchBody = (): Record<string, unknown> => {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  return JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  fixtures.settings = {
    llmUrl: 'https://api.deepseek.com/v1/chat/completions',
    llmModel: 'deepseek-v4-flash',
    embeddingModel: undefined,
  }
  fixtures.apiKey = 'sk-test'
})

describe('openAiCompatLlm.embed', () => {
  it('成功 → 返回 number[][]，URL 由 chat/completions 派生为 embeddings', async () => {
    okEmbeddings([[0.1, 0.2], [0.3, 0.4]])
    const out = await openAiCompatLlm.embed!(['文本一', '文本二'])
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]])
    expect(lastFetchUrl()).toBe('https://api.deepseek.com/v1/embeddings')
  })

  it('body：model 缺省 text-embedding-3-small + input=texts + Bearer 鉴权', async () => {
    okEmbeddings([[1]])
    await openAiCompatLlm.embed!(['hello'])
    const body = lastFetchBody()
    expect(body.model).toBe('text-embedding-3-small')
    expect(body.input).toEqual(['hello'])
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('settings.embeddingModel 已配 → 用自定义模型', async () => {
    fixtures.settings.embeddingModel = 'bge-m3'
    okEmbeddings([[1]])
    await openAiCompatLlm.embed!(['hello'])
    expect(lastFetchBody().model).toBe('bge-m3')
  })

  it('缺 key → null 且不发请求', async () => {
    fixtures.apiKey = undefined
    globalThis.fetch = vi.fn() as never
    await expect(openAiCompatLlm.embed!(['x'])).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('缺 url → null 且不发请求', async () => {
    fixtures.settings.llmUrl = ''
    globalThis.fetch = vi.fn() as never
    await expect(openAiCompatLlm.embed!(['x'])).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('HTTP 500 → null 不抛错（embedding 是增强路径，HTTP 错误降级）', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as never
    await expect(openAiCompatLlm.embed!(['x'])).resolves.toBeNull()
  })

  it('fetch reject（网络层异常）→ 抛错（spec：抛错=调用失败，调用方 catch 降级）', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network down') }) as never
    await expect(openAiCompatLlm.embed!(['x'])).rejects.toThrow('network down')
  })

  it('响应缺 data → null', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ unexpected: true }), { status: 200 })
    ) as never
    await expect(openAiCompatLlm.embed!(['x'])).resolves.toBeNull()
  })

  it('data 长度与 texts 不等 → null', async () => {
    okEmbeddings([[0.1]]) // 只回 1 条，但请求 2 条
    await expect(openAiCompatLlm.embed!(['a', 'b'])).resolves.toBeNull()
  })

  it('data 项缺 embedding / 非 number 数组 → null', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ index: 0 }] }), { status: 200 })
    ) as never
    await expect(openAiCompatLlm.embed!(['x'])).resolves.toBeNull()
  })

  it('llmUrl 非 /chat/completions 结尾（非标准端点）→ null 且不发请求', async () => {
    fixtures.settings.llmUrl = 'https://custom.example.com/some/other/path'
    globalThis.fetch = vi.fn() as never
    await expect(openAiCompatLlm.embed!(['x'])).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
