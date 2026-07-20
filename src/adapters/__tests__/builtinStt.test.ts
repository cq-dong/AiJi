import { describe, it, expect, beforeEach, vi } from 'vitest'
import { builtinStt } from '@/adapters/builtinStt'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import { localSession } from '@/app/session'
import { mockQuotaInternal } from '@/adapters/mockQuota'
import { useAccountStore } from '@/app/accountStore'

const { netState } = vi.hoisted(() => ({
  netState: () => ({ account: { id: 'u1', type: 'network', nickname: 'n', plan: 'free', createdAt: '' } }),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getMedia: vi.fn(async () => new Blob(['audio'], { type: 'audio/webm' })),
    },
  },
}))
vi.mock('@/app/accountStore', () => ({
  useAccountStore: { getState: netState },
}))
vi.mock('@/adapters/mockAuth', () => ({
  mockAuth: { refresh: vi.fn(async () => ({ jwt: 'newjwt', refreshToken: 'r', expiresAt: '2099' })) },
}))

const okText = (text: string) => (globalThis.fetch = vi.fn(async () =>
  new Response(text, { status: 200 })
) as never)

beforeEach(async () => {
  localStorage.clear()
  localSession.set({ jwt: 'oldjwt', refreshToken: 'r', expiresAt: '2099' })
  vi.clearAllMocks()
  // Restore default network account — the guest test reassigns getState directly
  // (vi.clearAllMocks doesn't revert property reassignment on plain mock objects).
  ;(useAccountStore as unknown as { getState: () => unknown }).getState = netState
  // Restore default getMedia mock (blob-found) — the not-found test reassigns it.
  const { di } = await import('@/app/di')
  ;(di.storage.getMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async () => new Blob(['audio'], { type: 'audio/webm' }),
  )
})

describe('builtinStt', () => {
  it('transcribe succeeds → returns text', async () => {
    okText('transcribed text')
    const out = await builtinStt.transcribe('ref1')
    expect(out).toBe('transcribed text')
  })
  it('request headers contain Authorization: Bearer <jwt>', async () => {
    okText('ok')
    await builtinStt.transcribe('ref1')
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oldjwt')
  })
  it('guest account → throws NotNetworkError', async () => {
    const m = await import('@/app/accountStore')
    ;(m.useAccountStore as unknown as { getState: () => unknown }).getState = () => ({ account: { id: 'g', type: 'guest', nickname: 'g', plan: 'guest', createdAt: '' } })
    okText('ok')
    await expect(builtinStt.transcribe('ref1')).rejects.toBeInstanceOf(NotNetworkError)
  })
  it('401 → refresh → retry succeeds (fetch called twice; jwt updated)', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) return new Response('', { status: 401 })
      return new Response('retried text', { status: 200 })
    }) as never
    const out = await builtinStt.transcribe('ref1')
    expect(calls).toBe(2)
    expect(out).toBe('retried text')
    expect(localSession.get()?.jwt).toBe('newjwt')
  })
  it('refresh fails → SessionExpiredError + session cleared', async () => {
    const { mockAuth } = await import('@/adapters/mockAuth')
    ;(mockAuth.refresh as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('AUTH_401'))
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as never
    await expect(builtinStt.transcribe('ref1')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(localSession.get()).toBeNull()
  })
  it('mockQuotaInternal.bumpStt called once on success', async () => {
    okText('ok')
    const spy = vi.spyOn(mockQuotaInternal, 'bumpStt')
    await builtinStt.transcribe('ref1')
    expect(spy).toHaveBeenCalledOnce()
  })
  it('blob not found → throws', async () => {
    const { di } = await import('@/app/di')
    ;(di.storage.getMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => undefined)
    okText('ok')
    await expect(builtinStt.transcribe('ref1')).rejects.toThrow()
  })
})
