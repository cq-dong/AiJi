// D20 · 前台到点提示音。WebAudio 合成三声短铃（无需音频资源文件）。
// Android WebView / iOS Safari 需要 user gesture 才能解锁 AudioContext——
// 本模块在首次 pointerdown/keydown 时 resume() context，之后到点即可播。
// 解锁失败或 API 不支持 → play 静默 no-op（系统通知 channel 仍有铃声兜底）。

let audioCtx: AudioContext | null = null
let unlocked = false

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!audioCtx) {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor()
    }
    return audioCtx
  } catch {
    return null
  }
}

// 首次用户交互时 resume 音频上下文。在 main.tsx → initReminderFire 注册一次。
export function unlockAudio(): void {
  if (unlocked) return
  const ctx = getCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  unlocked = true
}

// 到点播放：三声 880Hz 正弦短铃，0.18s 一声、间隔 0.12s。
// 失败静默（系统通知 channel 铃声仍兜底）。
export function playReminderBeep(): void {
  const ctx = getCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  try {
    const now = ctx.currentTime
    const starts = [0, 0.3, 0.6]
    for (const start of starts) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0, now + start)
      gain.gain.linearRampToValueAtTime(0.3, now + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + start + 0.2)
    }
  } catch (e) {
    console.warn('[reminderSound] play failed', e)
  }
}
