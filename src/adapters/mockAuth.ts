import type { AuthPort } from '@/ports'
import type { Account, AuthSession } from '@/domain/account'

interface StoredUser {
  email: string
  password: string
  accountId: string
}

const USERS_KEY = 'aiji:mock:users'
const expired = () => import.meta.env.VITE_AIJI_MOCK_SESSION_EXPIRED === '1'

function now1h(): string {
  return new Date(Date.now() + 3600_000).toISOString()
}
function makeJwt(email: string): string {
  return 'mockjwt.' + btoa(email) + '.' + now1h()
}
function readUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as StoredUser[]
  } catch {
    return []
  }
}
function writeUsers(u: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(u))
}

export const mockAuth: AuthPort = {
  async register(email, password) {
    if (password.length < 8) throw new Error('AUTH_400:密码至少 8 位')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('AUTH_400:邮箱格式无效')
    const users = readUsers()
    if (users.some((u) => u.email === email)) throw new Error('AUTH_409:该邮箱已注册')
    const account: Account = {
      id: crypto.randomUUID(),
      type: 'network',
      nickname: email.split('@')[0],
      email,
      plan: 'free',
      createdAt: new Date().toISOString(),
    }
    users.push({ email, password, accountId: account.id })
    writeUsers(users)
    const session: AuthSession = { jwt: makeJwt(email), refreshToken: 'mockrefresh:' + account.id, expiresAt: now1h() }
    return { account, session }
  },
  async login(email, password) {
    const users = readUsers()
    const u = users.find((x) => x.email === email)
    if (!u || u.password !== password) throw new Error('AUTH_401:邮箱或密码错误')
    const account: Account = {
      id: u.accountId, type: 'network', nickname: email.split('@')[0], email, plan: 'free', createdAt: new Date().toISOString(),
    }
    const session: AuthSession = { jwt: makeJwt(email), refreshToken: 'mockrefresh:' + u.accountId, expiresAt: now1h() }
    return { account, session }
  },
  async refresh() {
    if (expired()) throw new Error('AUTH_401:refresh token 已失效')
    return { jwt: 'mockjwt.refreshed.' + now1h(), refreshToken: 'mockrefresh:new', expiresAt: now1h() }
  },
  async logout() {
    // mock 无服务端状态
  },
}
