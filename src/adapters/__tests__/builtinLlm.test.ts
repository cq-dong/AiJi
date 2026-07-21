import { describe, it, expect, beforeEach, vi } from 'vitest'
import { builtinLlm } from '@/adapters/builtinLlm'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import { localSession } from '@/app/session'
import { useAccountStore } from '@/app/accountStore'

// 可变 entry/ai/fixtures，供单个用例覆盖（含图条目、纯图条目等）。
const fixtures = vi.hoisted(() => ({
  entry: {
    id: 'e1', createdAt: '2026-07-17T10:00:00+08:00', updatedAt: '', status: 'idle' as const,
    parts: [{ type: 'text', content: '测试内容' }],
  },
  ai: undefined as undefined | { summary?: string; mediaDescription?: { images?: string; videos?: string } },
  categories: [] as never[],
  tags: [] as never[],
  settings: { videoVisionEnabled: true, videoFrameIntervalSec: 10 },
  mediaBlob: new Blob(['x'], { type: 'image/jpeg' }),
}))

const { netState, refreshFn, consumeFn } = vi.hoisted(() => ({
  netState: () => ({ account: { id: 'u1', type: 'network', nickname: 'n', plan: 'free', createdAt: '' } }),
  refreshFn: vi.fn(async () => ({ jwt: 'newjwt', refreshToken: 'r', expiresAt: '2099' })),
  consumeFn: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getEntry: vi.fn(async () => fixtures.entry),
      getEntryAi: vi.fn(async () => fixtures.ai),
      listCategories: vi.fn(async () => fixtures.categories),
      listTags: vi.fn(async () => fixtures.tags),
      saveTag: vi.fn(async () => {}),
      saveCategory: vi.fn(async () => {}),
      getSettings: vi.fn(async () => fixtures.settings),
      getMedia: vi.fn(async () => fixtures.mediaBlob),
      // AI 记忆注入（2026-07-22）：classify/answerChat 调 listMemories → 默认空数组（不注入）。
      listMemories: vi.fn(async () => []),
    },
    auth: { refresh: refreshFn },
  },
}))
vi.mock('@/app/accountStore', () => ({
  useAccountStore: { getState: netState },
}))
vi.mock('@/app/quotaStore', () => ({
  useQuotaStore: { getState: () => ({ consume: consumeFn }) },
}))
// collectEntryImages 依赖 visionMedia（canvas/createImageBitmap，jsdom 无）→ mock 成假 data URL。
vi.mock('@/adapters/visionMedia', () => ({
  compressImage: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  pickFrameTimes: vi.fn(() => [0]),
  extractFrame: vi.fn(async () => new Blob(['f'], { type: 'image/jpeg' })),
}))

const okReply = (reply: string) => (globalThis.fetch = vi.fn(async () =>
  new Response(JSON.stringify({ reply }), { status: 200, headers: { 'Content-Type': 'application/json' } })
) as never)

const statusReply = (status: number, body = '') =>
  (globalThis.fetch = vi.fn(async () => new Response(body, { status })) as never)

const lastFetchInit = (): RequestInit => {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1][1] as RequestInit
}
const lastFetchUrl = (): string => {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  return String(calls[calls.length - 1][0])
}

beforeEach(() => {
  localStorage.clear()
  localSession.set({ jwt: 'oldjwt', refreshToken: 'r', expiresAt: '2099' })
  vi.clearAllMocks()
  ;(useAccountStore as unknown as { getState: () => unknown }).getState = netState
  // 重置 fixtures 到默认（纯文本条目）
  fixtures.entry = {
    id: 'e1', createdAt: '2026-07-17T10:00:00+08:00', updatedAt: '', status: 'idle',
    parts: [{ type: 'text', content: '测试内容' }],
  }
  fixtures.ai = undefined
  fixtures.categories = []
  fixtures.tags = []
  fixtures.settings = { videoVisionEnabled: true, videoFrameIntervalSec: 10 }
  fixtures.mediaBlob = new Blob(['x'], { type: 'image/jpeg' })
})

describe('builtinLlm', () => {
  it('classify returns EntryAi with modelUsed=builtin-llm', async () => {
    okReply(JSON.stringify({ categorySlug: 'idea', tags: ['t'], facets: {} }))
    const ai = await builtinLlm.classify('e1')
    expect(ai.modelUsed).toBe('builtin-llm')
  })
  it('classify sends JWT Authorization header', async () => {
    okReply(JSON.stringify({ categorySlug: 'idea', tags: [], facets: {} }))
    await builtinLlm.classify('e1')
    const init = lastFetchInit()
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oldjwt')
  })
  it('classify does NOT read vlm:key secret (VLM 走后端 JWT，不读 BYOK secret)', async () => {
    okReply(JSON.stringify({ categorySlug: 'idea', tags: [], facets: {} }))
    await builtinLlm.classify('e1') // di.secrets 未 mock → 若读 vlm:key 会抛
  })
  it('classify consumes llm quota', async () => {
    okReply(JSON.stringify({ categorySlug: 'idea', tags: [], facets: {} }))
    await builtinLlm.classify('e1')
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
  })
  it('aggregate consumes llm + agg quota', async () => {
    okReply(JSON.stringify({ sentences: ['x'], highlights: [] }))
    await builtinLlm.aggregate(['e1'], 'day', '2026-07-17', 3)
    expect(consumeFn).toHaveBeenCalledWith('llm', 1)
    expect(consumeFn).toHaveBeenCalledWith('agg', 1)
  })
  it('guest account throws NotNetworkError', async () => {
    const m = await import('@/app/accountStore')
    ;(m.useAccountStore as unknown as { getState: () => unknown }).getState = () => ({ account: { id: 'g', type: 'guest', nickname: 'g', plan: 'guest', createdAt: '' } })
    okReply('{}')
    await expect(builtinLlm.classify('e1')).rejects.toBeInstanceOf(NotNetworkError)
  })
  it('401 → refresh → retry succeeds', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) return new Response('', { status: 401 })
      return new Response(JSON.stringify({ reply: JSON.stringify({ categorySlug: 'idea', tags: [], facets: {} }) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as never
    await builtinLlm.classify('e1')
    expect(calls).toBe(2)
    expect(localSession.get()?.jwt).toBe('newjwt')
    expect(refreshFn).toHaveBeenCalledOnce()
  })
  it('401 → refresh fails → SessionExpiredError + session cleared', async () => {
    refreshFn.mockRejectedValueOnce(new Error('AUTH_401'))
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as never
    await expect(builtinLlm.classify('e1')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(localSession.get()).toBeNull()
  })
  it('no session → SessionExpiredError', async () => {
    localSession.clear()
    okReply('{}')
    await expect(builtinLlm.classify('e1')).rejects.toBeInstanceOf(SessionExpiredError)
  })

  // ── A2 VLM 多模态 ──────────────────────────────────────────────
  it('含图条目走 /api/vlm/chat 且 mediaDescription 落 EntryAi', async () => {
    // 照片 part（durationSec<=0 → image）+ 文本
    fixtures.entry = {
      id: 'e2', createdAt: '2026-07-17T10:00:00+08:00', updatedAt: '', status: 'idle',
      parts: [
        { type: 'text', content: '路边拍到一只猫' },
        { type: 'video', ref: 'm1', durationSec: 0 },
      ],
    }
    okReply(JSON.stringify({
      categorySlug: 'life', tags: ['cat'], facets: {},
      mediaDescription: { images: '一只橘猫蹲在路边的花坛上。' },
    }))
    const ai = await builtinLlm.classify('e2')
    expect(lastFetchUrl()).toContain('/api/vlm/chat')
    // user message content 为多模态数组（含 image_url）
    const init = lastFetchInit()
    const body = JSON.parse(init.body as string)
    const userMsg = body.messages[body.messages.length - 1]
    expect(Array.isArray(userMsg.content)).toBe(true)
    expect(userMsg.content.some((p: { type: string }) => p.type === 'image_url')).toBe(true)
    expect(ai.mediaDescription?.images).toBe('一只橘猫蹲在路边的花坛上。')
  })

  it('纯图无文本 + vlm 端点 500 → throw 不降级', async () => {
    // 仅一张照片，无文本 part → content.trim()===''
    fixtures.entry = {
      id: 'e3', createdAt: '2026-07-17T10:00:00+08:00', updatedAt: '', status: 'idle',
      parts: [{ type: 'video', ref: 'm1', durationSec: 0 }],
    }
    statusReply(500, 'upstream error')
    await expect(builtinLlm.classify('e3')).rejects.toThrow(/VLM 不可用且无文本内容可分类/)
    // 只调了一次 fetch（vlm），未降级到 /api/llm/chat
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    expect(String(calls[0][0])).toContain('/api/vlm/chat')
  })

  it('含图+文本但 vlm 端点非 OK → 降级去图走 /api/llm/chat', async () => {
    fixtures.entry = {
      id: 'e4', createdAt: '2026-07-17T10:00:00+08:00', updatedAt: '', status: 'idle',
      parts: [
        { type: 'text', content: '有文本可降级' },
        { type: 'video', ref: 'm1', durationSec: 0 },
      ],
    }
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) return new Response('vlm boom', { status: 500 })
      return new Response(JSON.stringify({ reply: JSON.stringify({ categorySlug: 'idea', tags: [], facets: {} }) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as never
    const ai = await builtinLlm.classify('e4')
    expect(calls).toBe(2)
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0])).toContain('/api/llm/chat')
    // 降级后无 mediaDescription
    expect(ai.mediaDescription).toBeUndefined()
  })

  it('aggregate 媒体统计透传（imageCount + mediaDescription 进 prompt）', async () => {
    fixtures.entry = {
      id: 'e5', createdAt: '2026-07-17T10:00:00+08:00', updatedAt: '', status: 'idle',
      parts: [
        { type: 'text', content: '今天看到的' },
        { type: 'video', ref: 'm1', durationSec: 0 }, // 照片 → image
        { type: 'video', ref: 'm2', durationSec: 12 }, // 真视频 → video
      ],
    }
    fixtures.ai = { summary: '看图', mediaDescription: { images: '一只橘猫。', videos: '猫跳上墙。' } }
    okReply(JSON.stringify({ sentences: ['x'], highlights: [] }))
    await builtinLlm.aggregate(['e5'], 'day', '2026-07-17', 3)
    const init = lastFetchInit()
    const bodyStr = init.body as string
    // buildAggregatePrompt 把 imageCount/videoCount/mediaDescription 编进 user content
    expect(bodyStr).toContain('图片=1张')
    expect(bodyStr).toContain('视频=1段')
    expect(bodyStr).toContain('一只橘猫。')
    expect(bodyStr).toContain('猫跳上墙。')
  })
})
