import { describe, it, expect, afterEach } from 'vitest'
import { dateKey, currentTimeLine, slugifyCategoryLabel, resolveActionCategory } from './helpers'
import { setCurrentLang } from '@/app/currentLang'
import type { Category } from '@/domain/types'

// 能力大补（2026-09-29）纯函数助手：日键 / 当前时间行 / 类别 slug 化 / action 类别解析。

afterEach(() => {
  setCurrentLang('zh')
})

describe('dateKey', () => {
  it('ISO(Z/+08:00) → 本地日键 YYYY-MM-DD', () => {
    // 东八区 2026-09-29 08:30 = UTC 00:30 —— 本地日键取本地年月日
    expect(dateKey('2026-09-29T00:30:00.000Z')).toBe('2026-09-29')
    expect(dateKey('2026-07-15T23:00:00+08:00')).toBe('2026-07-15')
  })
})

describe('currentTimeLine', () => {
  it('zh：当前时间：YYYY-MM-DD 周X HH:mm', () => {
    setCurrentLang('zh')
    // 2026-09-29 是周二
    const line = currentTimeLine(new Date(2026, 8, 29, 10, 30))
    expect(line).toBe('当前时间：2026-09-29 周二 10:30')
  })
  it('en：Current time: YYYY-MM-DD ddd HH:mm', () => {
    setCurrentLang('en')
    const line = currentTimeLine(new Date(2026, 8, 29, 9, 5))
    expect(line).toBe('Current time: 2026-09-29 Tue 09:05')
  })
})

describe('slugifyCategoryLabel', () => {
  it('小写 + 空白→连字符 + 去特殊字符', () => {
    expect(slugifyCategoryLabel('Food Notes')).toBe('food-notes')
    expect(slugifyCategoryLabel('美食')).toBe('美食')
    expect(slugifyCategoryLabel('项目 Alpha!')).toBe('项目-alpha')
  })
  it('清洗后为空 → cat- 前缀兜底，永不返空串', () => {
    expect(slugifyCategoryLabel('!!!')).toBe('cat-')
    expect(slugifyCategoryLabel('')).toBe('cat-')
  })
})

describe('resolveActionCategory', () => {
  const cats: Category[] = [
    { slug: 'idea', label: '想法', aliases: ['灵感'], usageCount: 3, createdAt: '2026-01-01T00:00:00.000Z' },
    { slug: 'food', label: '美食', aliases: [], usageCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  ]
  it('categorySlug 命中现有类别 → 用之（isNew=false）', () => {
    expect(resolveActionCategory({ categorySlug: 'idea' }, cats)).toEqual({ slug: 'idea', label: '想法', isNew: false })
  })
  it('slug 未命中 → categoryLabel 对 label 大小写不敏感匹配', () => {
    expect(resolveActionCategory({ categorySlug: 'nope', categoryLabel: '美食' }, cats)).toEqual({ slug: 'food', label: '美食', isNew: false })
  })
  it('categoryLabel 命中 aliases → 用之', () => {
    expect(resolveActionCategory({ categoryLabel: '灵感' }, cats)).toEqual({ slug: 'idea', label: '想法', isNew: false })
  })
  it('都不中 → 新涌现类别（slug 化 label，isNew=true）', () => {
    expect(resolveActionCategory({ categoryLabel: '旅行 游记' }, cats)).toEqual({ slug: '旅行-游记', label: '旅行 游记', isNew: true })
  })
  it('只有未命中 slug 无 label → 以 slug 为 label 造新类别', () => {
    const r = resolveActionCategory({ categorySlug: 'travel' }, cats)
    expect(r).toEqual({ slug: 'travel', label: 'travel', isNew: true })
  })
})
