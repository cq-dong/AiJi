// mock global fetch + localSession + di.auth.refresh：验证 401→refresh→重试一次；403→StorageFullError；
// refresh 失败→SessionExpiredError；无 session→SessionExpiredError。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '@/domain/account'

const refreshMock = vi.fn()
vi.mock('@/app/di', () => ({ di: { auth: { refresh: (...a: unknown[]) => refreshMock(...a) } } }))

let sessionStore: AuthSession | null = { jwt: 'jwt1', refreshToken: 'rt', expiresAt: '2099-01-01' }
vi.mock('@/app/session', () => ({
  localSession: {
    get: () => sessionStore,
    set: (s: AuthSession) => {
      sessionStore = s
    },
    clear: () => {
      sessionStore = null
    },
  },
}))

import { pullChanges, uploadMedia, getSyncStatus, pushChanges, downloadMedia } from '@/adapters/syncHttp'
import { SessionExpiredError, StorageFullError } from '@/ports'

describe('syncHttp', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    sessionStore = { jwt: 'jwt1', refreshToken: 'rt', expiresAt: '2099-01-01' }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('401 triggers single refresh retry then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('x', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ changes: [], cursor: 5, hasMore: false }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)
    refreshMock.mockResolvedValue({ jwt: 'jwt2', refreshToken: 'rt2', expiresAt: 'y' })
    const r = await pullChanges(0)
    expect(r.cursor).toBe(5)
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt2' })
  })

  it('second 401 after refresh throws SessionExpiredError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x', { status: 401 })),
    )
    refreshMock.mockResolvedValue({ jwt: 'jwt2', refreshToken: 'rt2', expiresAt: 'y' })
    await expect(pullChanges(0)).rejects.toBeInstanceOf(SessionExpiredError)
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('refresh failure throws SessionExpiredError and clears session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 401 })))
    refreshMock.mockRejectedValue(new Error('refresh boom'))
    await expect(getSyncStatus()).rejects.toBeInstanceOf(SessionExpiredError)
    expect(sessionStore).toBeNull()
  })

  it('no session throws SessionExpiredError', async () => {
    sessionStore = null
    vi.stubGlobal('fetch', vi.fn())
    await expect(getSyncStatus()).rejects.toBeInstanceOf(SessionExpiredError)
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('upload 403 → StorageFullError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })))
    await expect(uploadMedia('r1', new Blob(['x']))).rejects.toBeInstanceOf(StorageFullError)
  })

  it('upload success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, size: 1 }), { status: 200 })),
    )
    await expect(uploadMedia('r1', new Blob(['x']))).resolves.toBeUndefined()
  })

  it('download 404 throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    await expect(downloadMedia('r1')).rejects.toThrow(/media 不存在/)
  })

  it('pushChanges sends JSON body and parses response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ applied: 2, rejected: [] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await pushChanges([{ kind: 'entry', id: 'e1', updatedAt: '2026-08-08T00:00:00.000Z' }])
    expect(r.applied).toBe(2)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string).changes).toHaveLength(1)
  })

  it('non-ok response throws with server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: '单批最多 200 条' }), { status: 400 })),
    )
    await expect(pushChanges([])).rejects.toThrow('单批最多 200 条')
  })
})
