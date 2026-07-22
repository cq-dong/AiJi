// useT()：React hook。订阅 store.settings.language——切换语言时所有用 useT 的组件重渲。
// 独立文件是因为只有它能 import store（见 i18n/index.ts 注释的防环约束）。
import { useUiStore } from '@/app/store'
import { t } from './index'

export function useT(): typeof t {
  useUiStore((s) => s.settings.language)
  return t
}
