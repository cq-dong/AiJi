// SSE 流式基础设施（2026-09-28 问 AI 流式输出）。BYOK（openAiCompatLlm）/ builtin 两条链路共用：
// - iterateSse：fetch ReadableStream → SSE data 载荷异步迭代。跨 chunk 边界安全
//   （TextDecoder stream 模式 + 行缓冲），`data: ` 行、`\n\n`/`\r\n\r\n` 分帧、
//   `[DONE]` 终止、keep-alive 注释行（`: ping`）与空帧跳过。
// - extractPartialAnswer：流式期间从**不完整** JSON 封包增量提取 answer 可见文本（气泡逐字渲染）。
//   只影响流式过程的瞬时显示；最终落库仍走 parseAnswerJson + sanitizeInlineCites 收口
//   （刚修过的 stripTrailingCitedIds 继续兜底），双口径不漂移。

// 处理一个完整帧（不含分帧空行）：抽 data 行按 SSE 规范以 \n 拼接；注释行/其他字段行忽略。
// 帧无 data → null（跳过）；[DONE] 由调用方判定终止。
function framePayload(frame: string): string | null {
  const lines = frame.split(/\r?\n/)
  const datas: string[] = []
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue // 空行 / keep-alive 注释
    if (!line.startsWith('data:')) continue // event:/id:/retry: 等字段忽略
    // SSE 规范：data: 后至多剥一个前导空格
    datas.push(line.slice(5).replace(/^ /, ''))
  }
  if (datas.length === 0) return null
  const joined = datas.join('\n')
  // 空 data 帧（`data:` 裸行）视同 keep-alive 跳过——LLM 流里无信息量。
  return joined === '' ? null : joined
}

export async function* iterateSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let done = false
  try {
    while (!done) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buf += decoder.decode(value, { stream: true })
      // 分帧：空行（\n\n / \r\n\r\n / \n\r\n 混合兼容）。逐帧弹出，残余留 buf 等下一 chunk。
      for (;;) {
        const m = buf.match(/\r?\n\r?\n/)
        if (!m || m.index === undefined) break
        const frame = buf.slice(0, m.index)
        buf = buf.slice(m.index + m[0].length)
        const payload = framePayload(frame)
        if (payload === null) continue
        // m3: [DONE] 容忍尾随空白/\r——代理可能产出 `data: [DONE] `（trim 只用于判定，不动产出帧）。
        if (payload.trim() === '[DONE]') {
          done = true
          break
        }
        yield payload
      }
    }
    // 流末残余：无分帧空行的尾巴帧宽容产出（代理截尾常见）；[DONE] 后不再产出。
    if (!done) {
      const tail = framePayload(buf)
      if (tail !== null && tail.trim() !== '[DONE]') yield tail
    }
  } finally {
    // m4: 消费方提前退出（break/abort）时除 releaseLock 外必须 cancel——否则底层
    // fetch 流继续后台下载，浪费流量且连接占用不释放。正常结束时 cancel 为 no-op。
    try {
      await reader.cancel()
    } catch {
      // 已关闭/已锁定异常忽略——best-effort 释放
    }
    reader.releaseLock()
  }
}

// 信封前缀：可选 markdown 围栏 + `{"answer": "`（key/冒号兼容无引号、任意空白）。
const ANSWER_PREFIX_RE = /^\s*(?:```(?:json)?\s*)?\{\s*"?answer"?\s*:\s*"?/

// m2: 半截信封前缀判定（在 trimStart 后的 head 上测试，整串锚定）。
// 流式逐 token 到达时，head 可能还是信封前缀的「前缀」（`、```、```js、{、{"、{"ans、{"answer": 等）
// ——此阶段保守不显示结构字符；一旦分叉（{有点想法}、`code`、```jsx、{"answers" 等）立即整段放行。
// 两个分支：带围栏（`{1,3} + 半截 json + 半截 {answer 前缀）/ 不带围栏（半截 {answer 前缀）。
const PARTIAL_ENVELOPE_RE =
  /^`{1,3}(?:j(?:s(?:o(?:n)?)?)?)?\s*(?:\{\s*"?(?:a(?:n(?:s(?:w(?:e(?:r)?)?)?)?)?)?"?\s*:?\s*"?)?$|^\s*(?:\{\s*"?(?:a(?:n(?:s(?:w(?:e(?:r)?)?)?)?)?)?"?\s*:?\s*"?)?$/

// 尾部半截转义丢弃（在**未反转义**的 payload 上判定）：
// - 奇数反斜杠结尾：`\` 后转义字符未流出 → 丢这个反斜杠；
// - `\u` + 不足 4 位 hex 结尾（且该反斜杠自身未被转义）→ 整段 `\u…` 丢弃。
// 下一帧补齐后自然显示，避免瞬时把 `\u4f6` 这种原始残段渲进气泡。
function dropTrailingPartialEscape(s: string): string {
  const bsRun = s.match(/\\+$/)
  if (bsRun && bsRun[0].length % 2 === 1) s = s.slice(0, -1)
  const uTail = s.match(/(\\+)u[0-9a-fA-F]{0,3}$/)
  if (uTail && uTail[1].length % 2 === 1) {
    // 保留前面的偶数反斜杠（自身是 \\ 转义），只丢奇数位的最后一个反斜杠起的 \u 残段
    s = s.slice(0, s.length - uTail[0].length + (uTail[1].length - 1))
  }
  return s
}

// 可见部分即时反转义（JSON 字符串语义：\\n→换行、\\"→引号、\\uXXXX→字符、\\\\→反斜杠等）。
// 未知转义宽容取字面值（\\x→x）；只用于流式瞬时渲染，最终收口仍是 JSON.parse/parseAnswerJson。
function unescapeJsonPartial(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const n = s[i + 1]
    if (n === undefined) break // 理论上已被 dropTrailingPartialEscape 处理
    i++
    switch (n) {
      case 'n': out += '\n'; break
      case 'r': out += '\r'; break
      case 't': out += '\t'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case 'u': {
        const hex = s.slice(i + 1, i + 5)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCodePoint(parseInt(hex, 16))
          i += 4
        } else {
          out += 'u' // 半截 \u 已在上游丢弃；非法 hex 宽容保留 u
        }
        break
      }
      default:
        // m5: 与 parseAnswerJson 收口对齐——JSON 合法转义（" \ /）取字面值；
        // 未知转义保留反斜杠字面（\x→\x），finalize（JSON.parse 失败兜底路径也只剥 \n/\\）不漂移。
        out += n === '"' || n === '\\' || n === '/' ? n : '\\' + n
    }
  }
  return out
}

// 从不完整 JSON 封包（rawAccum = 已流出的 content 原始拼接）提取 answer 可见文本。
// 三种形态：信封前缀已到 → 取其后 payload；信封未到（```json/{"ans…）→ 空串；无信封散文 → 原样返回。
export function extractPartialAnswer(rawAccum: string): string {
  const m = rawAccum.match(ANSWER_PREFIX_RE)
  if (!m) {
    const head = rawAccum.trimStart()
    // m2: 前缀未明（还可能是信封的半截前缀）→ 保守不显示结构字符；
    // 判定非信封（散文以 {/反引号开头等）→ 立即整段放行，不再整轮空白。
    if (head === '' || PARTIAL_ENVELOPE_RE.test(head)) return ''
    return rawAccum
  }
  let payload = rawAccum.slice(m[0].length)
  // citedEntryIds 边界：answer 字符串闭合、下一字段开始流出 → 回扫空白/逗号/引号截断。
  // lastIndexOf：answer 正文提及 citedEntryIds 字样时锚定最后一次（边界在正文之后流出）。
  const idx = payload.lastIndexOf('citedEntryIds')
  if (idx >= 0) {
    let cut = idx
    while (cut > 0 && /[\s,"']/.test(payload[cut - 1])) cut--
    payload = payload.slice(0, cut)
  } else {
    // M1: answer 闭合、下一字段 key 逐 token 流出（`回答","`、`回答","c`、`回答","citedEnt`）→
    // 循环定位最后一个未转义 `"`（JSON 串内引号必转义，未转义即 answer 终止符），其后若只有
    // [\s,] + 可选 `"` + 可选 citedEntryIds 前缀字母 → 截到该引号前，重复至不可再截
    // （`回答","c` → 截 key 引号 → `回答",` → 截闭合引号 → `回答`）。
    // 不误剥正文：answer 未闭合（无未转义 `"`）或尾部字母不是 citedEntryIds 前缀时原样保留。
    for (;;) {
      let lastQuote = -1
      for (let i = payload.length - 1; i >= 0; i--) {
        if (payload[i] !== '"') continue
        let bs = 0
        for (let j = i - 1; j >= 0 && payload[j] === '\\'; j--) bs++
        if (bs % 2 === 0) {
          lastQuote = i
          break
        }
      }
      if (lastQuote < 0) break
      const rest = payload.slice(lastQuote + 1).match(/^[\s,]*"?([A-Za-z]*)$/)
      if (!rest || (rest[1] !== '' && !'citedEntryIds'.startsWith(rest[1]))) break
      payload = payload.slice(0, lastQuote)
    }
  }
  payload = dropTrailingPartialEscape(payload)
  return unescapeJsonPartial(payload)
}
