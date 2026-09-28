import { describe, it, expect } from 'vitest'
import { iterateSse, extractPartialAnswer } from '@/adapters/sseStream'

// iterateSse / extractPartialAnswer 是纯函数+流解析（无 I/O），直接测。
// 背景（2026-09-28 问 AI 流式输出）：BYOK/builtin 两条链路共用 SSE 解析；
// 流式期间气泡逐字渲染需要从**不完整** JSON 封包增量提取 answer 可见文本。

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

async function collect(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const p of iterateSse(body)) out.push(p)
  return out
}

describe('iterateSse', () => {
  it('单 chunk 完整帧序列 + [DONE] 终止', async () => {
    const s = streamOf(['data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n'])
    expect(await collect(s)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('[DONE] 后的帧不再产出', async () => {
    const s = streamOf(['data: a\n\ndata: [DONE]\n\ndata: b\n\n'])
    expect(await collect(s)).toEqual(['a'])
  })

  it('跨 chunk 拆帧：帧边界落在 chunk 中间', async () => {
    const s = streamOf(['data: {"a"', ':1}\n\nda', 'ta: {"b":2}\n\n'])
    expect(await collect(s)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('多字节字符跨 chunk 边界（TextDecoder stream 模式）', async () => {
    const bytes = new TextEncoder().encode('data: 你好\n\n')
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        // 在「你」的 3 字节中间切开
        c.enqueue(bytes.slice(0, 8))
        c.enqueue(bytes.slice(8))
        c.close()
      },
    })
    expect(await collect(s)).toEqual(['你好'])
  })

  it('\\r\\n 行尾 + \\r\\n\\r\\n 分帧', async () => {
    const s = streamOf(['data: x\r\n\r\ndata: y\r\n\r\n'])
    expect(await collect(s)).toEqual(['x', 'y'])
  })

  it('一帧多 data 行按 SSE 规范以 \\n 拼接', async () => {
    const s = streamOf(['data: line1\ndata: line2\n\n'])
    expect(await collect(s)).toEqual(['line1\nline2'])
  })

  it('keep-alive 注释行与空帧跳过', async () => {
    const s = streamOf([': ping\n\ndata: a\n\n: ping\n\n\n\ndata: b\n\n'])
    expect(await collect(s)).toEqual(['a', 'b'])
  })

  it('data: 后无空格也解析（规范只剥一个前导空格）', async () => {
    const s = streamOf(['data:x\n\ndata:  y\n\n'])
    expect(await collect(s)).toEqual(['x', ' y'])
  })

  it('非 data 字段行（event:/id:/retry:）忽略', async () => {
    const s = streamOf(['event: message\nid: 7\ndata: a\nretry: 3000\n\n'])
    expect(await collect(s)).toEqual(['a'])
  })

  it('流末无分帧空行的残余帧宽容产出（代理截尾常见）', async () => {
    const s = streamOf(['data: a\n\ndata: tail'])
    expect(await collect(s)).toEqual(['a', 'tail'])
  })

  it('空 data 帧跳过', async () => {
    const s = streamOf(['data:\n\ndata: a\n\n'])
    expect(await collect(s)).toEqual(['a'])
  })

  // m3（2026-09-28 流式验收）：[DONE] 容忍尾随空白——代理可能产出 `data: [DONE] ` 带空格。
  it('[DONE] 带尾随空格 → 正常终止，后续帧不产出', async () => {
    const s = streamOf(['data: a\n\ndata: [DONE] \n\ndata: b\n\n'])
    expect(await collect(s)).toEqual(['a'])
  })

  it('流末残余 [DONE]（带尾随空格、无分帧空行）不产出', async () => {
    const s = streamOf(['data: a\n\ndata: [DONE]  '])
    expect(await collect(s)).toEqual(['a'])
  })

  // m4：消费方提前退出（break）→ reader.cancel() 释放底层网络流（不只 releaseLock）。
  it('提前退出 → 底层流被 cancel（ReadableStream cancel 回调触发）', async () => {
    let cancelled = false
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: a\n\ndata: b\n\n'))
        // 不 close：模拟仍在流的慢响应
      },
      cancel() {
        cancelled = true
      },
    })
    for await (const p of iterateSse(s)) {
      void p
      break // 取一帧即退出
    }
    expect(cancelled).toBe(true)
  })
})

describe('extractPartialAnswer', () => {
  it('完整封包 → answer 文本', () => {
    expect(extractPartialAnswer('{"answer": "你好，世界。","citedEntryIds": ["a"]}')).toBe('你好，世界。')
  })

  it('半截封包 → 已有部分', () => {
    expect(extractPartialAnswer('{"answer": "你好，世')).toBe('你好，世')
  })

  it('无信封散文 → 原样返回（不反转义）', () => {
    expect(extractPartialAnswer('这是散文回答，没写 JSON')).toBe('这是散文回答，没写 JSON')
    expect(extractPartialAnswer('散文里的 \\n 不是转义')).toBe('散文里的 \\n 不是转义')
  })

  it('信封前缀未到（```json / {"ans）→ 空串', () => {
    expect(extractPartialAnswer('')).toBe('')
    expect(extractPartialAnswer('{"ans')).toBe('')
    expect(extractPartialAnswer('```json\n{')).toBe('')
  })

  it('markdown 围栏封包 → 正常提取', () => {
    expect(extractPartialAnswer('```json\n{"answer": "你好')).toBe('你好')
  })

  it('citedEntryIds 边界截断（回扫空白/逗号/引号）', () => {
    expect(extractPartialAnswer('{"answer": "回答。", "citedEntryIds": ["a')).toBe('回答。')
    expect(extractPartialAnswer('{"answer": "回答。","citedEntryIds":[]}')).toBe('回答。')
  })

  it('边界未到达但 answer 闭合引号已出 → 剥结构性收尾引号/逗号', () => {
    expect(extractPartialAnswer('{"answer": "回答。"')).toBe('回答。')
    expect(extractPartialAnswer('{"answer": "回答。", ')).toBe('回答。')
  })

  it('answer 内转义引号不误判为闭合（奇数反斜杠）', () => {
    expect(extractPartialAnswer('{"answer": "他说\\"你好')).toBe('他说"你好')
    expect(extractPartialAnswer('{"answer": "他说\\"你好\\"。"')).toBe('他说"你好"。')
  })

  it('尾部半截转义丢弃：奇数反斜杠结尾', () => {
    expect(extractPartialAnswer('{"answer": "你说\\')).toBe('你说')
  })

  it('尾部半截转义丢弃：\\u 未齐 4 位', () => {
    expect(extractPartialAnswer('{"answer": "\\u4f6')).toBe('')
    expect(extractPartialAnswer('{"answer": "A\\u0041\\u004')).toBe('AA')
  })

  it('可见部分反转义（\\n \\" \\uXXXX \\\\）', () => {
    expect(extractPartialAnswer('{"answer": "第一行\\n第二行\\"引号\\"\\u4e16')).toBe('第一行\n第二行"引号"世')
    expect(extractPartialAnswer('{"answer": "路径 C:\\\\Users')).toBe('路径 C:\\Users')
  })

  it('无引号 key 封包（{answer: "..."）→ 正常提取', () => {
    expect(extractPartialAnswer('{answer: "今天天气不错')).toBe('今天天气不错')
  })

  // M1（2026-09-28 流式验收）：citedEntryIds 边界逐 token 流出时，中间态 `回答","`、
  // `回答","c`、`回答","citedEnt` 等不得上屏——80ms 节流保证 1-2 帧垃圾，每条带引用回答必经。
  it('M1: citedEntryIds 边界逐 token 中间态不泄结构残段', () => {
    const full = '{"answer": "回答文本","citedEntryIds": ["a"]}'
    const boundary = full.indexOf('","citedEntryIds')
    // 从 answer 闭合前一位到 citedEntryIds 全量到达：每一帧可见文本都应是完整正文
    for (let end = boundary; end < full.length; end++) {
      expect(extractPartialAnswer(full.slice(0, end + 1)), `slice(0,${end + 1})`).toBe('回答文本')
    }
  })

  it('M1: 不误剥正文——answer 未闭合时尾部逗号/字母原样保留', () => {
    // answer 正文自身以逗号结尾（串未闭合）→ 保留
    expect(extractPartialAnswer('{"answer": "第一段，')).toBe('第一段，')
    // answer 正文以字母结尾且字母是 citedEntryIds 前缀（串未闭合，如 prose 含 "cit"）→ 保留
    expect(extractPartialAnswer('{"answer": "我查到 cit')).toBe('我查到 cit')
    // answer 正文含转义引号结尾（未闭合）→ 保留并反转义
    expect(extractPartialAnswer('{"answer": "他说\\"你好\\"')).toBe('他说"你好"')
  })

  // m2：前缀未明阶段（还可能是信封的半截前缀）保守不显示结构字符；能判定非信封立即放行。
  // 旧实现「{ / 反引号开头 → 整轮空白」——散文以 { 开头或 markdown 代码块会被永久吞掉。
  it('m2: 信封半截前缀阶段保守不显示', () => {
    expect(extractPartialAnswer('`')).toBe('')
    expect(extractPartialAnswer('``')).toBe('')
    expect(extractPartialAnswer('```')).toBe('')
    expect(extractPartialAnswer('```js')).toBe('') // 仍可能长成 ```json
    expect(extractPartialAnswer('{')).toBe('')
    expect(extractPartialAnswer('{"')).toBe('')
    expect(extractPartialAnswer('{"answer')).toBe('')
    expect(extractPartialAnswer('{"answer"')).toBe('')
    expect(extractPartialAnswer('{"answer":')).toBe('')
    expect(extractPartialAnswer('{ "answer" :')).toBe('')
  })

  it('m2: 判定非信封（散文以 {/反引号开头）→ 立即放行整段', () => {
    expect(extractPartialAnswer('{有点想法}')).toBe('{有点想法}')
    expect(extractPartialAnswer('{x')).toBe('{x')
    expect(extractPartialAnswer('`code`')).toBe('`code`')
    expect(extractPartialAnswer('```jsx 代码')).toBe('```jsx 代码') // 已分叉（x≠o），非 ```json 信封
    expect(extractPartialAnswer('```json\nhello')).toBe('```json\nhello') // 围栏内非信封散文
    expect(extractPartialAnswer('{"answers": 1}')).toBe('{"answers": 1}') // key 分叉
  })

  // m5：未知转义与 parseAnswerJson 收口对齐——保留反斜杠字面（\x→\x），
  // JSON 合法转义（\/ \" \\）仍取字面值。
  it('m5: 未知转义保留反斜杠（与 parseAnswerJson 对齐），合法转义仍解析', () => {
    expect(extractPartialAnswer('{"answer": "路径 C:\\x\\y')).toBe('路径 C:\\x\\y')
    expect(extractPartialAnswer('{"answer": "a\\/b')).toBe('a/b')
    expect(extractPartialAnswer('{"answer": "引\\"号')).toBe('引"号')
  })
})
