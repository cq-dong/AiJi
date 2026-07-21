import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { env } from '../env.js'
import { consumeQuota } from '../lib/quota.js'
import { errorJson } from '../lib/http.js'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// ffmpeg-static 是 CJS，NodeNext 下用 createRequire 取导出（路径字符串）。
const ffmpegPath: string | null = require('ffmpeg-static') as string | null

const stt = new Hono<AppEnv>()

const TARGET_RATE = 16000
const WS_BASE = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

// ffmpeg webm/opus → 16kHz mono PCM s16le（DashScope paraformer-realtime-v2 要求 pcm 16k）。
// 输出 raw PCM，字节数 / 2 = 采样数，/ 16000 = 秒，用于配额预扣。
function transcodeToPcm(input: Buffer): Promise<{ pcm: Buffer; durationSec: number }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg 未安装'))
    const out: Buffer[] = []
    const err: Buffer[] = []
    const p = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-ar', String(TARGET_RATE),
      '-ac', '1',
      '-f', 's16le',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    p.stdin.on('error', reject)
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffmpeg 转码失败 code=' + code + ' ' + Buffer.concat(err).toString().slice(-200)))
      const pcm = Buffer.concat(out)
      const samples = pcm.length / 2
      const durationSec = Math.max(1, Math.round(samples / TARGET_RATE))
      resolve({ pcm, durationSec })
    })
    p.stdin.end(input)
  })
}

// DashScope paraformer-realtime-v2 WS：连 → run-task → 分帧推 PCM → finish-task
// → 收 result-generated(sentence_end) 拼 → task-finished resolve。Node 22 自带 WebSocket global。
function streamAsr(pcm: Buffer, apiKey: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(`${WS_BASE}?api_key=${encodeURIComponent(apiKey)}`)
    } catch (e) {
      reject(new Error('STT WS 构造失败: ' + (e as Error).message))
      return
    }
    ws.binaryType = 'arraybuffer'
    const finals: string[] = []
    let lastInterim = ''
    const taskId = randomUUID()
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* noop */ }
      fn()
    }
    const timeoutMs = Math.min(120000, Math.max(30000, (pcm.length / 2 / TARGET_RATE) * 5000))
    const timer = setTimeout(() => settle(() => reject(new Error('STT 超时'))), timeoutMs)

    ws.onopen = () => {
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model,
          parameters: {
            format: 'pcm',
            sample_rate: TARGET_RATE,
            enable_punctuation_prediction: true,
            disfluency_removal_enabled: false,
            language_hints: ['zh', 'en'],
          },
          input: {},
        },
      }))
      // 200ms 帧（3200 samples = 6400 bytes）
      const chunkBytes = 6400
      for (let i = 0; i < pcm.length; i += chunkBytes) {
        ws.send(pcm.subarray(i, i + chunkBytes).buffer.slice(pcm.byteOffset + i, pcm.byteOffset + i + Math.min(chunkBytes, pcm.length - i)))
      }
      ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId }, payload: { input: {} } }))
    }
    ws.onmessage = (ev) => {
      const data = ev.data
      if (typeof data !== 'string') return
      let msg: { header?: { event?: string; error_message?: string }; payload?: { output?: { sentence?: { text?: string; sentence_end?: boolean } } } }
      try {
        msg = JSON.parse(data)
      } catch {
        return
      }
      const event = msg.header?.event
      if (event === 'result-generated') {
        const s = msg.payload?.output?.sentence
        if (!s) return
        if (typeof s.text === 'string') lastInterim = s.text
        if (s.sentence_end && typeof s.text === 'string') finals.push(s.text)
      } else if (event === 'task-failed') {
        settle(() => reject(new Error('STT task-failed: ' + (msg.header?.error_message ?? ''))))
      } else if (event === 'task-finished') {
        settle(() => resolve(finals.join('') || lastInterim))
      }
    }
    ws.onerror = () => settle(() => reject(new Error('STT WS error（key/网络/端点）')))
    ws.onclose = (ev: { code?: number }) => settle(() => reject(new Error('STT WS 提前关闭 code=' + (ev.code ?? 'unknown'))))
  })
}

// POST /api/stt/transcribe — FormData{file}。duration 由 ffmpeg 转 PCM 后按采样数估算。
// 预扣 quota(durationSec) → ffmpeg → WS 推流 → 返 {text}。复用前端 paraformerStreamStt 的 WS 协议。
stt.post('/transcribe', async (c) => {
  const userId = c.get('userId') as string
  const form = await c.req.formData().catch(() => null)
  if (!form) return errorJson(c, 400, 'AUTH_400', '需要 FormData')
  const file = form.get('file')
  if (!(file instanceof Blob)) return errorJson(c, 400, 'AUTH_400', 'file 缺失')

  const buf = Buffer.from(await file.arrayBuffer())
  let pcm: Buffer
  let durationSec: number
  try {
    const r = await transcodeToPcm(buf)
    pcm = r.pcm
    durationSec = r.durationSec
  } catch (e) {
    console.error('[stt] transcode fail:', e instanceof Error ? e.message : e)
    return errorJson(c, 502, 'AUTH_502', '音频转码失败')
  }

  if (!consumeQuota(userId, 'stt', durationSec)) {
    return errorJson(c, 429, 'AUTH_429', '今日 STT 额度已用完')
  }

  const rollback = () => consumeQuota(userId, 'stt', -durationSec)
  try {
    const model = env.dashscopeModel || 'paraformer-realtime-v2'
    const text = (await streamAsr(pcm, env.dashscopeKey, model)).trim()
    return c.json({ text })
  } catch (e) {
    console.error('[stt] upstream fail:', e instanceof Error ? e.message : e)
    rollback()
    return errorJson(c, 502, 'AUTH_502', 'STT 转写失败')
  }
})

export default stt
