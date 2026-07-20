import { describe, it, expect } from 'vitest'
import { SessionExpiredError, NotNetworkError, QuotaExhaustedError, type AuthPort, type QuotaPort, type PlanPort } from '@/ports'
describe('Slice B ports', () => {
  it('errors are throwable with correct name', () => {
    expect(() => { throw new SessionExpiredError() }).toThrow()
    expect(new NotNetworkError().name).toBe('NotNetworkError')
    expect(new QuotaExhaustedError().name).toBe('QuotaExhaustedError')
  })
  it('AuthPort shape compiles', () => {
    const m: AuthPort = {
      register: async () => null as never,
      login: async () => null as never,
      refresh: async () => null as never,
      logout: async () => {},
    }
    expect(typeof m.register).toBe('function')
  })
  it('QuotaPort/PlanPort shape', () => {
    const q: QuotaPort = { getQuota: async () => null as never }
    const p: PlanPort = { getPlans: async () => [], upgrade: async () => null as never }
    expect(typeof q.getQuota).toBe('function')
    expect(typeof p.upgrade).toBe('function')
  })
})
