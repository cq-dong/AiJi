import { describe, it, expect } from 'vitest'
import { parseAnswerJson, sanitizeInlineCites } from '@/adapters/llmShared'

// parseAnswerJson / sanitizeInlineCites 是纯函数（无 I/O），直接测。
// 背景：answer 轮 LLM 偶发不遵守纯 JSON 封包，输出散文 + 末尾 JS 风格
// `citedEntryIds: ["uuid",...]`（key 无引号），兜底路径把原始尾巴透传进 answer 正文，
// 聊天气泡泄露该片段。修复 = 尾部片段剥离 + id 回收 + 内联多 id 引用清洗。

describe('parseAnswerJson', () => {
  it('合法 JSON 封包：行为不变（回归）', () => {
    const raw = '{"answer":"你好，这是回答。","citedEntryIds":["a","b"]}'
    expect(parseAnswerJson(raw)).toEqual({ answer: '你好，这是回答。', citedEntryIds: ['a', 'b'] })
  })

  it('纯散文 + 末尾 citedEntryIds 片段（无信封无括号）：剥离尾巴并回收 id', () => {
    const raw = '这是散文回答，模型没写 JSON。citedEntryIds: ["a","b"]'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('这是散文回答，模型没写 JSON。')
    expect(r.citedEntryIds).toEqual(['a', 'b'])
  })

  it('无引号 key 的类 JSON：{answer: "...", citedEntryIds: ["a"]} → answer 干净、id 回收', () => {
    const raw = '{answer: "今天天气不错", citedEntryIds: ["a"]}'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('今天天气不错')
    expect(r.citedEntryIds).toEqual(['a'])
  })

  it('截断 JSON（D37）回归：能抽出 answer 字段', () => {
    const raw = '{"answer": "这是回答（见 a）", "citedEntryIds": ["a'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('这是回答（见 a）')
    expect(r.citedEntryIds).toEqual([])
  })

  it('截断 JSON 且 answer 内含尾巴片段：抽出的 answer 也要剥尾', () => {
    const raw = '{"answer": "回答正文 citedEntryIds: [\\"a\\",\\"b\\"]", "cited'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('回答正文')
    expect(r.citedEntryIds).toEqual(['a', 'b'])
  })

  it('末尾 citedEntryIds: [] 空数组：剥离、无 id', () => {
    const raw = '这是回答。citedEntryIds: []'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('这是回答。')
    expect(r.citedEntryIds).toEqual([])
  })

  it('正文中间提及 citedEntryIds 但不在末尾：不误删', () => {
    const raw = '回答里提到 citedEntryIds 字段该怎么用，就这样。'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('回答里提到 citedEntryIds 字段该怎么用，就这样。')
    expect(r.citedEntryIds).toEqual([])
  })

  it('M1：中间有 key: [...] 形态 + 末尾挂真实片段 → 只剥末尾，中间正文保留', () => {
    const raw = '说明：citedEntryIds: ["idA"] 是引用列表。你的答案是：今天去了公园。citedEntryIds: ["e1"]'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('说明：citedEntryIds: ["idA"] 是引用列表。你的答案是：今天去了公园。')
    expect(r.citedEntryIds).toEqual(['e1'])
  })

  it('M2：尾部分号 → 剥离', () => {
    const raw = '回答正文。citedEntryIds: ["e1"];'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('回答正文。')
    expect(r.citedEntryIds).toEqual(['e1'])
  })

  it('M2：全角冒号 → 剥离', () => {
    const raw = '回答正文。citedEntryIds：["e1"]'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('回答正文。')
    expect(r.citedEntryIds).toEqual(['e1'])
  })

  it('minor1：无引号 key 截断（无收尾 }）→ 剥 {answer: 前缀 + 剥尾 + id 回收', () => {
    const raw = '{answer: "今天天气不错", citedEntryIds: ["a"]'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('今天天气不错')
    expect(r.citedEntryIds).toEqual(['a'])
  })

  it('D37 真 catch 路径：首尾 } 都在但 JSON 非法（数组尾逗号）→ 正则抽 answer', () => {
    const raw = '{"answer": "这是回答", "citedEntryIds": ["a",]}'
    const r = parseAnswerJson(raw)
    expect(r.answer).toBe('这是回答')
    expect(r.citedEntryIds).toEqual([])
  })
})

describe('sanitizeInlineCites', () => {
  it('单 id 合法：原样保留（回归）', () => {
    expect(sanitizeInlineCites('这是回答（见 a）。', new Set(['a']))).toBe('这是回答（见 a）。')
  })

  it('单 id 非法：整段引用标记删除（含前导空白，回归）', () => {
    expect(sanitizeInlineCites('这是回答 （见 x）。', new Set(['a']))).toBe('这是回答。')
  })

  it('多 id 部分合法：只留合法 id', () => {
    expect(sanitizeInlineCites('这是回答（见 a、b）。', new Set(['a']))).toBe('这是回答（见 a）。')
  })

  it('多 id 全非法：整段移除', () => {
    expect(sanitizeInlineCites('这是回答 （见 x、y）。', new Set(['a']))).toBe('这是回答。')
  })

  it('多 id 全合法：原样保留', () => {
    expect(sanitizeInlineCites('这是回答（见 a、b）。', new Set(['a', 'b']))).toBe('这是回答（见 a、b）。')
  })

  it('en "(see id1, id2)" 半角括号 + 逗号分隔：部分合法只留合法 id', () => {
    expect(sanitizeInlineCites('Answer (see a, x).', new Set(['a']))).toBe('Answer (see a).')
  })

  it('en 部分合法重建：分隔符用 ", " 而非全角「、」', () => {
    expect(sanitizeInlineCites('Answer (see a, b, x).', new Set(['a', 'b']))).toBe('Answer (see a, b).')
  })

  it('zh 部分合法重建：分隔符用「、」', () => {
    expect(sanitizeInlineCites('这是回答（见 a、b、x）。', new Set(['a', 'b']))).toBe('这是回答（见 a、b）。')
  })
})
