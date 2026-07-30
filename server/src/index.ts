import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { getDb } from './db/index.js'
import { corsMiddleware } from './middleware/cors.js'
import { authMiddleware } from './middleware/auth.js'
import { startRateLimitCleaner } from './lib/rateLimit.js'
import authRoutes from './routes/auth.js'
import accountRoutes from './routes/account.js'
import quotaRoutes from './routes/quota.js'
import planRoutes from './routes/plan.js'
import llmRoutes from './routes/llm.js'
import vlmRoutes from './routes/vlm.js'
import sttRoutes from './routes/stt.js'
import geocodeRoutes from './routes/geocode.js'
import healthRoutes from './routes/health.js'

// 启动时建表 + 校验 env（env.ts 顶部已 throw on missing secret）。
getDb()
startRateLimitCleaner()

const app = new Hono()

// 全局错误兜底：未捕获异常返 500 + 通用 msg（不泄露堆栈）。
app.onError((err, c) => {
  console.error('[unhandled]', err)
  return c.json({ error: 'AUTH_500', message: '服务器内部错误' }, 500 as any)
})

app.use('*', corsMiddleware)

app.route('/health', healthRoutes)
// change-password 需鉴权；必须在 authRoutes 挂载之前注册（Hono 按注册顺序匹配，
// 否则 sub-app 的 POST handler 先返回响应、中间件不触发）。
app.use('/api/auth/change-password', authMiddleware)
app.route('/api/auth', authRoutes)
// 需鉴权的路由挂 authMiddleware。
app.use('/api/quota/*', authMiddleware)
app.use('/api/llm/*', authMiddleware)
app.use('/api/vlm/*', authMiddleware)
app.use('/api/stt/*', authMiddleware)
app.use('/api/geocode/*', authMiddleware)
// account: /api/account/delete 需鉴权（Hono 按注册顺序匹配，中间件须在 route 之前）。
app.use('/api/account/*', authMiddleware)
// plan: GET /api/plan 公开（前端未登录可拉套餐），仅 upgrade/redeem 需鉴权。
app.use('/api/plan/upgrade', authMiddleware)
app.use('/api/plan/redeem', authMiddleware)
app.route('/api/quota', quotaRoutes)
app.route('/api/plan', planRoutes)
app.route('/api/llm', llmRoutes)
app.route('/api/vlm', vlmRoutes)
app.route('/api/stt', sttRoutes)
app.route('/api/geocode', geocodeRoutes)
app.route('/api/account', accountRoutes)

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[aiji-server] listening on http://localhost:${info.port}`)
})
