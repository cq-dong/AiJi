import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  GalleryThumbnails,
  Image as ImageIcon,
  MapPin,
  Mic,
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

// ── Header: close + title + part-count + location chip ──
export function CaptureHeader({
  partCount,
  location,
  onClose,
}: {
  partCount: number
  location?: GeoPoint
  onClose: () => void
}) {
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
      <h1 className="text-[17px] font-bold text-ink">新条目</h1>
      {partCount > 0 && (
        <span className="flex h-6 items-center rounded-chip bg-priS px-2 text-[11px] font-medium text-pri">
          {partCount} 片段
        </span>
      )}
      {location && (
        <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-t2">
          <MapPin size={13} strokeWidth={2.2} className="text-pri" />
          <span className="max-w-[120px] truncate">{location.label ?? `${location.lat.toFixed(3)}, ${location.lng.toFixed(3)}`}</span>
        </span>
      )}
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

// ── Capture toolbar: text / voice / photo / video / gallery ──
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
  onPhoto,
  onVideo,
  onGallery,
  disabled,
}: {
  onText: () => void
  onVoice: () => void
  onPhoto: () => void
  onVideo: () => void
  onGallery: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-stretch gap-1">
      <ToolButton icon={<Type size={22} strokeWidth={2} />} label="文本" onClick={onText} disabled={disabled} />
      <ToolButton icon={<Mic size={22} strokeWidth={2} />} label="语音" onClick={onVoice} primary disabled={disabled} />
      <ToolButton icon={<Camera size={22} strokeWidth={2} />} label="拍照" onClick={onPhoto} disabled={disabled} />
      <ToolButton icon={<Video size={22} strokeWidth={2} />} label="录视频" onClick={onVideo} disabled={disabled} />
      <ToolButton icon={<GalleryThumbnails size={22} strokeWidth={2} />} label="相册" onClick={onGallery} disabled={disabled} />
    </div>
  )
}

// ── Sticky save bar ──
export function SaveBar({ saving, disabled, onSave }: { saving: boolean; disabled: boolean; onSave: () => void }) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={disabled || saving}
      className={cn(
        'flex h-12 w-full items-center justify-center gap-2 rounded-btn text-[15px] font-medium transition active:scale-[0.99] disabled:opacity-40',
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
  )
}

// ── Voice recording panel (shown while store.capture.recording) ──
export function VoicePanel({
  elapsed,
  liveTranscript,
  onStop,
}: {
  elapsed: number
  liveTranscript: string
  onStop: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-5 px-4 py-8">
      <div className="flex size-40 items-center justify-center rounded-full border-[1.5px] border-pri/15 bg-priS/40">
        <LiveWaveform />
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap text-[13px] font-medium text-pri">
        <span
          className="inline-block size-2 rounded-full bg-pri"
          style={{ animation: 'aji-pulse 1s ease-in-out infinite' }}
        />
        录音中 · {fmtDur(elapsed)}
      </div>
      <div className="w-full rounded-card border border-brd bg-card p-4">
        <p className="text-[12px] text-t3">正在转写</p>
        <p className="mt-2 min-h-[2.5em] text-[13px] leading-relaxed text-t2">
          {liveTranscript || '…'}
        </p>
      </div>
      <button
        type="button"
        onClick={onStop}
        aria-label="停止录音"
        className="flex size-16 items-center justify-center rounded-full bg-pri text-white shadow-lg shadow-pri/30 active:scale-95"
      >
        <span className="block size-6 rounded-[4px] bg-white" />
      </button>
      <p className="text-[11px] text-t3">点一下停止 · 自动存为语音片段</p>
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
// mode='photo' captures a still on shutter; 'video' toggles record on shutter. ──
export function CameraView({
  mode,
  onPart,
  onClose,
}: {
  mode: 'photo' | 'video'
  onPart: (part: EntryPart, blob: Blob) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')
  const [recording, setRecording] = useState(false)
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)

  // Start camera on mount / facing switch; release on unmount + when the PWA is
  // backgrounded (pagehide) so the camera light doesn't stay on (matches video-probe.html).
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
        if (r) onPart({ type: 'video', ref: r.ref, durationSec: 0 }, r.blob)
        void di.capture.stopCamera()
        onClose()
      } else {
        if (!recording) {
          await di.capture.startVideo()
          setRecording(true)
        } else {
          const r = await di.capture.stopVideo()
          setRecording(false)
          if (r) onPart({ type: 'video', ref: r.ref, durationSec: Math.max(1, Math.round(r.durationSec)) }, r.blob)
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
        <span className="text-[15px] font-medium">{mode === 'photo' ? '拍照' : '录视频'}</span>
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
