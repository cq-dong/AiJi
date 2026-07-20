import { Hono } from 'hono'
import type { AppEnv } from '../lib/http.js'
import { spawn } from 'node:child_process'
import { env } from '../env.js'
import { consumeQuota } from '../lib/quota.js'
import { errorJson } from '../lib/http.js'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// ffmpeg-static 是 CJS，NodeNext 下用 createRequire 取导出（路径字符串）。
const ffmpegPath: string | null = require('ffmpeg-static') as string | null

const stt = new Hono<AppEnv>()

// ffmpeg webm/opus → wav 16kHz mono PCM。DashScope 文件转写要求 wav/mp3/aac 等。
// 同时拿到 wav 字节数 → 估算 duration（16kHz mono PCM16 = 32000 bytes/s）用于配额预扣。
function transcodeToWav(input: Buffer): Promise<{ wav: Buffer; durationSec: number }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg 未安装'))
    const out: Buffer[] = []
    const err: Buffer[] = []
    const p = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    p.stdin.on('error', reject)
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffmpeg 转码失败 code=' + code + ' ' + Buffer.concat(err).toString().slice(-200)))
      const wav = Buffer.concat(out)
      // PCM16 16kHz mono = 32000 bytes/s（不含 wav header，估算偏差<5%可接受）。
      const durationSec = Math.max(1, Math.round(wav.length / 32000))
      resolve({ wav, durationSec })
    })
    p.stdin.end(input)
  })
}

// 上传文件到 DashScope 文件存储 → 返回 file_url。
async function uploadFile(wav: Buffer): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([wav]), 'audio.wav')
  form.append('model', 'paraformer-v2')
  form.append('action', 'upload')
  const res = await fetch(`${env.dashscopeBase}/api/v1/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.dashscopeKey}`,
      'X-DashScope-Content-Format': 'multipart/form-data',
    },
    body: form,
  })
  if (!res.ok) throw new Error('uploads HTTP ' + res.status)
  const data = await res.json() as { data?: { url?: string }; message?: string }
  const url = data?.data?.url
  if (!url) throw new Error('uploads 无 url: ' + (data?.message ?? ''))
  return url
}

// 提交文件转写任务 → task_id。
async function submitTranscription(fileUrl: string): Promise<string> {
  const res = await fetch(`${env.dashscopeBase}/api/v1/services/audio/asr/transcription`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.dashscopeKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'paraformer-v2',
      input: { file_urls: [fileUrl] },
      parameters: { language_hints: ['zh', 'en'] },
    }),
  })
  if (!res.ok) throw new Error('transcription HTTP ' + res.status)
  const data = await res.json() as { output?: { task_id?: string }; message?: string }
  const taskId = data?.output?.task_id
  if (!taskId) throw new Error('transcription 无 task_id: ' + (data?.message ?? ''))
  return taskId
}

// 轮询任务 → 成功返 transcription_url。
async function pollTask(taskId: string, timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${env.dashscopeBase}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${env.dashscopeKey}` },
    })
    if (!res.ok) throw new Error('poll HTTP ' + res.status)
    const data = await res.json() as { output?: { task_status?: string; transcription_url?: string } }
    const status = data?.output?.task_status
    if (status === 'SUCCEEDED') {
      const url = data?.output?.transcription_url
      if (!url) throw new Error('SUCCEEDED 但无 transcription_url')
      return url
    }
    if (status === 'FAILED') throw new Error('转写任务失败')
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('转写超时')
}

// fetch 结果 JSON → 拼 text。
async function fetchTranscription(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('result HTTP ' + res.status)
  const data = await res.json() as { transcripts?: { text?: string }[]; output?: { text?: string } }
  const texts = (data?.transcripts ?? []).map((t) => t.text ?? '').filter(Boolean)
  if (texts.length > 0) return texts.join('')
  return data?.output?.text ?? ''
}

// POST /api/stt/transcribe — FormData{file}。duration 由 ffmpeg 转 wav 后按字节估算，
// 前端 transcribe(ref) 签名不传 duration（无 entry 上下文）。
// 预扣 quota(durationSec) → ffmpeg 转 wav → 上传 → 提交 → 轮询 → 返 {text}。
stt.post('/transcribe', async (c) => {
  const userId = c.get('userId') as string
  const form = await c.req.formData().catch(() => null)
  if (!form) return errorJson(c, 400, 'AUTH_400', '需要 FormData')
  const file = form.get('file')
  if (!(file instanceof Blob)) return errorJson(c, 400, 'AUTH_400', 'file 缺失')

  const buf = Buffer.from(await file.arrayBuffer())
  let wav: Buffer
  let durationSec: number
  try {
    const r = await transcodeToWav(buf)
    wav = r.wav
    durationSec = r.durationSec
  } catch {
    return errorJson(c, 502, 'AUTH_502', '音频转码失败')
  }

  if (!consumeQuota(userId, 'stt', durationSec)) {
    return errorJson(c, 429, 'AUTH_429', '今日 STT 额度已用完')
  }

  const rollback = () => consumeQuota(userId, 'stt', -durationSec)
  try {
    const fileUrl = await uploadFile(wav)
    const taskId = await submitTranscription(fileUrl)
    const resultUrl = await pollTask(taskId)
    const text = (await fetchTranscription(resultUrl)).trim()
    return c.json({ text })
  } catch {
    rollback()
    return errorJson(c, 502, 'AUTH_502', 'STT 转写失败')
  }
})

export default stt
