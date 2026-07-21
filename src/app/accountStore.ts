import { create } from 'zustand'
import type { Account, AuthSession } from '@/domain/account'
import { localAccount } from '@/adapters/localAccount'
import { localSession } from '@/app/session'
import { di } from '@/app/di'
import { SessionExpiredError } from '@/ports'
import { setCurrentOwner } from '@/app/currentOwner'

// adoptLocal 包装：收养失败不让 login/register reject——登录本身已成功（session 已落），
// 数据收养是 best-effort 后台动作。失败只记日志，用户仍处登录态（数据可能暂缺，下次登录可重试收养）。
async function adoptLocalSafe(accountId: string): Promise<void> {
  try {
    await di.storage.adoptLocal(accountId)
  } catch (e) {
    console.error('[accountStore] adoptLocal failed', e)
  }
}

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
    const a = localAccount.get()
    // 恢复 currentOwner：network 账号 → 其 id（数据已在前次 login 时 adopt 到该 id）；
    // 无账号 / guest → 'local'。hydrate 不再 adopt（adopt 仅在 fresh login 时一次性发生）。
    setCurrentOwner(a && a.type === 'network' ? a.id : 'local')
    set({ account: a, session: localSession.get(), hydrated: true })
    const cur = get().account
    if (cur && cur.type === 'network') {
      di.auth
        .refresh()
        .then((s) => {
          if (!get().account) return
          localSession.set(s)
          set({ session: s, sessionStale: false })
        })
        .catch((e) => {
          // 分型：refresh 失效（401）→ 会话过期清 session；其他（网络）→ 标 stale 待重试。
          if (e instanceof SessionExpiredError) {
            localSession.clear()
            set({ session: null, sessionStale: false })
          } else {
            set({ sessionStale: true })
          }
        })
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
    // guest 走 'local' 分区（非 network account.id）。
    setCurrentOwner('local')
    set({ account })
    return account
  },
  login: async (email, password) => {
    const { account, session } = await di.auth.login(email, password)
    localAccount.set(account)
    localSession.set(session)
    // 先切 owner 再 adopt——adoptLocal 把 'local' 行改盖为 account.id，
    // 之后 listEntries 按 account.id 过滤即可看到收养来的历史数据。
    setCurrentOwner(account.id)
    await adoptLocalSafe(account.id)
    set({ account, session, sessionStale: false })
  },
  register: async (email, password) => {
    const { account, session } = await di.auth.register(email, password)
    localAccount.set(account)
    localSession.set(session)
    setCurrentOwner(account.id)
    await adoptLocalSafe(account.id)
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
    // 绑定即升级为 network 账号：guest 期间记的 'local' 数据收养到 account.id（此处为保留的 guest.id）。
    setCurrentOwner(next.id)
    await adoptLocalSafe(next.id)
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
    // 登出 → 数据分区回到 'local'（未登录态）。已收养到旧 account.id 的数据保留在库中，
    // 下次该账号登录仍可见；新记的数据落到 'local'，待下次登录收养。
    setCurrentOwner('local')
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
