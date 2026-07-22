import { describe, it, expect, beforeEach } from 'vitest'
import { detectLang, getCurrentLang, setCurrentLang } from '@/app/currentLang'
import { t } from '@/app/i18n'
import { localizeError } from '@/app/i18n/errorText'

beforeEach(() => setCurrentLang('zh'))

describe('currentLang', () => {
  it('detectLang: navigator.language=zh-CN → zh；en-US → en；fr → en', () => {
    expect(detectLang('zh-CN')).toBe('zh')
    expect(detectLang('zh-TW')).toBe('zh')
    expect(detectLang('en-US')).toBe('en')
    expect(detectLang('fr-FR')).toBe('en')
  })
  it('setCurrentLang/getCurrentLang 往返', () => {
    setCurrentLang('en')
    expect(getCurrentLang()).toBe('en')
  })
})

describe('t', () => {
  it('zh 取词 + en 取词', () => {
    expect(t('common.save')).toBe('保存')
    setCurrentLang('en')
    expect(t('common.save')).toBe('Save')
  })
  it('插值 {name}', () => {
    expect(t('common.itemsCount', { count: 3 })).toBe('3 条')
    setCurrentLang('en')
    expect(t('common.itemsCount', { count: 3 })).toBe('3 items')
  })
  it('en 缺 key 回落 zh（防御，类型上不该发生）', () => {
    setCurrentLang('en')
    expect(t('common.zhOnly' as never)).toBe('仅中文')
  })
})

describe('localizeError', () => {
  it('AUTH_409 映射中文/英文', () => {
    expect(localizeError(new Error('AUTH_409:该邮箱已注册'))).toBe('该邮箱已注册')
    setCurrentLang('en')
    expect(localizeError(new Error('AUTH_409:该邮箱已注册'))).toBe('This email is already registered')
  })
  it('未知错误码回落原文', () => {
    expect(localizeError(new Error('WEIRD_1:custom'))).toBe('WEIRD_1:custom')
  })
  it('非 Error 输入 String 化', () => {
    expect(localizeError('oops')).toBe('oops')
  })
})
