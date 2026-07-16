import Chinese from 'chinese-s2t'
import type { CapturePort } from '@/ports'
import type { GeoPoint } from '@/domain/types'

// PWA capture adapter (PRD §7.3 "WebSpeech+getUserMedia"): mic via getUserMedia,
// live STT preview via WebSpeech, recording via MediaRecorder. Whisper final-quality
// STT is SttPort (deferred — cloud/BYOK). stopAudio returns the recorded blob; the
// store persists it via StoragePort.saveMedia (OPFS, PRD §7.2). Seed audio parts have
// no blob → detail player shows static/disabled.

let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let recognition: SpeechRecognitionLike | null = null
let chunks: Blob[] = []
let startedAt = 0

// Camera + gallery state (Wave 2 capture redesign). The adapter owns the MediaStream
// so the port stays the only entry point for capture; the screen passes a <video>
// element for live preview. Photo/video both land as 'video' EntryParts (photos → durationSec=0).
let camStream: MediaStream | null = null
let camPreview: HTMLVideoElement | null = null
let camRecorder: MediaRecorder | null = null
let camChunks: Blob[] = []
let camStartedAt = 0
let camFacing: 'user' | 'environment' = 'environment'

// WebSpeech is vendor-prefixed and absent from standard TS DOM lib.
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void
  onerror: () => void
  start(): void
  stop(): void
}
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: (new () => SpeechRecognitionLike); webkitSpeechRecognition?: (new () => SpeechRecognitionLike) }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const webCapture: CapturePort = {
  async hasMicPermission() {
    try {
      const p = await navigator.permissions?.query({ name: 'microphone' } as unknown as PermissionDescriptor)
      return p?.state === 'granted'
    } catch {
      return false
    }
  },

  async requestMicPermission() {
    if (!navigator.mediaDevices?.getUserMedia) return false
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      return true
    } catch {
      return false
    }
  },

  async getLocation(): Promise<GeoPoint | null> {
    if (!('geolocation' in navigator)) return null
    return new Promise<GeoPoint | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null), // denied/timeout → 不阻断采集，条目无 location
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
      )
    })
  },

  async startAudio({ onInterim, onFinal }) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('mic-unavailable')
    // getUserMedia throws NotAllowedError (denied) / NotFoundError (no mic) / SecurityError (insecure context).
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    chunks = []
    if (typeof MediaRecorder !== 'undefined') {
      try {
        recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.start()
      } catch (e) {
        // L2: MediaRecorder 构造失败（Safari MIME 边界等）→ 释放已 getUserMedia 的 mic stream 免泄漏
        // （否则 throw 传播到 store catch 只设 recording:false，stopAudio 早返不发 track.stop → mic 灯长亮）。
        // 降级：WebSpeech live 预览仍可用（独立于 stream），stopAudio 返 blob=undefined（transcript-only）。
        console.error('[webCapture] MediaRecorder construction failed', e)
        stream?.getTracks().forEach((t) => t.stop())
        stream = null
        recorder = null
      }
    }
    startedAt = Date.now()

    const Ctor = getSpeechRecognitionCtor()
    if (Ctor) {
      recognition = new Ctor()
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      // WebSpeech 在部分系统上忽略 lang='zh-CN' 仍输出繁体（引擎回退系统语种），统一 t2s 转简体。
      recognition.onresult = (ev) => {
        let interim = ''
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i]
          if (r.isFinal) onFinal?.(Chinese.t2s(r[0].transcript))
          else interim += r[0].transcript
        }
        if (interim) onInterim?.(Chinese.t2s(interim))
      }
      recognition.onerror = () => { /* swallow; recording continues without live preview */ }
      try { recognition.start() } catch { /* already running or unsupported */ }
    }
  },

  async stopAudio() {
    const durationSec = Math.max(0.1, (Date.now() - startedAt) / 1000)
    try { recognition?.stop() } catch { /* noop */ }
    recognition = null
    let blob: Blob | undefined
    let mime = 'audio/webm'
    if (recorder && recorder.state !== 'inactive') {
      // D5: capture the MIME here (recorder.mimeType is live) so the store can persist
      // it on the AudioPart — OPFS round-trip would otherwise lose it (extension-less ref).
      mime = recorder.mimeType || 'audio/webm'
      blob = await new Promise<Blob | undefined>((resolve) => {
        recorder!.onstop = () => {
          resolve(chunks.length > 0 ? new Blob(chunks, { type: mime }) : undefined)
        }
        recorder!.stop()
      })
    }
    stream?.getTracks().forEach((t) => t.stop())
    const ref = `audio-${crypto.randomUUID()}`
    recorder = null
    stream = null
    chunks = []
    return { ref, durationSec, blob, mime }
  },

  async startCamera({ preview, facingMode = 'environment', withAudio = true }) {
    // Release any prior camera session before opening a new one (e.g. switching facing mode).
    await webCapture.stopCamera()
    if (!navigator.mediaDevices?.getUserMedia) return false
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 } },
        audio: withAudio,
      })
    } catch {
      camStream = null
      return false
    }
    camFacing = facingMode
    camPreview = preview ?? null
    if (camPreview) {
      // Live preview: attach stream and play. muted so iOS autoplay policy doesn't block.
      camPreview.srcObject = camStream
      camPreview.muted = true
      try { await camPreview.play() } catch { /* play() can reject if not user-gesture-synced; frames still render once playing */ }
    }
    return true
  },

  async capturePhoto() {
    if (!camStream || !camPreview) return null
    const vw = camPreview.videoWidth || 720
    const vh = camPreview.videoHeight || 1280
    const canvas = document.createElement('canvas')
    canvas.width = vw
    canvas.height = vh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // Mirror selfie when front-facing so the saved photo matches what the user saw.
    if (camFacing === 'user') { ctx.translate(vw, 0); ctx.scale(-1, 1) }
    ctx.drawImage(camPreview, 0, 0, vw, vh)
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
    )
    if (!blob) return null
    return { ref: `photo-${crypto.randomUUID()}`, blob, mime: blob.type }
  },

  async startVideo() {
    if (!camStream) throw new Error('camera-not-running')
    camChunks = []
    if (typeof MediaRecorder === 'undefined') throw new Error('recorder-unsupported')
    // Pick a mimeType the browser will actually record; fall back to default.
    // mp4-first matches the proven video-probe.html harness — iOS Safari only records mp4,
    // desktop Chrome (>=111) supports both, older Chrome falls through to webm.
    const candidates = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''
    camRecorder = new MediaRecorder(camStream, mimeType ? { mimeType } : undefined)
    camRecorder.ondataavailable = (e) => { if (e.data.size > 0) camChunks.push(e.data) }
    camRecorder.start()
    camStartedAt = Date.now()
  },

  async stopVideo() {
    if (!camRecorder || camRecorder.state === 'inactive') return null
    const durationSec = Math.max(0.1, (Date.now() - camStartedAt) / 1000)
    const mime = camRecorder.mimeType || 'video/webm'
    const blob: Blob | undefined = await new Promise<Blob | undefined>((resolve) => {
      camRecorder!.onstop = () => {
        resolve(camChunks.length > 0 ? new Blob(camChunks, { type: mime }) : undefined)
      }
      camRecorder!.stop()
    })
    camRecorder = null
    camChunks = []
    if (!blob) return null
    return { ref: `video-${crypto.randomUUID()}`, blob, durationSec, mime }
  },

  async stopCamera() {
    try { if (camRecorder && camRecorder.state !== 'inactive') camRecorder.stop() } catch { /* noop */ }
    camRecorder = null
    camChunks = []
    camStream?.getTracks().forEach((t) => t.stop())
    if (camPreview) { try { camPreview.srcObject = null } catch { /* noop */ } }
    camStream = null
    camPreview = null
  },

  async pickMedia() {
    // Hidden file input, single use. Resolves on selection, null on cancel.
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    let onFocus: (() => void) | null = null
    const picked = new Promise<globalThis.File | null>((resolve) => {
      let settled = false
      let hardTimer: ReturnType<typeof setTimeout> | undefined
      const done = (v: globalThis.File | null) => {
        if (settled) return
        settled = true
        if (hardTimer) clearTimeout(hardTimer)
        resolve(v)
      }
      input.onchange = () => done(input.files?.[0] ?? null)
      // L3: 移动端文件选择器取消不触发 onchange 也不稳定触发 window.focus → picked 永挂、
      // handleGallery 卡死、input 泄漏 DOM。focus 兜底（桌面取消回焦点）+ 30s 硬超时 backstop（移动取消常无 focus 信号）。
      onFocus = () => { window.setTimeout(() => { if (!input.files?.length) done(null) }, 300) }
      window.addEventListener('focus', onFocus)
      hardTimer = setTimeout(() => done(null), 30_000)
    })
    input.click()
    const file = await picked
    // L3: resolve 后立刻摘 onFocus listener（原 onchange 成功路径不摘，依赖后续 focus 触发清理 → 移动端可能永挂）。
    if (onFocus) window.removeEventListener('focus', onFocus)
    if (input.parentNode) document.body.removeChild(input)
    if (!file) return null
    const kind: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image'
    let durationSec = 0
    if (kind === 'video') {
      // Probe duration via a detached video element loaded from the blob.
      durationSec = await new Promise<number>((resolve) => {
        const url = URL.createObjectURL(file)
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.src = url
        v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.max(0.1, v.duration || 0)) }
        v.onerror = () => { URL.revokeObjectURL(url); resolve(0) }
      })
    }
    return { ref: `${kind === 'image' ? 'photo' : 'video'}-${crypto.randomUUID()}`, blob: file, kind, durationSec, mime: file.type }
  },
}
