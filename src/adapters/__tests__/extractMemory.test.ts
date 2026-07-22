import { describe, it, expect, beforeEach } from 'vitest'
import { setCurrentLang } from '@/app/currentLang'
import { buildExtractMemoryPrompt, parseMemoryReply } from '@/adapters/openAiCompatLlm'

// buildExtractMemoryPrompt / parseMemoryReply 是纯函数（无 I/O），直接测。
// 镜像 aiMemory.test.ts 的 buildPrompt/buildAnswerPrompt 纯函数测法。
// 提示词双语化后默认 en（jsdom navigator.language=en-US）；本文件断言 zh 契约字样，
// 故 beforeEach 锁 zh（最小适配，不改变断言语义）。

beforeEach(() => setCurrentLang('zh'))

describe('buildExtractMemoryPrompt', () => {
  it('system 含记忆提取器身份 + NULL 输出约定 + 事实/偏好/归类指令三类', () => {
    const msgs = buildExtractMemoryPrompt('帮我记住我对花生过敏')
    const system = msgs[0].content as string
    expect(system).toContain('记忆提取器')
    expect(system).toContain('NULL')
    expect(system).toContain('事实')
    expect(system).toContain('偏好')
    expect(system).toContain('归类指令')
  })

  it('user message 含用户原话', () => {
    const msgs = buildExtractMemoryPrompt('别忘了我对花生过敏')
    const user = msgs[msgs.length - 1].content as string
    expect(user).toContain('别忘了我对花生过敏')
  })

  it('返回 system + user 两条消息', () => {
    const msgs = buildExtractMemoryPrompt('记一下我每天 7 点起')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
  })
})

describe('parseMemoryReply', () => {
  it('NULL（大小写不敏感 / 带空白）→ null', () => {
    expect(parseMemoryReply('NULL')).toBeNull()
    expect(parseMemoryReply('null')).toBeNull()
    expect(parseMemoryReply('  NULL  ')).toBeNull()
    expect(parseMemoryReply('Null')).toBeNull()
  })

  it('空串 / 纯空白 → null', () => {
    expect(parseMemoryReply('')).toBeNull()
    expect(parseMemoryReply('   ')).toBeNull()
    expect(parseMemoryReply('\n\t')).toBeNull()
  })

  it('正常记忆文本 → 原样返回', () => {
    expect(parseMemoryReply('我对花生过敏')).toBe('我对花生过敏')
    expect(parseMemoryReply('螺蛳粉相关条目都归到 food 类')).toBe('螺蛳粉相关条目都归到 food 类')
  })

  it('半角双引号包裹 → 去引号返回', () => {
    expect(parseMemoryReply('"我对花生过敏"')).toBe('我对花生过敏')
  })

  it('全角引号 / 角括号包裹 → 去引号返回', () => {
    expect(parseMemoryReply('“我对花生过敏”')).toBe('我对花生过敏')
    expect(parseMemoryReply('「我对花生过敏」')).toBe('我对花生过敏')
    expect(parseMemoryReply('『我对花生过敏』')).toBe('我对花生过敏')
  })

  it('markdown 围栏包裹 → 抽出正文', () => {
    expect(parseMemoryReply('```\n我对花生过敏\n```')).toBe('我对花生过敏')
    expect(parseMemoryReply('```json\n我对花生过敏\n```')).toBe('我对花生过敏')
  })

  it('围栏内为 NULL → null', () => {
    expect(parseMemoryReply('```\nNULL\n```')).toBeNull()
  })
})
