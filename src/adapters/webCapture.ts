import type { CapturePort } from '@/ports'

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

  async startAudio({ onInterim, onFinal }) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('mic-unavailable')
    // getUserMedia throws NotAllowedError (denied) / NotFoundError (no mic) / SecurityError (insecure context).
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    chunks = []
    if (typeof MediaRecorder !== 'undefined') {
      recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.start()
    }
    startedAt = Date.now()

    const Ctor = getSpeechRecognitionCtor()
    if (Ctor) {
      recognition = new Ctor()
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onresult = (ev) => {
        let interim = ''
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i]
          if (r.isFinal) onFinal?.(r[0].transcript)
          else interim += r[0].transcript
        }
        if (interim) onInterim?.(interim)
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
    if (recorder && recorder.state !== 'inactive') {
      blob = await new Promise<Blob | undefined>((resolve) => {
        recorder!.onstop = () => {
          const type = recorder!.mimeType || 'audio/webm'
          resolve(chunks.length > 0 ? new Blob(chunks, { type }) : undefined)
        }
        recorder!.stop()
      })
    }
    stream?.getTracks().forEach((t) => t.stop())
    const ref = `audio-${crypto.randomUUID()}`
    recorder = null
    stream = null
    chunks = []
    return { ref, durationSec, blob }
  },
}
