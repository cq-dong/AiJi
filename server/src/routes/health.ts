import { Hono } from 'hono'

const health = new Hono()

// GET /health — nginx 探活 / pm2 healthcheck。
health.get('/', (c) => c.json({ ok: true, ts: Date.now() }))

export default health
