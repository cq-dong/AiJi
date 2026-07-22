import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { getQuotaForUser } from '../lib/quota.js'

const quota = new Hono<AppEnv>()

// GET /api/quota — 返回今日用量 + 额度 + resetAt（北京时间次日 00:00 ISO）。
quota.get('/', (c) => {
  const userId = c.get('userId') as string
  return c.json(getQuotaForUser(userId))
})

export default quota
