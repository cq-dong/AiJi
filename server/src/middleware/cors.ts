import { cors } from 'hono/cors'
import { env } from '../env.js'

export const corsMiddleware = cors({
  origin: (origin) => (env.corsOrigins.includes(origin) ? origin : null),
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: false,
})
