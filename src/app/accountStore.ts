import { create } from 'zustand'
import type { Account } from '@/domain/account'
import { localAccount } from '@/adapters/localAccount'

interface AccountState {
  account: Account | null
  hydrated: boolean
  hydrate: () => void
  registerGuest: (nickname: string) => Account
  logout: () => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return
    set({ account: localAccount.get(), hydrated: true })
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
  logout: () => {
    localAccount.clear()
    set({ account: null })
  },
}))
