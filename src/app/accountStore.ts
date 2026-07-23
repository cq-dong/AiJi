// accountSlots 必须是本文件第一个 import——ESM 按 import 序深度优先求值依赖模块，
// 若排在 di 之后，di 链上的 quotaStore 顶层 registerQuotaReset 会撞上 accountSlots
// 未求值的 TDZ（与当初槽放本文件 `let` 时的白屏同机理）。放首位：零依赖槽模块先于
// 一切求值完，环上来电时绑定必然已初始化。
import { accountSlots } from '@/app/accountSlots'
import { create } from 'zustand'
import type { Account, AuthSession } from '@/domain/account'
import { localAccount } from '@/adapters/localAccount'
import { localSession } from '@/app/session'
import { di } from '@/app/di'
import { SessionExpiredError } from '@/ports'
import { setCurrentOwner } from '@/app/currentOwner'
import { t } from '@/app/i18n'

// adoptLocal 包装：收养失败不让 login/register reject——登录本身已成功（session 已落），
// 数据收养是 best-effort 后台动作。失败只记日志，用户仍处登录态（数据可能暂缺，下次登录可重试收养）。
async function adoptLocalSafe(accountId: string): Promise<void> {
  try {
    await di.storage.adoptLocal(accountId)
  } catch (e) {
    console.error('[accountStore] adoptLocal failed', e)
  }
}

// network 账号登录/绑定后把 keySource 置 'builtin'——di.ts readKeySource 据此路由到内置
// proxy（builtinLlm/builtinStt）。默认 'byok' 会让 network 用户 LLM/STT/chat/VLM 全走
// BYOK 适配器 → 「BYOK 未配置」报错（内置 key 永不可达）。失败只记日志不阻塞登录。
async function setKeySourceBuiltin(): Promise<void> {
  try {
    const s = await di.storage.getSettings()
    if (s.keySource !== 'builtin') {
      await di.storage.saveSettings({ ...s, keySource: 'builtin' })
    }
  } catch (e) {
    console.error('[accountStore] set keySource=builtin failed', e)
  }
}

// 账号切换后触发 UI store 全量重载——清掉内存里旧 owner 的 entries/categories/tags/
// aggregates/reminders/conversation 快照。store.hydrate 的 `if (hydrated) return` 守卫使
// 得不重置就跳过 → 新账号看到旧账号数据（隔离失效）。rehydrate reset hydrated→hydrate 全量重载。
//
// **破环方案——注册回调，非动态 import**：accountStore 不能静态 import store（成环
// accountStore→store→di→builtinLlm→accountStore）。曾用 `await import('./store')` 动态 import
// 破环，但 Vite dev 给动态 import 加 `?t=<hmr>` query → 解析成与 UI 不同的 useUiStore 实例，
// rehydrate 跑在空实例上、真 store 不动（dev 下隔离仍失效；prod 无 `?t=` 才正常）。
// 改用 store→accountStore 单向依赖（store 已 import accountStore）：store 模块加载时把
// rehydrate 注册进共享槽，accountStore 调槽函数。零动态 import、零环、零实例分裂。
//
// 槽本体在零依赖模块 `@/app/accountSlots`——曾放本文件（`let storeRehydrateFn`），dev 原生
// ESM 下若本模块先开始求值、停在 import di 行，链上 quotaStore 顶层注册会撞上 TDZ
// （Cannot access before initialization，白屏）；prod Rollup 提升遮掩。移槽后与本文件
// 求值序彻底解耦。
/** store.ts 模块加载时注册：rehydrate 仅当 store 已 hydrated 时执行（boot 期 store 未 hydrated
 * 时跳过——store.hydrate 后续会自读 adopt 后数据，不重复加载）。 */
export function registerStoreRehydrate(fn: () => Promise<void>): void {
  accountSlots.storeRehydrate = fn
}

async function triggerStoreRehydrate(): Promise<void> {
  if (!accountSlots.storeRehydrate) return
  try {
    await accountSlots.storeRehydrate()
  } catch (e) {
    console.error('[accountStore] store rehydrate failed', e)
  }
}

// quotaStore 的配额快照是内存单例（同 store），hydrate 守卫只跑一次。账号切换不刷新 → 新账号
// 看到旧账号「今日 LLM 4 次」。同槽模式：quotaStore 模块加载时把 reset+refresh 注册进本槽，
// accountStore 在 postNetworkLogin/logout 调用。零反向 import 成环。
/** quotaStore 模块加载时注册：账号切换时清旧账号配额快照 + 拉新账号配额。 */
export function registerQuotaReset(fn: () => Promise<void>): void {
  accountSlots.quotaReset = fn
}

async function triggerQuotaReset(): Promise<void> {
  if (!accountSlots.quotaReset) return
  try {
    await accountSlots.quotaReset()
  } catch (e) {
    // 静默：logout 场景 refresh 无 session 会失败，不应打扰账号切换主流程。
    console.error('[accountStore] quota reset failed', e)
  }
}

// network 账号登录/绑定后的 best-effort 收尾：先写 keySource='builtin'（防 di 路由漂移到 BYOK），
// 再 rehydrate（重载新 owner 数据）。顺序有意——rehydrate 内会读 settings，先落 builtin 再重载
// 避免 race 读到旧 byok。两者均吞错不阻塞登录主流程。
async function postNetworkLogin(): Promise<void> {
  await setKeySourceBuiltin()
  await triggerStoreRehydrate()
  await triggerQuotaReset()
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
    // 无账号 / guest → 'local'。
    setCurrentOwner(a && a.type === 'network' ? a.id : 'local')
    set({ account: a, session: localSession.get(), hydrated: true })
    const cur = get().account
    if (cur && cur.type === 'network') {
      // 防漂移：network 账号 boot 时确保 keySource='builtin'（内置 key 可达）。
      void setKeySourceBuiltin()
      // 幂等补 adopt：升级用户开机时存量数据可能在 'local'（db v7 回填），adopt 收养到 cur.id。
      // adopt 完成后若 store 已 hydrated 则触发 rehydrate 重载收养后的数据——修「升级用户开机空库」
      // （store.hydrate 可能在 adopt 完成前先跑读到空库，rehydrate 兜底重读）。
      // triggerStoreRehydrate 内注册的 fn 自带 `if (hydrated)` 守卫，未 hydrated 时跳过。
      void adoptLocalSafe(cur.id).then(() => triggerStoreRehydrate())
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
      nickname: nickname.trim() || t('comp.avatar.me'),
      plan: 'guest',
      createdAt: new Date().toISOString(),
    }
    localAccount.set(account)
    // guest 走 'local' 分区（非 network account.id）。
    setCurrentOwner('local')
    set({ account })
    // 切回 'local' 视图：清旧 owner 快照重载。guest 通常从 logout 或首装来，旧快照可能残留。
    void triggerStoreRehydrate()
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
    // 内置 key 可达 + 清旧 owner 快照重载（隔离）。best-effort 不阻塞登录。
    void postNetworkLogin()
  },
  register: async (email, password) => {
    const { account, session } = await di.auth.register(email, password)
    localAccount.set(account)
    localSession.set(session)
    setCurrentOwner(account.id)
    await adoptLocalSafe(account.id)
    set({ account, session, sessionStale: false })
    void postNetworkLogin()
  },
  bindNetwork: async (email, password) => {
    const cur = get().account
    if (!cur) throw new Error('no account to bind')
    // 不 catch 409：直接抛 'AUTH_409:...'，T15c UI 按 msg.startsWith('AUTH_409') 提示。
    const { account: serverAccount, session } = await di.auth.register(email, password)
    // owner key 必须用服务器 account.id（S）而非保留 guest.id（G）：数据分区按 account.id
    // 过滤，若收养到 G，logout 后同邮箱 login 拿回 S，G 下数据无任何路径可达（等价丢失）。
    // 昵称/头像保留 guest 期的本地值（服务器 register 只有邮箱派生的默认昵称）。
    const next: Account = {
      ...serverAccount,
      nickname: cur.nickname || serverAccount.nickname,
      avatar: cur.avatar ?? serverAccount.avatar,
    }
    localAccount.set(next)
    localSession.set(session)
    // 绑定即升级为 network 账号：guest 期间记的 'local' 数据收养到服务器 account.id。
    setCurrentOwner(next.id)
    await adoptLocalSafe(next.id)
    set({ account: next, session, sessionStale: false })
    void postNetworkLogin()
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
    // 切回 'local' 视图：清旧 owner 快照重载（隔离）。登出无内置访问权，keySource 保持 byok。
    void triggerStoreRehydrate()
    // 清旧账号配额快照：logout 后无 session，refresh 静默失败 → quota 保持 null → UI skeleton。
    void triggerQuotaReset()
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
