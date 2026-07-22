// 当前界面语言（i18n 键）。零依赖单例（防循环 import）：store ↔ adapters ↔ i18n 都依赖它，
// 它不依赖任何业务模块。与 currentOwner.ts 同构。
// 模块 init 同步 detect（onboarding 未 hydrate 时也有正确默认值，防首帧闪烁）。
export type Lang = 'zh' | 'en'

// 可注入便于测试：默认读 navigator.language。
export function detectLang(navLang?: string): Lang {
  const l = navLang ?? (typeof navigator !== 'undefined' ? navigator.language : 'zh')
  return l.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

let current: Lang = detectLang()

export function getCurrentLang(): Lang {
  return current
}

export function setCurrentLang(l: Lang): void {
  current = l
}
