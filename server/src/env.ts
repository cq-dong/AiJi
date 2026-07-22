import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[env] 缺少必填环境变量: ${name}`)
  return v
}

function int(name: string, def: number): number {
  const v = process.env[name]
  if (!v) return def
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

export const env = {
  jwtSecret: required('JWT_SECRET'),
  refreshSecret: required('REFRESH_SECRET'),
  deepseekKey: process.env.DEEPSEEK_KEY ?? '',
  deepseekBase: process.env.DEEPSEEK_BASE ?? 'https://api.deepseek.com/v1',
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  dashscopeKey: process.env.DASHSCOPE_KEY ?? '',
  dashscopeBase: process.env.DASHSCOPE_BASE ?? 'https://dashscope.aliyuncs.com',
  dashscopeModel: process.env.DASHSCOPE_MODEL ?? 'paraformer-realtime-v2',
  // VLM 多模态模型（qwen-vl 系列）；不强制校验存在，缺省回落。
  vlmModel: process.env.VLM_MODEL ?? 'qwen-vl-max',
  // 高德 web 服务 key（逆地理解码代理用）；不强制校验，缺省空串→路由返 503。
  gaodeKey: process.env.GAODE_KEY ?? '',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,https://localhost').split(',').map((s) => s.trim()).filter(Boolean),
  port: int('PORT', 8787),
  jwtTtl: int('JWT_TTL_SECONDS', 900),
  refreshTtl: int('REFRESH_TTL_SECONDS', 30 * 86400),
}

// 启动时强校验：JWT/refresh 密钥必须 ≥32 字节，否则 HS256 不安全。
if (env.jwtSecret.length < 32) throw new Error('[env] JWT_SECRET 必须 ≥32 字节')
if (env.refreshSecret.length < 32) throw new Error('[env] REFRESH_SECRET 必须 ≥32 字节')
