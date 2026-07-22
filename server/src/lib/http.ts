import type { Context } from 'hono'

// Hono app 变量类型：auth middleware c.set('userId')，路由 c.get('userId')。
export type AppEnv = { Variables: { userId: string } }

export interface ErrorBody {
  error: string
  message: string
}

// 统一错误响应：HTTP status + body {error:'AUTH_<CODE>', message:'<中文>'}。
// 前端 parseAuthError 重组 Error('AUTH_<CODE>:<中文>')，与 mockAuth 抛错格式一致。
export function errorJson(c: Context, status: number, code: string, message: string) {
  return c.json({ error: code, message } satisfies ErrorBody, status as any)
}
