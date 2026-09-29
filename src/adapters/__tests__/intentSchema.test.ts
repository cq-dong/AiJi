import { describe, it, expect, beforeEach } from 'vitest'
import { setCurrentLang } from '@/app/currentLang'
import { buildIntentPrompt, parseIntentJson } from '@/adapters/openAiCompatLlm'

// 问 AI 能力大补（2026-09-29）intent 轮扩展：
// kind 判别（recall/weather/search/action）+ timeIntent + city + action 四组新字段，
// zh+en 双语 schema 同步；parseIntentJson 白名单严格校验，非法值丢弃不流入 ChatQuery。

beforeEach(() => setCurrentLang('zh'))

describe('parseIntentJson · 新字段白名单', () => {
  it('四种 kind：weather/search/action 收下，recall 归一为 undefined', () => {
    expect(parseIntentJson('{"kind":"weather","scope":null,"keywords":[]}').kind).toBe('weather')
    expect(parseIntentJson('{"kind":"search","scope":null,"keywords":[]}').kind).toBe('search')
    expect(parseIntentJson('{"kind":"action","scope":null,"keywords":[],"action":{"entryHint":"那条"}}').kind).toBe('action')
    expect(parseIntentJson('{"kind":"recall","scope":null,"keywords":[]}').kind).toBeUndefined()
  })

  it('非法 kind（未知字符串/数字/布尔）→ undefined', () => {
    expect(parseIntentJson('{"kind":"bogus","scope":null,"keywords":[]}').kind).toBeUndefined()
    expect(parseIntentJson('{"kind":1,"scope":null,"keywords":[]}').kind).toBeUndefined()
    expect(parseIntentJson('{"kind":true,"scope":null,"keywords":[]}').kind).toBeUndefined()
  })

  it('timeIntent 严格 ===true 才收，其余（false/"true"/1）→ undefined', () => {
    expect(parseIntentJson('{"timeIntent":true,"scope":null,"keywords":[]}').timeIntent).toBe(true)
    expect(parseIntentJson('{"timeIntent":false,"scope":null,"keywords":[]}').timeIntent).toBeUndefined()
    expect(parseIntentJson('{"timeIntent":"true","scope":null,"keywords":[]}').timeIntent).toBeUndefined()
    expect(parseIntentJson('{"timeIntent":1,"scope":null,"keywords":[]}').timeIntent).toBeUndefined()
  })

  it('city：非空 string 才收；空串/纯空白/非 string 丢弃', () => {
    expect(parseIntentJson('{"city":"北京","scope":null,"keywords":[]}').city).toBe('北京')
    expect(parseIntentJson('{"city":"","scope":null,"keywords":[]}').city).toBeUndefined()
    expect(parseIntentJson('{"city":"   ","scope":null,"keywords":[]}').city).toBeUndefined()
    expect(parseIntentJson('{"city":123,"scope":null,"keywords":[]}').city).toBeUndefined()
  })

  it('action：entryHint 非空 string 才整体收；缺 entryHint/空串/非对象 → 丢弃', () => {
    const q = parseIntentJson('{"action":{"entryHint":"桂花拿铁那条","categorySlug":"food","categoryLabel":"美食"},"scope":null,"keywords":[]}')
    expect(q.action).toEqual({ entryHint: '桂花拿铁那条', categorySlug: 'food', categoryLabel: '美食' })
    expect(parseIntentJson('{"action":{"categorySlug":"food"},"scope":null,"keywords":[]}').action).toBeUndefined()
    expect(parseIntentJson('{"action":{"entryHint":""},"scope":null,"keywords":[]}').action).toBeUndefined()
    expect(parseIntentJson('{"action":{"entryHint":"  "},"scope":null,"keywords":[]}').action).toBeUndefined()
    expect(parseIntentJson('{"action":"food","scope":null,"keywords":[]}').action).toBeUndefined()
  })

  it('action 字段裁剪：空 categorySlug/categoryLabel 丢弃，未知字段忽略', () => {
    const q = parseIntentJson('{"action":{"entryHint":"那条","categorySlug":"","categoryLabel":42,"foo":"bar"},"scope":null,"keywords":[]}')
    expect(q.action).toEqual({ entryHint: '那条' })
  })

  it('未知顶层字段忽略；旧字段（scope/keywords/categorySlugs）行为不变', () => {
    const q = parseIntentJson('{"scope":{"type":"day","range":"2026-09-29"},"keywords":["跑步"],"categorySlugs":["idea"],"unknown":"x"}')
    expect(q.scope).toEqual({ type: 'day', range: '2026-09-29' })
    expect(q.keywords).toEqual(['跑步'])
    expect(q.categorySlugs).toEqual(['idea'])
    expect((q as Record<string, unknown>).unknown).toBeUndefined()
    // 旧回归：categorySlugs 空数组 → undefined
    expect(parseIntentJson('{"scope":null,"keywords":[],"categorySlugs":[]}').categorySlugs).toBeUndefined()
    expect(parseIntentJson('{"scope":null,"keywords":[]}').kind).toBeUndefined()
  })
})

describe('buildIntentPrompt · schema 双语扩展', () => {
  it('zh：schema 含 kind/timeIntent/city/action/entryHint 字段名 + 判别规则', () => {
    const content = buildIntentPrompt('北京今天冷吗', '2026-09-29T10:30:00+08:00')[0].content as string
    for (const s of ['"kind"', '"timeIntent"', '"city"', '"action"', '"entryHint"', 'recall|weather|search|action']) {
      expect(content).toContain(s)
    }
    expect(content).toContain('实时天气')
    expect(content).toContain('需要联网')
    expect(content).toContain('修改某条记的分类')
  })

  it('en：schema 同构（字段名一致）+ 英文判别规则', () => {
    setCurrentLang('en')
    const content = buildIntentPrompt('is it cold in Beijing', '2026-09-29T10:30:00+08:00')[0].content as string
    for (const s of ['"kind"', '"timeIntent"', '"city"', '"action"', '"entryHint"', 'recall|weather|search|action']) {
      expect(content).toContain(s)
    }
    expect(content).toContain('English')
  })

  it('categories 注入：现有类别列表（slug:label）进入 prompt', () => {
    const msgs = buildIntentPrompt('把桂花拿铁那条改成美食', '2026-09-29T10:30:00+08:00', [
      { slug: 'food', label: '美食' },
      { slug: 'idea', label: '想法' },
    ])
    const user = msgs[msgs.length - 1].content as string
    expect(user).toContain('现有类别')
    expect(user).toContain('food:美食')
    expect(user).toContain('idea:想法')
  })

  it('缺省 categories（省略/空数组）→ 不注入，user message 与旧版逐字节一致', () => {
    const a = buildIntentPrompt('桂花拿铁那条', '2026-09-29T10:30:00+08:00')
    const b = buildIntentPrompt('桂花拿铁那条', '2026-09-29T10:30:00+08:00', undefined)
    const c = buildIntentPrompt('桂花拿铁那条', '2026-09-29T10:30:00+08:00', [])
    expect(a).toEqual(b)
    expect(a).toEqual(c)
    const user = a[a.length - 1].content as string
    expect(user).not.toContain('现有类别')
    expect(user).toBe('问句：桂花拿铁那条\n当前时间：2026-09-29T10:30:00+08:00\n输出 JSON。')
  })
})
