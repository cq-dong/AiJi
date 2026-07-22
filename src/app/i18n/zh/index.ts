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

export const zh = {
  ...common, ...home, ...capture, ...detail, ...categories, ...summary, ...search,
  ...settings, ...onboarding, ...chat, ...login, ...drafts, ...trash, ...reminders, ...feedback,
} as const

export type I18nKey = keyof typeof zh
