import { create } from 'zustand'
import type { Account, AuthSession } from '@/domain/account'
import { localAccount } from '@/adapters/localAccount'
import { localSession } from '@/app/session'
import { di } from '@/app/di'

interface AccountState {
  account: Account | null
  session: AuthSession | null
  sessionStale: boolean
  hydrated: boolean
  hydrate: () => void
  registerGuest: (nickname: string) => Account
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  bindNetwork: (email: string, password: string) => Promise<void>
  upgradePlan: (planId: string) => Promise<void>
  clearSession: () => void
  logout: () => void
  setAvatar: (dataUrl: string) => void
  setNickname: (name: string) => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  session: null,
  sessionStale: false,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return
    set({ account: localAccount.get(), session: localSession.get(), hydrated: true })
    const a = get().account
    if (a && a.type === 'network') {
      di.auth
        .refresh()
        .then((s) => {
          localSession.set(s)
          set({ session: s, sessionStale: false })
        })
        .catch(() => set({ sessionStale: true }))
    }
  },
  registerGuest: (nickname) => {
    const account: Account = {
      id: crypto.randomUUID(),
      type: 'guest',
      nickname: nickname.trim() || '我',
      plan: 'guest',
      createdAt: new Date().toISOString(),
    }
    localAccount.set(account)
    set({ account })
    return account
  },
  login: async (email, password) => {
    const { account, session } = await di.auth.login(email, password)
    localAccount.set(account)
    localSession.set(session)
    set({ account, session, sessionStale: false })
  },
  register: async (email, password) => {
    const { account, session } = await di.auth.register(email, password)
    localAccount.set(account)
    localSession.set(session)
    set({ account, session, sessionStale: false })
  },
  bindNetwork: async (email, password) => {
    const cur = get().account
    if (!cur) throw new Error('no account to bind')
    // 不 catch 409：直接抛 'AUTH_409:...'，T15c UI 按 msg.startsWith('AUTH_409') 提示。
    const { session } = await di.auth.register(email, password)
    const next: Account = {
      ...cur,
      type: 'network',
      plan: 'free',
      email,
      boundAt: new Date().toISOString(),
    }
    localAccount.set(next)
    localSession.set(session)
    set({ account: next, session, sessionStale: false })
  },
  upgradePlan: async (planId) => {
    const r = await di.plan.upgrade(planId)
    const cur = get().account
    if (!cur) return
    const next: Account = {
      ...cur,
      plan: 'paid',
      paidPlanId: r.paidPlanId,
      paidExpiresAt: r.paidExpiresAt,
    }
    localAccount.set(next)
    set({ account: next })
    // quota refresh 由 UI 层 PlansSheet 调 useQuotaStore.getState().refresh()（单向依赖）
  },
  clearSession: () => {
    localSession.clear()
    set({ session: null, sessionStale: false })
  },
  logout: () => {
    // spec §4.9 全清：session + account + reset keySource='byok'
    localSession.clear()
    localAccount.clear()
    set({ account: null, session: null, sessionStale: false })
    void di.storage
      .getSettings()
      .then((s) => {
        if (s.keySource && s.keySource !== 'byok') {
          return di.storage.saveSettings({ ...s, keySource: 'byok' })
        }
        return undefined
      })
      .catch((e) => console.error('[accountStore] logout reset keySource failed', e))
  },
  setAvatar: (dataUrl) => {
    const cur = get().account
    if (!cur) return
    const next: Account = { ...cur, avatar: dataUrl }
    localAccount.set(next)
    set({ account: next })
  },
  setNickname: (name) => {
    const cur = get().account
    if (!cur) return
    const trimmed = name.trim()
    // 空昵称保留旧值（不静默清空身份）。
    if (!trimmed) return
    const next: Account = { ...cur, nickname: trimmed }
    localAccount.set(next)
    set({ account: next })
  },
}))
