import type { I18nKey } from '../zh'
import { common } from './common'
import { home } from './home'
import { capture } from './capture'
import { detail } from './detail'
import { categories } from './categories'
import { summary } from './summary'
import { search } from './search'
import { settings } from './settings'
import { onboarding } from './onboarding'
import { chat } from './chat'
import { login } from './login'
import { drafts } from './drafts'
import { trash } from './trash'
import { reminders } from './reminders'
import { feedback } from './feedback'

const merged = {
  ...common, ...home, ...capture, ...detail, ...categories, ...summary, ...search,
  ...settings, ...onboarding, ...chat, ...login, ...drafts, ...trash, ...reminders, ...feedback,
}

// 类型强制：en 的 key 集合必须 == zh。缺 key / 多 key / key 打错都 typecheck 挂。
export const en: Record<I18nKey, string> = merged
