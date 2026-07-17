import { create } from 'zustand'
import type { Account } from '@/domain/account'
import { localAccount } from '@/adapters/localAccount'

interface AccountState {
  account: Account | null
  hydrated: boolean
  hydrate: () => void
  registerGuest: (nickname: string) => Account
  logout: () => void
  setAvatar: (dataUrl: string) => void
  setNickname: (name: string) => void
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
