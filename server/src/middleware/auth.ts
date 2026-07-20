import type { MiddlewareHandler } from 'hono'
import { verifyAccessToken } from '../lib/jwt.js'
import { errorJson, type AppEnv } from '../lib/http.js'

// JWT 提取校验 → c.set('userId')。失败 401 + AUTH_401。
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  const m = /^Bearer\s+(.+)$/.exec(auth)
  if (!m) return errorJson(c, 401, 'AUTH_401', '未登录')
  let userId: string
  try {
    userId = await verifyAccessToken(m[1])
  } catch {
    return errorJson(c, 401, 'AUTH_401', '登录已过期')
  }
  c.set('userId', userId)
  await next()
}
