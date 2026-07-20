import type { SttPort } from '@/ports'
import { di } from '@/app/di'
import { BUILTIN_STT_URL_STREAM, BUILTIN_STT_MODEL_STREAM } from '@/adapters/builtinDefaults'

// SttPort PWA 适配：阿里云 DashScope paraformer-realtime-v2 实时流式 WS（BYOK）。
// key 从 SecretStorePort('stt:key') 取，model 从 Settings.sttModel 取——永不入源码。
// 浏览器直连已验通：WS 无 CORS 预检，鉴权走 `?api_key=` query（浏览器 WebSocket 设不了
// 自定义头，DashScope 唯一接受的 query 参数名是 api_key）。离线文件复用同一条 WS：把
// OPFS blob 解码成 PCM 16k 单声道 16-bit 推过去即可，不需要文件转写 REST API（那条
// 需要公网 URL 且被 CORS 预检挡）。key 缺失 → throw，管线 catch 后条目标 failed
// （AI-only 降级，采集存储不伤）。WebSpeech live interim 不动，本适配只负责保存后转写。
// D30: sttUrl/sttModel 回落 BUILTIN_STT_URL_STREAM/MODEL（env 烘入），再回落硬编码公共端点。
// 用户自配值优先。

const SECRET_KEY = 'stt:key'
const DEFAULT_WS_BASE = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
const TARGET_RATE = 16000

function getAudioContextCtor(): typeof AudioContext {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) throw new Error('AudioContext 不支持（无法解码音频）')
  return Ctor
}

// blob（webm/opus 等）→ 16kHz 单声道 16-bit PCM。decodeAudioData 解码源格式，
// OfflineAudioContext 重采样到 16k 单声道，Float32→Int16。
async function blobToPcm16k(blob: Blob): Promise<Int16Array> {
  const arrBuf = await blob.arrayBuffer()
  const ACtor = getAudioContextCtor()
  const decodeCtx = new ACtor()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(arrBuf.slice(0))
  } finally {
    void decodeCtx.close()
  }
  const length = Math.ceil((decoded.length * TARGET_RATE) / decoded.sampleRate)
  const OCtor = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!OCtor) throw new Error('OfflineAudioContext 不支持（无法重采样）')
  const off = new OCtor(1, length, TARGET_RATE)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  // 必须 start(0)：AudioBufferSourceNode 不 start 不发声，startRendering 会渲染全静音 PCM → DashScope 收全零 → 空转写。
  src.start(0)
  const rendered = await off.startRendering()
  const float = rendered.getChannelData(0)
  const int16 = new Int16Array(float.length)
  for (let i = 0; i < float.length; i++) {
    const s = Math.max(-1, Math.min(1, float[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

// 推 PCM 帧，收增量 result-generated，拼 sentence_end 句返回。
function streamAsr(pcm: Int16Array, apiKey: string, model: string, wsBase: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(`${wsBase}?api_key=${encodeURIComponent(apiKey)}`)
    } catch (e) {
      reject(new Error('STT WS 构造失败: ' + (e as Error).message))
      return
    }
    ws.binaryType = 'arraybuffer'
    const finals: string[] = []
    let lastInterim = ''
    let taskId = ''
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // 所有 settle 路径（含成功 task-finished）都关 ws——原成功路径不 close 依赖服务端关，socket 可能 linger。
      try { ws.close() } catch { /* noop */ }
      fn()
    }
    const timeoutMs = Math.min(120000, Math.max(30000, (pcm.length / TARGET_RATE) * 5000))
    const timer = setTimeout(() => {
      settle(() => reject(new Error('STT 超时')))
    }, timeoutMs)

    ws.onopen = () => {
      taskId = crypto.randomUUID()
      ws.send(
        JSON.stringify({
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
        }),
      )
      // 200ms 帧推完音频，再 finish-task（服务端处理完后吐最终句 + task-finished）。
      // 拷进新 ArrayBuffer：pcm.buffer 是 ArrayBufferLike（含 SharedArrayBuffer），
      // WebSocket.send 的 BufferSource 要 ArrayBuffer<ArrayBuffer>，直发 subarray 类型不过。
      const chunkElems = 3200
      for (let i = 0; i < pcm.length; i += chunkElems) {
        const chunk = pcm.subarray(i, i + chunkElems)
        const buf = new ArrayBuffer(chunk.byteLength)
        new Int16Array(buf).set(chunk)
        ws.send(buf)
      }
      ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId }, payload: { input: {} } }))
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: { header?: { event?: string; error_message?: string }; payload?: { output?: { sentence?: { text?: string; sentence_end?: boolean } } } }
      try {
        msg = JSON.parse(ev.data)
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
    ws.onerror = () => {
      settle(() => reject(new Error('STT WS error（key/网络/端点）')))
    }
    ws.onclose = (ev) => {
      settle(() => reject(new Error('STT WS 提前关闭 code=' + ev.code)))
    }
  })
}

export const paraformerStreamStt: SttPort = {
  async transcribe(ref) {
    const settings = await di.storage.getSettings()
    const model = settings.sttModel || BUILTIN_STT_MODEL_STREAM || 'paraformer-realtime-v2'
    const wsBase = settings.sttUrl || BUILTIN_STT_URL_STREAM || DEFAULT_WS_BASE
    const apiKey = await di.secrets.get(SECRET_KEY)
    if (!apiKey) throw new Error('STT BYOK 未配置（stt:key 缺失）')
    const blob = await di.storage.getMedia(ref)
    if (!blob) throw new Error('音频 blob 未找到: ' + ref)
    const pcm = await blobToPcm16k(blob)
    if (pcm.length === 0) throw new Error('音频解码为空: ' + ref)
    const text = await streamAsr(pcm, apiKey, model, wsBase)
    return text.trim()
  },
}
