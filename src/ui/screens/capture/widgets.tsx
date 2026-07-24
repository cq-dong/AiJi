import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { motion } from 'framer-motion'
import {
  Bookmark,
  Camera,
  GalleryThumbnails,
  Image as ImageIcon,
  Info,
  MapPin,
  Mic,
  Trash2,
  Type,
  Video,
  X,
} from 'lucide-react'
import { cn, Spinner } from '@/ui/components'
import { di } from '@/app/di'
import { getMicAnalyser } from '@/adapters/webCapture'
import { haptic } from '@/ui/lib/haptics'
import { useT } from '@/app/i18n/useT'
import type { EntryPart, GeoPoint } from '@/domain/types'

const KEYFRAMES =
  '@keyframes aji-wave { 0%,100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } } ' +
  '@keyframes aji-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }'

/** Local keyframes for the recording waveform + pulsing dot. Render once at the root. */
export function CaptureKeyframes() {
  return <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
}

export function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.max(0, Math.floor(sec) % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return mm + ':' + ss
}

// ── Mini waveform: compact pri square with 5 white bars — used in audio part chips ──
const MINI_HEIGHTS = [10, 15, 20, 25, 30]
export function MiniWaveform() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center gap-[2px] rounded-[6px] bg-pri">
      {MINI_HEIGHTS.map((h, i) => (
        <span key={i} className="w-[3px] rounded-[2px] bg-card" style={{ height: h }} />
      ))}
    </span>
  )
}

// ── Live waveform: 7 pri bars, animated — shown while voice-recording ──
const LIVE_HEIGHTS = [18, 40, 26, 54, 30, 46, 20]
// 与 RealtimeWave 同律（7 大条版）；当前无调用方，保留给全屏录音态复用。
export function LiveWaveform() {
  return <RealtimeWave bars={7} barWidth={5} gap={15} maxHeight={54} />
}

// ── Header: close + editable title + part-count + location chip ──
// Wave 3 #3: title is click-to-edit. Empty on blur → display "新条目" but
// keep title undefined in store (don't persist empty string as a title).
export function CaptureHeader({
  partCount,
  location,
  title,
  onTitleChange,
  onClose,
}: {
  partCount: number
  location?: GeoPoint
  title?: string
  onTitleChange: (v: string | undefined) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const t = useT()

  const startEdit = () => {
    setDraft(title ?? '')
    setEditing(true)
  }
  const commit = () => {
    const v = draft.trim()
    onTitleChange(v.length > 0 ? v : undefined)
    setEditing(false)
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 px-4">
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        className="flex size-11 items-center justify-center rounded-full text-ink cursor-pointer transition duration-base ease-out active:scale-[0.97] active:bg-page focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
      >
        <X size={20} strokeWidth={2.2} />
      </button>
      {editing ? (
        <input
          name="captureTitle"
          aria-label={t('capture.aria.entryTitle')}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() } }
          placeholder={t('capture.newEntry')}
          maxLength={60}
          className="min-w-0 flex-1 border-b border-pri bg-transparent text-[17px] font-bold text-ink outline-none placeholder:text-t3"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="min-w-0 truncate rounded-chip text-[17px] font-bold text-ink cursor-pointer transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
        >
          {title || t('capture.newEntry')}
        </button>
      )}
      {partCount > 0 && (
        <span className="flex h-6 shrink-0 items-center rounded-chip bg-priS px-2 text-[11px] font-medium text-pri">
          {t('capture.partsCount', { count: partCount })}
        </span>
      )}
      {location && (
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] font-medium text-t2">
          <MapPin size={13} strokeWidth={2.2} className="text-pri" />
          <span className="max-w-[120px] truncate">{location.address ?? location.label ?? `${location.lat.toFixed(3)}, ${location.lng.toFixed(3)}`}</span>
        </span>
      )}
    </div>
  )
}

// ── Draft hint banner: shown when parts restored from persisted draft ──
export function DraftHintBanner({ onDismiss }: { onDismiss: () => void }) {
  const t = useT()
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-chip bg-priS px-3 py-2">
      <Info size={14} strokeWidth={2.2} className="shrink-0 text-pri" />
      <span className="flex-1 text-[12px] font-medium text-pri">{t('capture.draftHint')}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('capture.aria.dismissHint')}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-pri cursor-pointer transition duration-base ease-out active:scale-[0.97] active:bg-pri/10 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
      >
        <X size={13} strokeWidth={2.4} />
      </button>
    </div>
  )
}

// ── Toast: brief auto-dismiss message ──
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 1600)
    return () => window.clearTimeout(id)
  }, [onDone])
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-40 flex justify-center">
      <span className="rounded-btn bg-black/80 px-4 py-2 text-[13px] font-medium text-white shadow-lg">
        {message}
      </span>
    </div>
  )
}

// ── Remove button for parts ──
function RemoveButton({ onRemove }: { onRemove: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={t('capture.aria.removePart')}
      className="flex size-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm cursor-pointer transition duration-base ease-out active:scale-90 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
    >
      <X size={13} strokeWidth={2.4} />
    </button>
  )
}

// ── Auto-growing borderless textarea: the writing surface itself.
// Height tracks content (1 row → max ~220px then inner scroll). No border,
// no card — the page is the editor (flomo/Notes-style freedom). ──
function AutoGrowTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  ariaLabel,
  minHeight,
  autoFocus,
  textareaRef,
}: {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  ariaLabel: string
  minHeight?: number
  autoFocus?: boolean
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const ref = textareaRef ?? innerRef
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.max(minHeight ?? 0, Math.min(el.scrollHeight, 220)) + 'px'
  }, [value, minHeight, ref])
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus, ref])
  return (
    <textarea
      ref={ref}
      name="captureText"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={1}
      className="w-full resize-none bg-transparent text-[15px] leading-[1.8] text-ink caret-pri outline-none placeholder:text-t3/80"
      style={{ minHeight }}
    />
  )
}

// ── Composer: always-on writing surface pinned to the END of the parts flow
// (chronological — media/text parts above, you keep writing below). Text stays
// local to the screen; the parent commits it into the parts flow when media is
// added, recording starts, or the entry is saved/closed — so ordering stays
// chronological and nothing typed is ever lost. ──
export function Composer({
  value,
  onChange,
  empty,
  textareaRef,
}: {
  value: string
  onChange: (v: string) => void
  /** true when the flow has no parts yet — placeholder becomes the invitation. */
  empty: boolean
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const t = useT()
  return (
    <AutoGrowTextarea
      value={value}
      onChange={onChange}
      textareaRef={textareaRef}
      ariaLabel={t('capture.aria.entryContent')}
      placeholder={empty ? t('capture.emptyTitle') : t('capture.textPlaceholder')}
      minHeight={empty ? 96 : undefined}
    />
  )
}

// ── Text flow part: click the text to edit in place — borderless auto-grow
// surface (same writing feel as the Composer), quiet 完成/取消 text buttons.
// Delete button stays. ──
function TextFlowPart({
  content,
  onRemove,
  onEdit,
}: {
  content: string
  onRemove: () => void
  onEdit: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const t = useT()
  if (editing) {
    const commit = () => {
      const v = draft.trim()
      if (v) onEdit(v)
      setEditing(false)
    }
    return (
      // -mx/-my 抵消内边距：编辑态浮出白卡但文字与阅读态逐像素对齐，不跳位。
      <div className="-mx-2.5 -my-2 rounded-chip bg-card px-2.5 py-2 shadow-card ring-1 ring-pri/25">
        <AutoGrowTextarea
          value={draft}
          onChange={setDraft}
          ariaLabel={t('capture.aria.entryContent')}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
          }}
        />
        <div className="mt-1 flex justify-end gap-1">
          <button
            type="button"
            onClick={() => {
              setDraft(content)
              setEditing(false)
            }}
            className="flex min-h-9 items-center rounded-chip px-2.5 text-[12px] font-medium text-t3 cursor-pointer transition duration-base ease-out active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 outline-none"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!draft.trim()}
            className="flex min-h-9 items-center rounded-chip px-2.5 text-[12px] font-semibold text-pri cursor-pointer transition duration-base ease-out active:scale-95 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pri/40 outline-none"
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="relative py-1 pr-7">
      <button
        type="button"
        onClick={() => { setDraft(content); setEditing(true) }}
        aria-label={t('capture.aria.editText')}
        className="block w-full cursor-text rounded-chip text-left transition duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
      >
        <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.8] text-ink">{content}</p>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('capture.aria.removeText')}
        className="absolute right-0 top-1 flex size-11 items-center justify-center rounded-full text-t3 cursor-pointer transition duration-base ease-out active:scale-[0.97] active:bg-page focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
      >
        <X size={14} strokeWidth={2.2} />
      </button>
    </div>
  )
}

// ── Flowing part block. Text is borderless (natural inline); audio is a compact
// bar; photo/video render the actual media. Photos are video parts with durationSec=0. ──
export function FlowPart({
  part,
  mediaUrl,
  onRemove,
  onEdit,
}: {
  part: EntryPart
  mediaUrl?: string
  onRemove: () => void
  onEdit?: (next: string) => void
}) {
  const t = useT()
  if (part.type === 'text') {
    return <TextFlowPart content={part.content} onRemove={onRemove} onEdit={onEdit ?? (() => {})} />
  }
  if (part.type === 'audio') {
    return (
      <div className="relative flex h-12 items-center gap-2 rounded-btn bg-priS pl-2 pr-9">
        <MiniWaveform />
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium text-pri">{t('capture.voicePart', { duration: fmtDur(part.durationSec) })}</span>
          {part.transcript && (
            <span className="line-clamp-1 text-[11px] leading-tight text-t2">{part.transcript}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('capture.aria.removeVoice')}
          className="absolute right-1.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-t3 cursor-pointer transition duration-base ease-out active:scale-[0.97] active:bg-card focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>
    )
  }
  // video part: durationSec===0 → photo (img); >0 → video (first frame).
  const isPhoto = part.durationSec === 0
  return (
    <div className="relative overflow-hidden rounded-card bg-black/5">
      {isPhoto ? (
        mediaUrl ? (
          <img src={mediaUrl} alt={t('capture.photo')} className="block max-h-[420px] w-full object-contain" />
        ) : (
          <div className="flex aspect-square items-center justify-center bg-page text-t3">
            <ImageIcon size={28} strokeWidth={1.6} />
          </div>
        )
      ) : mediaUrl ? (
        <>
          <video
            src={mediaUrl}
            muted
            playsInline
            preload="metadata"
            className="block max-h-[420px] w-full object-contain"
          />
          <span className="absolute bottom-2 left-2 rounded-[6px] bg-black/55 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {fmtDur(part.durationSec)}
          </span>
        </>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-page text-t3">
          <Video size={28} strokeWidth={1.6} />
        </div>
      )}
      <div className="absolute right-2 top-2">
        <RemoveButton onRemove={onRemove} />
      </div>
    </div>
  )
}

// ── Capture toolbar: text / voice / camera / gallery ──
// Wave 3 #1: merged 拍照+录视频 into single 相机 entry (mode toggle moved
// inside CameraView).
function ToolButton({
  icon,
  label,
  onClick,
  primary,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-1 flex-col items-center gap-1.5 py-1 cursor-pointer transition-all duration-base ease-out active:scale-90 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none',
      )}
    >
      <span
        className={cn(
          'flex size-12 items-center justify-center rounded-card border transition-shadow duration-base',
          primary
            ? 'border-transparent bg-gradient-to-b from-pri to-pri/85 text-white shadow-glowPriSm'
            : 'border-brd/80 bg-card text-ink shadow-sm hover:border-t3/40',
        )}
      >
        {icon}
      </span>
      <span className="text-[10px] font-medium text-t2">{label}</span>
    </button>
  )
}

export function CaptureToolbar({
  onText,
  onVoice,
  onCamera,
  onGallery,
  disabled,
}: {
  onText: () => void
  onVoice: () => void
  onCamera: () => void
  onGallery: () => void
  disabled?: boolean
}) {
  const t = useT()
  return (
    <div className="flex items-stretch gap-1">
      <ToolButton icon={<Type size={22} strokeWidth={2} />} label={t('capture.tool.text')} onClick={onText} disabled={disabled} />
      <ToolButton icon={<Mic size={22} strokeWidth={2} />} label={t('capture.tool.voice')} onClick={onVoice} primary disabled={disabled} />
      <ToolButton icon={<Camera size={22} strokeWidth={2} />} label={t('capture.tool.camera')} onClick={onCamera} disabled={disabled} />
      <ToolButton icon={<GalleryThumbnails size={22} strokeWidth={2} />} label={t('capture.tool.gallery')} onClick={onGallery} disabled={disabled} />
    </div>
  )
}

// ── Sticky save bar: 清空 / 存草稿 / 保存 ──
// Wave 3 #4: three-button row. 清空 confirms before clearing; 存草稿
// persists to Dexie + shows a toast; 保存 is the existing beginSave flow.
export function SaveBar({
  saving,
  disabled,
  onClear,
  onSaveDraft,
  onSave,
}: {
  saving: boolean
  disabled: boolean
  onClear: () => void
  onSaveDraft: () => void
  onSave: () => void
}) {
  const t = useT()
  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={onClear}
        disabled={disabled || saving}
        className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-btn border border-brd/80 bg-card text-[13px] font-medium text-t2 shadow-sm cursor-pointer transition-all duration-base ease-out hover:border-t3/40 active:scale-[0.97] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
      >
        <Trash2 size={16} strokeWidth={2} />
        {t('capture.clear')}
      </button>
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={disabled || saving}
        className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-btn border border-brd/80 bg-card text-[13px] font-medium text-t2 shadow-sm cursor-pointer transition-all duration-base ease-out hover:border-t3/40 active:scale-[0.97] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
      >
        <Bookmark size={16} strokeWidth={2} />
        {t('capture.saveDraft')}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || saving}
        className={cn(
          'flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-btn text-[15px] font-medium cursor-pointer transition-all duration-base ease-out active:scale-[0.98] disabled:opacity-40 disabled:shadow-none focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none',
          saving
            ? 'border border-pri/20 bg-priS text-pri'
            : 'bg-gradient-to-b from-pri to-pri/85 text-white shadow-glowPriSm hover:brightness-[1.06] active:brightness-95',
        )}
      >
        {saving ? (
          <>
            <Spinner size={16} /> {t('capture.saving')}
          </>
        ) : (
          t('common.save')
        )}
      </button>
    </div>
  )
}

// ── Realtime waveform: canvas bars driven by AnalyserNode 频谱（真实采样）。
// analyser 不可得（Capacitor 适配器 / AudioContext 失败）→ 回退 CSS 假条。
// 语音能量集中在低频段，取 bin 1..~60 均分 N 桶；lerp 平滑避免视觉跳动。
function RealtimeWave({ bars, barWidth, gap, maxHeight }: { bars: number; barWidth: number; gap: number; maxHeight: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(() => getMicAnalyser())

  // startAudio 异步——VoiceBar 挂载时 analyser 可能尚未就绪，轮询几次再放弃。
  useEffect(() => {
    if (analyser) return
    let tries = 0
    const timer = setInterval(() => {
      const a = getMicAnalyser()
      if (a || ++tries >= 10) {
        clearInterval(timer)
        if (a) setAnalyser(a)
      }
    }, 150)
    return () => clearInterval(timer)
  }, [analyser])

  useEffect(() => {
    if (!analyser) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const width = bars * barWidth + (bars - 1) * gap
    canvas.width = width * dpr
    canvas.height = maxHeight * dpr
    ctx.scale(dpr, dpr)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const levels = new Array<number>(bars).fill(0)
    let raf = 0
    const draw = () => {
      analyser.getByteFrequencyData(data)
      ctx.clearRect(0, 0, width, maxHeight)
      ctx.fillStyle = '#4f46e5'
      for (let i = 0; i < bars; i++) {
        // 桶映射：跳过 DC bin，语音能量区（约 bin 1-60）均分。
        const from = 1 + Math.floor((i * 59) / bars)
        const to = 1 + Math.floor(((i + 1) * 59) / bars)
        let sum = 0
        for (let b = from; b <= to && b < data.length; b++) sum += data[b]
        const avg = sum / Math.max(1, to - from + 1) / 255
        // 平方曲线压小噪声、保留峰值动态；下限 0.08 让静默时仍有微小呼吸条。
        const target = Math.max(0.08, avg * avg * 1.4)
        levels[i] += (Math.min(1, target) - levels[i]) * 0.35
        const h = Math.max(2, levels[i] * maxHeight)
        const x = i * (barWidth + gap)
        const y = (maxHeight - h) / 2
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, h, barWidth / 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [analyser, bars, barWidth, gap, maxHeight])

  if (!analyser) {
    // CSS 假条回退（与原 aji-wave 动画一致）
    return (
      <span className="flex items-center" style={{ gap }}>
        {LIVE_HEIGHTS.slice(0, bars).map((h, i) => (
          <span
            key={i}
            className="rounded-[2px] bg-pri"
            style={{
              width: barWidth,
              height: Math.min(h, maxHeight),
              transformOrigin: 'center',
              animation: 'aji-wave 1s ease-in-out ' + i * 0.12 + 's infinite',
            }}
          />
        ))}
      </span>
    )
  }
  const cssWidth = bars * barWidth + (bars - 1) * gap
  return <canvas ref={canvasRef} style={{ width: cssWidth, height: maxHeight }} aria-hidden="true" />
}

// ── Compact voice recording bar (footer, non-fullscreen) ──
// Wave 3 #2: recording no longer takes over main. Parts list + interim
// bubble stay visible/scrollable; this compact bar sits at the footer with
// a small waveform + elapsed timer + stop button.
export function VoiceBar({
  elapsed,
  onStop,
}: {
  elapsed: number
  onStop: () => void
}) {
  const t = useT()
  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-t border-brd/70 bg-card/90 px-4 backdrop-blur-lg animate-slide-up">
      <RealtimeWave bars={5} barWidth={3} gap={3} maxHeight={28} />
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-pri">
        <span
          className="inline-block size-2 rounded-full bg-pri"
          style={{ animation: 'aji-pulse 1s ease-in-out infinite' }}
        />
        {t('capture.recording', { duration: fmtDur(elapsed) })}
      </span>
      <button
        type="button"
        onClick={onStop}
        aria-label={t('capture.aria.stopRecording')}
        className="ml-auto flex size-12 items-center justify-center rounded-full bg-gradient-to-b from-pri to-pri/85 text-white shadow-glowPri cursor-pointer transition-all duration-base ease-out hover:brightness-[1.06] active:scale-90 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
      >
        <span className="block size-5 rounded-[3px] bg-white" />
      </button>
    </div>
  )
}

// ── Interim transcription bubble (shown in main area during recording) ──
// Wave 3 #2: live transcript shown inline below the parts list so the user
// can see what's being captured without a full-screen takeover.
export function InterimBubble({ liveTranscript }: { liveTranscript: string }) {
  const t = useT()
  return (
    <div className="rounded-card border border-pri/20 bg-priS/40 p-3 shadow-sm backdrop-blur-sm animate-fade-in-up">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-pri">
        <span className="inline-block size-1.5 animate-pulse rounded-full bg-pri" />
        {t('capture.transcribing')}
      </p>
      <p className="mt-1.5 min-h-[1.5em] text-[13px] leading-relaxed text-t2">
        {liveTranscript || '…'}
      </p>
    </div>
  )
}

// ── No-mic denial panel ──
// D3: On Capacitor native, navigator.permissions.query is unreliable — the panel
// may show even when the system permission is granted. The retry button probes
// with an actual getUserMedia call (via requestMicPermission) to re-detect.
export function NoMicPanel({ onUseText, onRetry }: { onUseText: () => void; onRetry: () => void }) {
  const isNative = Capacitor.isNativePlatform()
  const t = useT()
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="flex size-20 items-center justify-center rounded-full border border-brd bg-card">
        <Mic size={32} strokeWidth={1.8} className="text-t3" />
      </div>
      <div>
        <p className="text-[16px] font-bold text-ink">{t('capture.micDeniedTitle')}</p>
        <p className="mt-2 max-w-[280px] text-[12px] leading-relaxed text-t2">
          {isNative
            ? t('capture.micDeniedNative')
            : t('capture.micDeniedWeb')}
        </p>
      </div>
      <div className="flex w-full max-w-[280px] gap-3">
        <button
          type="button"
          onClick={onUseText}
          className="flex h-11 flex-1 items-center justify-center rounded-btn bg-pri text-[13px] font-medium text-white cursor-pointer transition duration-base ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
        >
          {t('capture.useText')}
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="flex h-11 flex-1 items-center justify-center rounded-btn border border-brd bg-card text-[13px] font-medium text-t2 cursor-pointer transition duration-base ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
        >
          {t('common.retry')}
        </button>
      </div>
    </div>
  )
}

// ── Camera capture overlay. Owns startCamera/stopCamera lifecycle via effect.
// Wave 3 #1: mode (photo/video) is internal state + segmented toggle at top.
// 'photo' captures a still on shutter; 'video' toggles record on shutter.
// D8: video recording needs CAMERA + RECORD_AUDIO. If startCamera({video,audio})
// fails, we probe with {video-only} to distinguish camera-denied from mic-denied.
// When mic is denied for video, camera still works for photos — we show a banner
// and let the user switch to photo mode or record silent video. ──
export function CameraView({
  onPart,
  onClose,
}: {
  onPart: (part: EntryPart, blob: Blob) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [mode, setMode] = useState<'photo' | 'video'>('photo')
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')
  const [recording, setRecording] = useState(false)
  const [denied, setDenied] = useState(false)
  // D8: camera is granted but mic is not — video mode can preview (video-only
  // stream) but recording will be silent. User should switch to photo or grant mic.
  const [micDeniedForVideo, setMicDeniedForVideo] = useState(false)
  const [busy, setBusy] = useState(false)
  // 快门白闪：key 递增触发一次性 fade-out 覆盖层（模拟系统相机快门反馈）。
  const [flashKey, setFlashKey] = useState(0)
  const t = useT()

  // Start camera on mount / facing switch / mode switch; release on unmount +
  // when the PWA is backgrounded (pagehide) so the camera light doesn't stay on.
  useEffect(() => {
    let active = true
    void (async () => {
      const withAudio = mode === 'video'
      const ok = await di.capture.startCamera({
        preview: videoRef.current ?? undefined,
        facingMode: facing,
        withAudio,
      })
      if (!active) {
        void di.capture.stopCamera()
        return
      }
      if (ok) {
        setDenied(false)
        setMicDeniedForVideo(false)
        return
      }
      // D8: startCamera with audio failed. If we were requesting audio (video
      // mode), probe with video-only to check if the camera itself is granted.
      if (withAudio) {
        const probeOk = await di.capture.startCamera({
          preview: videoRef.current ?? undefined,
          facingMode: facing,
          withAudio: false,
        })
        if (!active) {
          void di.capture.stopCamera()
          return
        }
        if (probeOk) {
          // Camera works, mic doesn't — keep stream for photo mode / silent video.
          setDenied(false)
          setMicDeniedForVideo(true)
          return
        }
      }
      // Camera itself is denied (or probe also failed).
      setDenied(true)
      setMicDeniedForVideo(false)
    })()
    const onHide = () => { void di.capture.stopCamera() }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      void di.capture.stopCamera()
    }
  }, [facing, mode])

  const handleShutter = async () => {
    if (busy || denied) return
    setBusy(true)
    try {
      if (mode === 'photo') {
        // 快门反馈先行（不等抓帧 await）——白闪+触感即时，感知零延迟。
        haptic('medium')
        setFlashKey((k) => k + 1)
        const r = await di.capture.capturePhoto()
        // D7: mark mediaType='image' so LLM prompt can chunk "以下图片内容：".
        if (r) onPart({ type: 'video', ref: r.ref, durationSec: 0, mime: r.mime, mediaType: 'image' }, r.blob)
        // 白闪 250ms 播完再关视图——否则 CameraView 秒卸，闪根本不可见。
        await new Promise((res) => setTimeout(res, 220))
        void di.capture.stopCamera()
        onClose()
      } else {
        if (!recording) {
          haptic('light')
          await di.capture.startVideo()
          setRecording(true)
        } else {
          const r = await di.capture.stopVideo()
          setRecording(false)
          // D7: mark mediaType='video' so LLM prompt can chunk "以下视频内容：".
          if (r) onPart({ type: 'video', ref: r.ref, durationSec: Math.max(1, Math.round(r.durationSec)), mime: r.mime, mediaType: 'video' }, r.blob)
          void di.capture.stopCamera()
          onClose()
        }
      }
    } catch (e) {
      console.error('[capture] camera shutter failed', e)
      setRecording(false)
    } finally {
      setBusy(false)
    }
  }

  const handleClose = async () => {
    if (recording) {
      try { await di.capture.stopVideo() } catch { /* noop */ }
      setRecording(false)
    }
    void di.capture.stopCamera()
    onClose()
  }

  const switchMode = (m: 'photo' | 'video') => {
    if (m === mode || recording || busy) return
    setMode(m)
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black">
      <div className="flex h-12 shrink-0 items-center justify-between px-4 text-white">
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('capture.aria.closeCamera')}
          className="flex size-11 items-center justify-center rounded-full bg-white/15 cursor-pointer transition duration-base ease-out active:scale-90 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
        >
          <X size={20} strokeWidth={2.2} />
        </button>
        {/* Wave 3 #1: segmented toggle to switch photo/video mode */}
        <div className="flex items-center rounded-full bg-white/15 p-0.5">
          {(['photo', 'video'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              disabled={recording || busy}
              className={cn(
                'flex min-h-11 items-center justify-center gap-1 rounded-full px-3 text-[13px] font-medium cursor-pointer transition duration-base ease-out active:scale-[0.97] disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none',
                mode === m ? 'bg-white text-black' : 'text-white/80',
              )}
            >
              {m === 'photo' ? <Camera size={14} strokeWidth={2.2} /> : <Video size={14} strokeWidth={2.2} />}
              {m === 'photo' ? t('capture.modePhoto') : t('capture.modeVideo')}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
          disabled={recording}
          aria-label={t('capture.aria.switchCamera')}
          className="flex size-11 items-center justify-center rounded-full bg-white/15 cursor-pointer transition duration-base ease-out active:scale-90 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
        >
          <Camera size={18} strokeWidth={2.2} />
        </button>
      </div>

      {/* D8: mic denied for video — show banner so user knows recording will be silent */}
      {micDeniedForVideo && mode === 'video' && !denied && (
        <div className="shrink-0 bg-amber-500/90 px-4 py-2 text-center text-[12px] font-medium text-white">
          {t('capture.videoMicDenied')}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        {denied ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
            <Camera size={36} strokeWidth={1.6} />
            <p className="text-[14px] font-medium">{t('capture.cameraDeniedTitle')}</p>
            <p className="max-w-[260px] text-[12px] leading-relaxed text-white/60">
              {t('capture.cameraDeniedHint')}
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 flex h-11 items-center justify-center rounded-btn bg-white/15 px-5 text-[13px] font-medium text-white cursor-pointer transition duration-base ease-out active:scale-95 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none"
            >
              {t('common.back')}
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              'h-full w-full object-cover',
              facing === 'user' && '-scale-x-100',
            )}
          />
        )}
        {/* 快门白闪：只在预览区闪（不盖顶栏/快门钮），250ms 消隐对齐系统相机。 */}
        {flashKey > 0 && (
          <motion.div
            key={flashKey}
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            onAnimationComplete={() => setFlashKey(0)}
            className="pointer-events-none absolute inset-0 z-10 bg-white"
          />
        )}
      </div>

      <div className="flex h-32 shrink-0 items-center justify-center gap-10">
        <span className="w-12" />
        <button
          type="button"
          onClick={handleShutter}
          disabled={busy || denied}
          aria-label={mode === 'video' ? (recording ? t('capture.aria.stopRecord') : t('capture.aria.startRecord')) : t('capture.aria.takePhoto')}
          className={cn(
            'flex items-center justify-center rounded-full border-4 border-white bg-white/10 cursor-pointer transition duration-base ease-out active:scale-95 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card outline-none',
            recording ? 'size-16 border-red-500' : 'size-[68px]',
          )}
        >
          <span className={cn('rounded-full', recording ? 'size-6 bg-red-500' : 'size-14 bg-white')} />
        </button>
        <span className="flex w-12 justify-center">
          {recording && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-red-400">
              <span
                className="inline-block size-2 rounded-full bg-red-500"
                style={{ animation: 'aji-pulse 1s ease-in-out infinite' }}
              />
              REC
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
