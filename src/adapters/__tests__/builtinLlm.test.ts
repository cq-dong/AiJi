import { describe, it, expect, beforeEach, vi } from 'vitest'
import { builtinLlm } from '@/adapters/builtinLlm'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import { localSession } from '@/app/session'
import { useAccountStore } from '@/app/accountStore'

const { netState, refreshFn, consumeFn } = vi.hoisted(() => ({
  netState: () => ({ account: { id: 'u1', type: 'network', nickname: 'n', plan: 'free', createdAt: '' } }),
  refreshFn: vi.fn(async () => ({ jwt: 'newjwt', refreshToken: 'r', expiresAt: '2099' })),
  consumeFn: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getEntry: vi.fn(async () => ({
        id: 'e1', createdAt: '2026-07-17T10:00:00+08:00', updatedAt: '', status: 'idle',
        parts: [{ type: 'text', content: '测试内容' }],
      })),
      getEntryAi: vi.fn(async () => undefined),
      listCategories: vi.fn(async () => []),
      listTags: vi.fn(async () => []),
      saveTag: vi.fn(async () => {}),
      saveCategory: vi.fn(async () => {}),
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

const okReply = (reply: string) => (globalThis.fetch = vi.fn(async () =>
  new Response(JSON.stringify({ reply }), { status: 200, headers: { 'Content-Type': 'application/json' } })
) as never)

beforeEach(() => {
  localStorage.clear()
  localSession.set({ jwt: 'oldjwt', refreshToken: 'r', expiresAt: '2099' })
  vi.clearAllMocks()
  ;(useAccountStore as unknown as { getState: () => unknown }).getState = netState
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
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oldjwt')
  })
  it('classify does NOT read vlm:key secret (VLM strip)', async () => {
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
})
