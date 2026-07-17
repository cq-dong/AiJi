import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockAuth } from '@/adapters/mockAuth'
beforeEach(() => localStorage.clear())
describe('mockAuth', () => {
  it('register succeeds with valid email+pw>=8', async () => {
    const r = await mockAuth.register('a@b.com', '12345678')
    expect(r.account.type).toBe('network')
    expect(r.account.plan).toBe('free')
    expect(r.session.jwt).toBeTruthy()
  })
  it('register 409 on duplicate email', async () => {
    await mockAuth.register('a@b.com', '12345678')
    await expect(mockAuth.register('a@b.com', '12345678')).rejects.toThrow('AUTH_409')
  })
  it('register 400 on short password', async () => {
    await expect(mockAuth.register('a@b.com', 'short')).rejects.toThrow('AUTH_400')
  })
  it('login succeeds after register', async () => {
    await mockAuth.register('a@b.com', '12345678')
    const r = await mockAuth.login('a@b.com', '12345678')
    expect(r.account.email).toBe('a@b.com')
  })
  it('login 401 on wrong password', async () => {
    await mockAuth.register('a@b.com', '12345678')
    await expect(mockAuth.login('a@b.com', 'wrongpass')).rejects.toThrow('AUTH_401')
  })
  it('refresh 401 when VITE_AIJI_MOCK_SESSION_EXPIRED=1', async () => {
    vi.stubEnv('VITE_AIJI_MOCK_SESSION_EXPIRED', '1')
    await expect(mockAuth.refresh()).rejects.toThrow('AUTH_401')
    vi.unstubAllEnvs()
  })
  it('refresh succeeds otherwise', async () => {
    const s = await mockAuth.refresh()
    expect(s.jwt).toBeTruthy()
  })
})
