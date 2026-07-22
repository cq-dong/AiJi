import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { getDb } from './db/index.js'
import { corsMiddleware } from './middleware/cors.js'
import { authMiddleware } from './middleware/auth.js'
import { startRateLimitCleaner } from './lib/rateLimit.js'
import authRoutes from './routes/auth.js'
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
app.route('/api/auth', authRoutes)
// 需鉴权的路由挂 authMiddleware。
app.use('/api/quota/*', authMiddleware)
app.use('/api/llm/*', authMiddleware)
app.use('/api/vlm/*', authMiddleware)
app.use('/api/stt/*', authMiddleware)
app.use('/api/geocode/*', authMiddleware)
// plan: GET /api/plan 公开（前端未登录可拉套餐），仅 upgrade 需鉴权。
app.use('/api/plan/upgrade', authMiddleware)
app.route('/api/quota', quotaRoutes)
app.route('/api/plan', planRoutes)
app.route('/api/llm', llmRoutes)
app.route('/api/vlm', vlmRoutes)
app.route('/api/stt', sttRoutes)
app.route('/api/geocode', geocodeRoutes)

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[aiji-server] listening on http://localhost:${info.port}`)
})
