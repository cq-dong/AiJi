// HTTP AuthPort 适配器：对接后端 /api/auth/*。
// 单飞锁（inflightRefresh）：并发 401 共享一次 refresh，避免多请求各发一次 refresh
// 导致旧 token 被作废、下一次 401 链断（spec §4.13）。
// 错误契约：后端 body {error:'AUTH_<CODE>', message:'<中文>'} → 重组 Error('AUTH_<CODE>:<中文>')，
// 与 mockAuth 抛错格式一致，login/index.tsx startsWith('AUTH_409') 命中。
import type { AuthPort } from '@/ports'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import type { Account, AuthSession } from '@/domain/account'
import { localSession } from '@/app/session'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

function parseAuthError(body: unknown, status: number): Error {
  if (typeof body === 'object' && body && 'error' in body) {
    const e = body as { error?: string; message?: string }
    if (e.error && e.message) return new Error(`${e.error}:${e.message}`)
  }
  if (status === 401) return new SessionExpiredError('AUTH_401:登录已过期')
  return new Error(`AUTH_${status}:未知错误`)
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json().catch(() => null)
  return res.text().catch(() => '')
}

// 单飞锁：refresh 期间并发调用共享同一 promise。
let inflightRefresh: Promise<AuthSession> | null = null

export const httpAuth: AuthPort = {
  async register(email, password) {
    let res: Response
    try {
      res = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      throw new NotNetworkError('网络不可用')
    }
    const body = await parseBody(res)
    if (!res.ok) throw parseAuthError(body, res.status)
    return body as { account: Account; session: AuthSession }
  },

  async login(email, password) {
    let res: Response
    try {
      res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      throw new NotNetworkError('网络不可用')
    }
    const body = await parseBody(res)
    if (!res.ok) throw parseAuthError(body, res.status)
    return body as { account: Account; session: AuthSession }
  },

  async refresh() {
    // 单飞：并发 401 共享一次 refresh。
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = (async () => {
      const cur = localSession.get()
      if (!cur?.refreshToken) throw new SessionExpiredError('AUTH_401:无 refresh token')
      let res: Response
      try {
        res = await fetch(`${BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: cur.refreshToken }),
        })
      } catch {
        throw new NotNetworkError('网络不可用')
      }
      const body = await parseBody(res)
      if (!res.ok) throw parseAuthError(body, res.status)
      // 后端返 {account, session}；AuthPort.refresh 契约只返 session。
      const data = body as { account: Account; session: AuthSession }
      return data.session
    })().finally(() => {
      inflightRefresh = null
    })
    return inflightRefresh
  },

  async logout() {
    const cur = localSession.get()
    try {
      await fetch(`${BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: cur?.refreshToken ?? '' }),
      })
    } catch {
      // 静默：本地已清 session，网络失败不阻塞登出。
    }
  },
}
