import { describe, it, expect, beforeEach } from 'vitest'
import { setCurrentLang } from '@/app/currentLang'
import {
  buildPrompt,
  buildAnswerPrompt,
  buildExtractMemoryPrompt,
  buildAggregatePrompt,
  buildIntentPrompt,
} from '@/adapters/openAiCompatLlm'

// 提示词按 currentLang 生成 zh/en 两份系统提示。default 测试环境 lang=en（jsdom
// navigator.language=en-US），故每个用例显式 setCurrentLang 锁定被测语言，避免
// 与模块默认串扰。仅断言「语言约束行 + 契约字样」这类不随措辞漂移的稳定信号。

beforeEach(() => setCurrentLang('zh'))

describe('提示词按语言生成', () => {
  it('zh：buildPrompt 系统提示含中文约束', () => {
    const msgs = buildPrompt('内容', '2026-07-22T00:00:00Z', [], [], false)
    expect(JSON.stringify(msgs)).toContain('简体中文')
  })

  it('en：buildPrompt 含 English 约束且不含「简体中文」', () => {
    setCurrentLang('en')
    const s = JSON.stringify(buildPrompt('content', '2026-07-22T00:00:00Z', [], [], false))
    expect(s).toContain('English')
    expect(s).not.toContain('简体中文')
  })

  it('en：buildAnswerPrompt/buildExtractMemoryPrompt/buildAggregatePrompt/buildIntentPrompt 同为英文提示', () => {
    setCurrentLang('en')
    expect(JSON.stringify(buildAnswerPrompt('q?', [], []))).toContain('English')
    expect(JSON.stringify(buildExtractMemoryPrompt('remember I am allergic to peanuts'))).toContain('English')
    expect(
      JSON.stringify(
        buildAggregatePrompt(
          [{ id: 'e1', text: 'content', imageCount: 0, videoCount: 0 }],
          'day',
          3,
        ),
      ),
    ).toContain('English')
    expect(JSON.stringify(buildIntentPrompt('what did I write', '2026-07-22T00:00:00Z'))).toContain('English')
  })

  it('zh 回归：buildExtractMemoryPrompt 仍含「记忆」契约字样', () => {
    expect(JSON.stringify(buildExtractMemoryPrompt('记住我不吃香菜'))).toContain('记忆')
  })
})
