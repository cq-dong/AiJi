import type { SttPort } from '@/ports'
import { di } from '@/app/di'
import { BUILTIN_STT_URL_WHISPER, BUILTIN_STT_MODEL_WHISPER } from '@/adapters/builtinDefaults'

// SttPort PWA 适配：OpenAI 兼容 REST /audio/transcriptions（BYOK，非流式）。
// 适用任意 OpenAI Whisper 兼容 endpoint：OpenAI / Groq / Aliyun PI 的
// /compatible-mode/v1/audio/transcriptions（浏览器 CORS 已验通）/ 本地 whisper.cpp。
// url=settings.sttUrl（REST base，如 https://…/v1），model=settings.sttModel，
// key=SecretStorePort('stt:key')。非流式：传 ref → 拉 blob → multipart POST → 纯文本。
// capture 实时预览仍走 WebSpeech；本适配只负责保存后离线转写。key/url 缺失 → throw，
// 管线 catch 后条目标 failed（AI-only 降级，采集存储不伤）。
// D30: sttUrl/sttModel 回落 BUILTIN_STT_URL_WHISPER/MODEL（env 烘入）。用户自配值优先。

const SECRET_KEY = 'stt:key'

export const whisperRestStt: SttPort = {
  async transcribe(ref) {
    const settings = await di.storage.getSettings()
    const base = (settings.sttUrl || BUILTIN_STT_URL_WHISPER || '').replace(/\/$/, '')
    const model = settings.sttModel || BUILTIN_STT_MODEL_WHISPER || 'whisper-1'
    const apiKey = await di.secrets.get(SECRET_KEY)
    if (!apiKey || !base) throw new Error('Whisper STT 未配置（sttUrl/stt:key 缺失）')
    const blob = await di.storage.getMedia(ref)
    if (!blob) throw new Error('音频 blob 未找到: ' + ref)
    const form = new FormData()
    form.append('file', blob, 'audio.webm')
    form.append('model', model)
    form.append('response_format', 'text')
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`Whisper STT HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    return (await res.text()).trim()
  },
}
