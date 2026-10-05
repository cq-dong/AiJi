import { describe, it, expect, beforeEach } from 'vitest'
import { setCurrentLang } from '@/app/currentLang'
import {
  buildIntentPrompt,
  buildProactiveGreetingPrompt,
  parseIntentJson,
} from '@/adapters/llmShared'
import type { ProactiveGreetingContext } from '@/ports'

// P-F 陪伴深化包（docs/acceptance/pf-companion-pack.md §①③，2026-10-05）：
// ① greeting prompt —— ctx.onThisDay 在 → user 块加一行往年今日线索（zh+en 对称）；
//    不在 → 不加行（与旧版逐字节一致）；system 规则 2 承接线索清单加「往年今日的回忆」。
// ③ intent prompt —— action 分支 schema 扩 op（changeCategory 缺省 / createReminder / deleteEntry）
//    + reminderLabel + dueAt（自然语言时间以 nowIso 为锚解析 ISO 8601，解析不出省略），
//    zh+en 各加 createReminder/deleteEntry 示例；parseIntentJson 白名单三字段严格校验。
// builtinLlm 与 BYOK 同源（import 同一 build/parse helper），此处单源覆盖双适配器。

beforeEach(() => setCurrentLang('zh'))

const ctxBase: ProactiveGreetingContext = {
  daypart: 'morning',
  recentEntryCount7d: 1,
  daysSinceLastEntry: 1,
  openLoops: [],
  dueReminderCount: 0,
}
const ctxEcho: ProactiveGreetingContext = {
  ...ctxBase,
  onThisDay: { yearsAgo: 2, excerpt: '在江边看日落' },
}

describe('buildProactiveGreetingPrompt · onThisDay', () => {
  it('zh：onThisDay 在 → user 含「2 年前的今天 Ta 记了：在江边看日落」', () => {
    const user = buildProactiveGreetingPrompt(ctxEcho)[1].content as string
    expect(user).toContain('2 年前的今天 Ta 记了：在江边看日落')
  })

  it('zh：onThisDay 不在 → user 无该行', () => {
    const user = buildProactiveGreetingPrompt(ctxBase)[1].content as string
    expect(user).not.toContain('年前的今天')
  })

  it('zh：system 规则 2 承接线索清单含「往年今日的回忆」（与 onThisDay 有无无关）', () => {
    const system = buildProactiveGreetingPrompt(ctxBase)[0].content as string
    expect(system).toContain('往年今日的回忆')
  })

  it('en：onThisDay 在 → user 含对称行；不在 → 无该行；system 清单含往年今日线索', () => {
    setCurrentLang('en')
    const user1 = buildProactiveGreetingPrompt(ctxEcho)[1].content as string
    expect(user1).toContain('2 year(s) ago today they recorded: 在江边看日落')
    const user0 = buildProactiveGreetingPrompt(ctxBase)[1].content as string
    expect(user0).not.toContain('ago today')
    const system = buildProactiveGreetingPrompt(ctxBase)[0].content as string
    expect(system).toContain('a memory from this day in previous years')
  })
})

describe('buildIntentPrompt · action op 扩展', () => {
  it('zh：schema 含 op/reminderLabel/dueAt + createReminder/deleteEntry 示例', () => {
    const content = buildIntentPrompt('明天下午三点提醒我交稿', '2026-07-17T10:30:00+08:00')[0].content as string
    for (const s of [
      '"op"',
      'changeCategory',
      'createReminder',
      'deleteEntry',
      '"reminderLabel"',
      '"dueAt"',
      '明天下午三点提醒我交稿',
      '把桂花拿铁那条删了',
    ]) {
      expect(content).toContain(s)
    }
  })

  it('en：schema 同构 + 对称示例', () => {
    setCurrentLang('en')
    const content = buildIntentPrompt('remind me to submit the draft at 3pm tomorrow', '2026-07-17T10:30:00+08:00')[0].content as string
    for (const s of [
      '"op"',
      'changeCategory',
      'createReminder',
      'deleteEntry',
      '"reminderLabel"',
      '"dueAt"',
      'remind me to submit the draft',
      'delete the osmanthus latte one',
    ]) {
      expect(content).toContain(s)
    }
  })
})

describe('parseIntentJson · action op 白名单', () => {
  it('三个合法 op 收下（changeCategory / createReminder / deleteEntry）', () => {
    for (const op of ['changeCategory', 'createReminder', 'deleteEntry'] as const) {
      const q = parseIntentJson(
        `{"kind":"action","scope":null,"keywords":[],"action":{"op":"${op}","entryHint":"那条"}}`,
      )
      expect(q.action?.op).toBe(op)
    }
  })

  it('非法 op（未知字符串 / 数字 / 布尔）→ 丢弃该字段，action 其余字段保留', () => {
    const q = parseIntentJson(
      '{"kind":"action","scope":null,"keywords":[],"action":{"op":"bogus","entryHint":"那条","categorySlug":"food"}}',
    )
    expect(q.action).toEqual({ entryHint: '那条', categorySlug: 'food' })
    const q2 = parseIntentJson(
      '{"kind":"action","scope":null,"keywords":[],"action":{"op":1,"entryHint":"那条"}}',
    )
    expect(q2.action).toEqual({ entryHint: '那条' })
    const q3 = parseIntentJson(
      '{"kind":"action","scope":null,"keywords":[],"action":{"op":true,"entryHint":"那条"}}',
    )
    expect(q3.action).toEqual({ entryHint: '那条' })
  })

  it('reminderLabel / dueAt 非空字符串才收；空串 / 纯空白 / 非字符串丢弃', () => {
    const q = parseIntentJson(
      '{"kind":"action","scope":null,"keywords":[],"action":{"op":"createReminder","entryHint":"交稿","reminderLabel":"交稿","dueAt":"2026-07-18T15:00:00+08:00"}}',
    )
    expect(q.action).toEqual({
      op: 'createReminder',
      entryHint: '交稿',
      reminderLabel: '交稿',
      dueAt: '2026-07-18T15:00:00+08:00',
    })
    const bad = parseIntentJson(
      '{"kind":"action","scope":null,"keywords":[],"action":{"op":"createReminder","entryHint":"交稿","reminderLabel":"  ","dueAt":123}}',
    )
    expect(bad.action).toEqual({ op: 'createReminder', entryHint: '交稿' })
  })

  it('缺新字段旧行为兼容：无 op/reminderLabel/dueAt 的 action 与旧版一致', () => {
    const q = parseIntentJson(
      '{"kind":"action","scope":null,"keywords":[],"action":{"entryHint":"桂花拿铁那条","categorySlug":"food","categoryLabel":"美食"}}',
    )
    expect(q.action).toEqual({ entryHint: '桂花拿铁那条', categorySlug: 'food', categoryLabel: '美食' })
  })
})
