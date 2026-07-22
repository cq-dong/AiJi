// t()：非 hook 全局翻译函数（helpers/适配器/提示词构建可用）。
// React 组件请用 useT()（./useT.ts）——本文件刻意不 import store，防 ESM 环
// （store → di → adapters → i18n → store）。
import { getCurrentLang } from '@/app/currentLang'
import type { Lang } from '@/app/currentLang'
import { zh, type I18nKey } from './zh'
import { en } from './en'

const dicts: Record<Lang, Record<string, string>> = { zh, en }

export type { I18nKey }

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  let s = dicts[getCurrentLang()][key] ?? zh[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}
