// 服务器/适配器错误（Error('AUTH_409:…') 格式）→ 当前语言文案。
// 映射表在 common 片段的 error.* key；未命中回落原文（不丢信息）。
import { t } from './index'
import { zh, type I18nKey } from './zh'

export function localizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const code = msg.split(':')[0]
  const key = `error.${code}`
  // 动态 key：类型收窄到 I18nKey 仅当 zh 里确实存在该 key
  if (key in zh) return t(key as I18nKey)
  return msg
}
