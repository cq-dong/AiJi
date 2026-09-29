import { describe, it, expect, beforeEach } from 'vitest'
import { setCurrentLang } from '@/app/currentLang'
import { buildAnswerPrompt } from '@/adapters/openAiCompatLlm'

// 问 AI 能力大补（2026-09-29）answer 轮扩展：
// extraSystem（第 5 参）拼在 system + memoryBlock 之后——时间行/天气块/搜索块统一注入口；
// conversation[].date 渲染为 [YYYY-MM-DD] 前缀，LLM 可解析「昨天说的」等跨天指代。

beforeEach(() => setCurrentLang('zh'))

const cites = [
  { id: 'e1', createdAt: '2026-07-17T10:00:00+08:00', categorySlug: 'idea', tags: [], textExcerpt: '跑步时想到的' },
]

describe('buildAnswerPrompt · extraSystem', () => {
  it('拼接位置：在 memoryBlock 之后', () => {
    const msgs = buildAnswerPrompt('q?', cites, [], ['我喜欢跑步'], '当前时间：2026-09-29 周二 10:30')
    const system = msgs[0].content as string
    const memIdx = system.indexOf('我喜欢跑步')
    const extraIdx = system.indexOf('当前时间：2026-09-29 周二 10:30')
    expect(memIdx).toBeGreaterThan(-1)
    expect(extraIdx).toBeGreaterThan(memIdx)
    expect(system.endsWith('当前时间：2026-09-29 周二 10:30')).toBe(true)
  })

  it('省略/undefined/空串 extraSystem → 三种调用逐字节一致', () => {
    const a = buildAnswerPrompt('q?', cites, [], ['我喜欢跑步'])
    const b = buildAnswerPrompt('q?', cites, [], ['我喜欢跑步'], undefined)
    const c = buildAnswerPrompt('q?', cites, [], ['我喜欢跑步'], '')
    expect(a).toEqual(b)
    expect(a).toEqual(c)
    expect(a[0].content as string).not.toContain('当前时间')
  })

  it('无记忆 + 有 extraSystem：system 以 extraSystem 收尾（不依赖 memoryBlock 存在）', () => {
    const msgs = buildAnswerPrompt('q?', cites, [], undefined, '天气数据：北京 晴 25°C')
    expect((msgs[0].content as string).endsWith('天气数据：北京 晴 25°C')).toBe(true)
  })
})

describe('buildAnswerPrompt · conversation date 前缀', () => {
  it('带 date 的历史渲染为 [YYYY-MM-DD] 前缀；不带 date 原样', () => {
    const msgs = buildAnswerPrompt('昨天说的那个呢', cites, [
      { role: 'user', content: '桂花拿铁真好喝', date: '2026-09-28' },
      { role: 'assistant', content: '确实不错', date: '2026-09-28' },
      { role: 'user', content: '今天又想喝了' },
    ])
    expect(msgs[1]).toEqual({ role: 'user', content: '[2026-09-28] 桂花拿铁真好喝' })
    expect(msgs[2]).toEqual({ role: 'assistant', content: '[2026-09-28] 确实不错' })
    expect(msgs[3]).toEqual({ role: 'user', content: '今天又想喝了' })
    // 最后一条是当前问题，不被前缀
    expect(msgs[4]).toEqual({ role: 'user', content: '昨天说的那个呢' })
  })

  it('prompt 规则含日期前缀说明（zh+en）', () => {
    const zh = buildAnswerPrompt('q?', cites, [])[0].content as string
    expect(zh).toContain('[YYYY-MM-DD]')
    expect(zh).toContain('昨天说的')
    setCurrentLang('en')
    const en = buildAnswerPrompt('q?', cites, [])[0].content as string
    expect(en).toContain('[YYYY-MM-DD]')
    expect(en).toContain('date prefix')
  })

  // Finding 5（2026-09-29 rc9）：模型模仿历史 [日期] 前缀格式，把回答正文以 [YYYY-MM-DD] 开头——
  // prompt 侧引导：[日期] 前缀仅是元数据，回答正文不要以 [日期] 开头。
  it('prompt 规则含「回答正文不要以 [日期] 开头」（zh+en）', () => {
    const zh = buildAnswerPrompt('q?', cites, [])[0].content as string
    expect(zh).toContain('前缀仅是元数据')
    expect(zh).toContain('回答正文不要以 [日期] 开头')
    setCurrentLang('en')
    const en = buildAnswerPrompt('q?', cites, [])[0].content as string
    expect(en).toContain('metadata only')
    expect(en).toContain('never begin your answer')
  })
})
