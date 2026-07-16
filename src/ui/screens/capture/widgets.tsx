import { useEffect, useRef, useState } from 'react'
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
export function LiveWaveform() {
  return (
    <span className="flex items-center justify-center" style={{ gap: 15 }}>
      {LIVE_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="w-[5px] rounded-[2.5px] bg-pri"
          style={{
            height: h,
            transformOrigin: 'center',
            animation: 'aji-wave 1s ease-in-out ' + i * 0.12 + 's infinite',
          }}
        />
      ))}
    </span>
  )
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

  const startEdit = () => {
    setDraft(title ?? '')
    setEditing(true)
  }
  const commit = () => {
    const t = draft.trim()
    onTitleChange(t.length > 0 ? t : undefined)
    setEditing(false)
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 px-4">
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="flex size-8 items-center justify-center rounded-full text-ink active:bg-page"
      >
        <X size={20} strokeWidth={2.2} />
      </button>
      {editing ? (
        <input
          name="captureTitle"
          aria-label="条目标题"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() } }
          placeholder="新条目"
          maxLength={60}
          className="min-w-0 flex-1 border-b border-pri bg-transparent text-[17px] font-bold text-ink outline-none placeholder:text-t3"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="min-w-0 truncate text-[17px] font-bold text-ink"
        >
          {title || '新条目'}
        </button>
      )}
      {partCount > 0 && (
        <span className="flex h-6 shrink-0 items-center rounded-chip bg-priS px-2 text-[11px] font-medium text-pri">
          {partCount} 片段
        </span>
      )}
      {location && (
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] font-medium text-t2">
          <MapPin size={13} strokeWidth={2.2} className="text-pri" />
          <span className="max-w-[120px] truncate">{location.label ?? `${location.lat.toFixed(3)}, ${location.lng.toFixed(3)}`}</span>
        </span>
      )}
    </div>
  )
}

// ── Draft hint banner: shown when parts restored from persisted draft ──
export function DraftHintBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-chip bg-priS px-3 py-2">
      <Info size={14} strokeWidth={2.2} className="shrink-0 text-pri" />
      <span className="flex-1 text-[12px] font-medium text-pri">继续上次草稿</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭提示"
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-pri active:bg-pri/10"
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
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="删除片段"
      className="flex size-6 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm active:scale-90"
    >
      <X size={13} strokeWidth={2.4} />
    </button>
  )
}

// ── Flowing part block. Text is borderless (natural inline); audio is a compact
// bar; photo/video render the actual media. Photos are video parts with durationSec=0. ──
export function FlowPart({
  part,
  mediaUrl,
  onRemove,
}: {
  part: EntryPart
  mediaUrl?: string
  onRemove: () => void
}) {
  if (part.type === 'text') {
    return (
      <div className="relative py-1 pr-7">
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{part.content}</p>
        <button
          type="button"
          onClick={onRemove}
          aria-label="删除文本"
          className="absolute right-0 top-1 flex size-6 items-center justify-center rounded-full text-t3 active:bg-page"
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>
    )
  }
  if (part.type === 'audio') {
    return (
      <div className="relative flex h-12 items-center gap-2 rounded-btn bg-priS pl-2 pr-9">
        <MiniWaveform />
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium text-pri">语音 · {fmtDur(part.durationSec)}</span>
          {part.transcript && (
            <span className="line-clamp-1 text-[11px] leading-tight text-t2">{part.transcript}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="删除语音"
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-t3 active:bg-card"
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
          <img src={mediaUrl} alt="照片" className="block max-h-[420px] w-full object-contain" />
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

// ── Empty compose state: a real prompt, not a dead placeholder ──
export function EmptyCompose() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-priS">
        <Mic size={28} strokeWidth={2} className="text-pri" />
      </div>
      <p className="mt-5 text-[15px] font-medium text-ink">说一句、打几个字、或拍一张</p>
      <p className="mt-2 max-w-[260px] text-[12px] leading-relaxed text-t3">
        不点保存继续记，多条会堆成一条多片段
      </p>
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
        'flex flex-1 flex-col items-center gap-1.5 py-1 active:scale-95 disabled:opacity-40',
      )}
    >
      <span
        className={cn(
          'flex size-12 items-center justify-center rounded-card border transition',
          primary ? 'border-transparent bg-pri text-white' : 'border-brd bg-card text-ink',
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
  return (
    <div className="flex items-stretch gap-1">
      <ToolButton icon={<Type size={22} strokeWidth={2} />} label="文本" onClick={onText} disabled={disabled} />
      <ToolButton icon={<Mic size={22} strokeWidth={2} />} label="语音" onClick={onVoice} primary disabled={disabled} />
      <ToolButton icon={<Camera size={22} strokeWidth={2} />} label="相机" onClick={onCamera} disabled={disabled} />
      <ToolButton icon={<GalleryThumbnails size={22} strokeWidth={2} />} label="相册" onClick={onGallery} disabled={disabled} />
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
  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={onClear}
        disabled={disabled || saving}
        className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-btn border border-brd bg-card text-[13px] font-medium text-t2 transition active:scale-[0.98] disabled:opacity-40"
      >
        <Trash2 size={16} strokeWidth={2} />
        清空
      </button>
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={disabled || saving}
        className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-btn border border-brd bg-card text-[13px] font-medium text-t2 transition active:scale-[0.98] disabled:opacity-40"
      >
        <Bookmark size={16} strokeWidth={2} />
        存草稿
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || saving}
        className={cn(
          'flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-btn text-[15px] font-medium transition active:scale-[0.99] disabled:opacity-40',
          saving ? 'border border-brd bg-priS text-pri' : 'bg-pri text-white',
        )}
      >
        {saving ? (
          <>
            <Spinner size={16} /> 保存中…
          </>
        ) : (
          '保存'
        )}
      </button>
    </div>
  )
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
  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-t border-brd bg-card px-4">
      <span className="flex items-center" style={{ gap: 3 }}>
        {LIVE_HEIGHTS.slice(0, 5).map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-[2px] bg-pri"
            style={{
              height: Math.min(h, 28),
              transformOrigin: 'center',
              animation: 'aji-wave 1s ease-in-out ' + i * 0.12 + 's infinite',
            }}
          />
        ))}
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-pri">
        <span
          className="inline-block size-2 rounded-full bg-pri"
          style={{ animation: 'aji-pulse 1s ease-in-out infinite' }}
        />
        录音中 · {fmtDur(elapsed)}
      </span>
      <button
        type="button"
        onClick={onStop}
        aria-label="停止录音"
        className="ml-auto flex size-12 items-center justify-center rounded-full bg-pri text-white shadow-lg shadow-pri/30 active:scale-95"
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
  return (
    <div className="rounded-card border border-pri/20 bg-priS/30 p-3">
      <p className="text-[11px] font-medium text-pri">正在转写</p>
      <p className="mt-1.5 min-h-[1.5em] text-[13px] leading-relaxed text-t2">
        {liveTranscript || '…'}
      </p>
    </div>
  )
}

// ── No-mic denial panel ──
export function NoMicPanel({ onUseText, onRetry }: { onUseText: () => void; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="flex size-20 items-center justify-center rounded-full border border-brd bg-card">
        <Mic size={32} strokeWidth={1.8} className="text-t3" />
      </div>
      <div>
        <p className="text-[16px] font-bold text-ink">麦克风未授权</p>
        <p className="mt-2 max-w-[280px] text-[12px] leading-relaxed text-t2">
          未获得麦克风权限 · 可在系统设置中开启，或改用文本记录
        </p>
      </div>
      <div className="flex w-full max-w-[280px] gap-3">
        <button
          type="button"
          onClick={onUseText}
          className="flex h-11 flex-1 items-center justify-center rounded-btn bg-pri text-[13px] font-medium text-white active:scale-[0.98]"
        >
          改用文本
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="flex h-11 flex-1 items-center justify-center rounded-btn border border-brd bg-card text-[13px] font-medium text-t2 active:scale-[0.98]"
        >
          再试一次
        </button>
      </div>
    </div>
  )
}

// ── Text entry bottom sheet ──
export function TextEntrySheet({
  open,
  value,
  onChange,
  onAdd,
  onCancel,
}: {
  open: boolean
  value: string
  onChange: (v: string) => void
  onAdd: () => void
  onCancel: () => void
}) {
  if (!open) return null
  const canAdd = value.trim().length > 0
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end" role="dialog" aria-label="文本输入">
      <button type="button" aria-label="取消" tabIndex={-1} className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative rounded-t-[20px] bg-card px-4 pb-5 pt-3 shadow-lg">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-brd" />
        <textarea
          name="captureText"
          aria-label="条目内容"
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="记下点什么…"
          className="h-32 w-full resize-none rounded-card border border-brd bg-page p-3 text-[14px] leading-relaxed text-ink outline-none focus:border-pri"
        />
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 flex-1 items-center justify-center rounded-btn border border-brd bg-card text-[14px] font-medium text-t2 active:scale-[0.98]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={!canAdd}
            className="flex h-11 flex-1 items-center justify-center rounded-btn bg-pri text-[14px] font-medium text-white disabled:opacity-40 active:scale-[0.98]"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Camera capture overlay. Owns startCamera/stopCamera lifecycle via effect.
// Wave 3 #1: mode (photo/video) is internal state + segmented toggle at top.
// 'photo' captures a still on shutter; 'video' toggles record on shutter. ──
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
  const [busy, setBusy] = useState(false)

  // Start camera on mount / facing switch / mode switch; release on unmount +
  // when the PWA is backgrounded (pagehide) so the camera light doesn't stay on.
  useEffect(() => {
    let active = true
    void (async () => {
      const ok = await di.capture.startCamera({
        preview: videoRef.current ?? undefined,
        facingMode: facing,
        withAudio: mode === 'video',
      })
      if (!active) {
        void di.capture.stopCamera()
        return
      }
      if (!ok) setDenied(true)
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
        const r = await di.capture.capturePhoto()
        if (r) onPart({ type: 'video', ref: r.ref, durationSec: 0, mime: r.mime }, r.blob)
        void di.capture.stopCamera()
        onClose()
      } else {
        if (!recording) {
          await di.capture.startVideo()
          setRecording(true)
        } else {
          const r = await di.capture.stopVideo()
          setRecording(false)
          if (r) onPart({ type: 'video', ref: r.ref, durationSec: Math.max(1, Math.round(r.durationSec)), mime: r.mime }, r.blob)
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
          aria-label="关闭相机"
          className="flex size-8 items-center justify-center rounded-full bg-white/15 active:scale-90"
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
                'flex h-8 items-center justify-center gap-1 rounded-full px-3 text-[13px] font-medium transition disabled:opacity-60',
                mode === m ? 'bg-white text-black' : 'text-white/80',
              )}
            >
              {m === 'photo' ? <Camera size={14} strokeWidth={2.2} /> : <Video size={14} strokeWidth={2.2} />}
              {m === 'photo' ? '拍照' : '录视频'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
          disabled={recording}
          aria-label="切换摄像头"
          className="flex size-8 items-center justify-center rounded-full bg-white/15 active:scale-90 disabled:opacity-40"
        >
          <Camera size={18} strokeWidth={2.2} />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {denied ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
            <Camera size={36} strokeWidth={1.6} />
            <p className="text-[14px] font-medium">相机未授权</p>
            <p className="max-w-[260px] text-[12px] leading-relaxed text-white/60">
              请在系统设置中开启相机权限，或改用相册选择
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 flex h-10 items-center justify-center rounded-btn bg-white/15 px-5 text-[13px] font-medium text-white active:scale-95"
            >
              返回
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
      </div>

      <div className="flex h-32 shrink-0 items-center justify-center gap-10">
        <span className="w-12" />
        <button
          type="button"
          onClick={handleShutter}
          disabled={busy || denied}
          aria-label={mode === 'video' ? (recording ? '停止录制' : '开始录制') : '拍照'}
          className={cn(
            'flex items-center justify-center rounded-full border-4 border-white bg-white/10 transition active:scale-95 disabled:opacity-40',
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
