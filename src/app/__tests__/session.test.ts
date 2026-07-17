import { describe, it, expect, beforeEach } from 'vitest'
import { localSession } from '@/app/session'

beforeEach(() => localStorage.clear())

describe('localSession', () => {
  it('round-trips set/get/clear', () => {
    const s = { jwt: 'j', refreshToken: 'r', expiresAt: '2099-01-01' }
    localSession.set(s)
    expect(localSession.get()).toEqual(s)
    localSession.clear()
    expect(localSession.get()).toBeNull()
  })

  it('returns null when empty', () => {
    expect(localSession.get()).toBeNull()
  })
})
