import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Account, AuthSession } from '@/domain/account'

// Mock di.auth / di.plan / di.storage；localAccount / localSession 走真实 localStorage（jsdom）。
const mocks = vi.hoisted(() => ({
  authLogin: vi.fn(),
  authRegister: vi.fn(),
  authRefresh: vi.fn(),
  authLogout: vi.fn(),
  planUpgrade: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  adoptLocal: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    auth: {
      login: (...a: unknown[]) => mocks.authLogin(...a),
      register: (...a: unknown[]) => mocks.authRegister(...a),
      refresh: () => mocks.authRefresh(),
      logout: () => mocks.authLogout(),
    },
    plan: { upgrade: (...a: unknown[]) => mocks.planUpgrade(...a) },
    storage: {
      getSettings: () => mocks.getSettings(),
      saveSettings: (...a: unknown[]) => mocks.saveSettings(...a),
      adoptLocal: (...a: unknown[]) => mocks.adoptLocal(...a),
    },
  },
}))

import { useAccountStore } from '@/app/accountStore'
import { localAccount } from '@/adapters/localAccount'
import { localSession } from '@/app/session'

const networkAccount: Account = {
  id: 'net-1',
  type: 'network',
  nickname: 'alice',
  email: 'a@b.com',
  plan: 'free',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const sess: AuthSession = { jwt: 'j', refreshToken: 'r', expiresAt: '2099-01-01T00:00:00.000Z' }

beforeEach(() => {
  localStorage.clear()
  mocks.authLogin.mockReset()
  mocks.authRegister.mockReset()
  mocks.authRefresh.mockReset()
  mocks.authLogout.mockReset()
  mocks.planUpgrade.mockReset()
  mocks.getSettings.mockReset()
  mocks.saveSettings.mockReset()
  mocks.adoptLocal.mockReset()
  mocks.adoptLocal.mockResolvedValue(undefined)
  useAccountStore.setState({ account: null, session: null, sessionStale: false, hydrated: false })
})

describe('accountStore — register', () => {
  it('register(email,pw) → account.type=network + session.jwt 非空 + localSession 有值', async () => {
    mocks.authRegister.mockResolvedValue({ account: networkAccount, session: sess })
    await useAccountStore.getState().register('a@b.com', 'password1')
    const s = useAccountStore.getState()
    expect(s.account?.type).toBe('network')
    expect(s.session?.jwt).toBeTruthy()
    expect(localSession.get()).not.toBeNull()
    expect(s.sessionStale).toBe(false)
  })
})

describe('accountStore — login', () => {
  it('login AUTH_401 抛错 → account 不变', async () => {
    mocks.authLogin.mockRejectedValue(new Error('AUTH_401:邮箱或密码错误'))
    await expect(useAccountStore.getState().login('a@b.com', 'wrong')).rejects.toThrow('AUTH_401')
    const s = useAccountStore.getState()
    expect(s.account).toBeNull()
    expect(s.session).toBeNull()
  })
})

describe('accountStore — bindNetwork', () => {
  it('registerGuest → bindNetwork → account.id 用服务器 id + type=network + plan=free + nickname 保留', async () => {
    useAccountStore.getState().registerGuest('MyNick')
    mocks.authRegister.mockResolvedValue({
      // owner key 必须是服务器 account.id——否则 logout 后 login（服务器 id）看不到收养数据
      account: { ...networkAccount, id: 'server-id' },
      session: sess,
    })
    await useAccountStore.getState().bindNetwork('a@b.com', 'password1')
    const s = useAccountStore.getState()
    expect(s.account?.id).toBe('server-id')
    expect(s.account?.type).toBe('network')
    expect(s.account?.plan).toBe('free')
    expect(s.account?.nickname).toBe('MyNick')
    expect(s.session?.jwt).toBe('j')
    expect(localSession.get()).not.toBeNull()
  })

  it('bindNetwork AUTH_409 抛错 → account 仍 guest（不变）', async () => {
    const guest = useAccountStore.getState().registerGuest('MyNick')
    mocks.authRegister.mockRejectedValue(new Error('AUTH_409:该邮箱已注册'))
    await expect(useAccountStore.getState().bindNetwork('a@b.com', 'password1')).rejects.toThrow('AUTH_409')
    const s = useAccountStore.getState()
    expect(s.account?.type).toBe('guest')
    expect(s.account?.id).toBe(guest.id)
    expect(s.session).toBeNull()
  })
})

describe('accountStore — upgradePlan', () => {
  it("upgradePlan('monthly') → account.plan=paid + paidPlanId=monthly + paidExpiresAt 未来", async () => {
    useAccountStore.setState({ account: { ...networkAccount, id: 'u1' } })
    const future = new Date(Date.now() + 30 * 86400_000).toISOString()
    mocks.planUpgrade.mockResolvedValue({
      orderId: 'o',
      paidPlanId: 'monthly',
      paidExpiresAt: future,
      payUrl: undefined,
    })
    await useAccountStore.getState().upgradePlan('monthly')
    const s = useAccountStore.getState()
    expect(s.account?.plan).toBe('paid')
    expect(s.account?.paidPlanId).toBe('monthly')
    expect(s.account?.paidExpiresAt).toBeTruthy()
    expect(new Date(s.account!.paidExpiresAt!).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('accountStore — logout', () => {
  it('logout → account/session null + saveSettings 被调且 keySource=byok', async () => {
    useAccountStore.setState({ account: networkAccount, session: sess })
    mocks.getSettings.mockResolvedValue({ keySource: 'builtin' })
    mocks.saveSettings.mockResolvedValue(undefined)
    useAccountStore.getState().logout()
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledOnce())
    const s = useAccountStore.getState()
    expect(s.account).toBeNull()
    expect(s.session).toBeNull()
    expect(s.sessionStale).toBe(false)
    expect(localAccount.get()).toBeNull()
    expect(localSession.get()).toBeNull()
    expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ keySource: 'byok' }))
  })
})

describe('accountStore — hydrate', () => {
  it('hydrate network 用户 refresh 失败 → sessionStale=true', async () => {
    localAccount.set(networkAccount)
    localSession.set(sess)
    mocks.authRefresh.mockRejectedValue(new Error('AUTH_401:refresh token 已失效'))
    useAccountStore.getState().hydrate()
    // hydrate 同步设 hydrated + 载入 local；fire-and-forget refresh 异步落定
    await vi.waitFor(() => expect(useAccountStore.getState().sessionStale).toBe(true))
    const s = useAccountStore.getState()
    expect(s.hydrated).toBe(true)
    expect(s.account?.type).toBe('network')
    expect(s.session).not.toBeNull() // 载入的 local session 仍在（refresh 失败不清空）
  })
})
