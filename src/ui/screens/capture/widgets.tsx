import { Video } from 'lucide-react'
import { cn } from '@/ui/components'
import type { EntryPart } from '@/domain/types'

export type Mode = 'voice' | 'text' | 'video'

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

// Capture hub: 96×96 priS circle with stylized mic (capsule + base)
export function CaptureHub({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="开始语音录制"
      className="absolute left-1/2 top-[224px] flex size-24 -translate-x-1/2 items-center justify-center rounded-full bg-priS transition active:scale-95"
    >
      <span className="flex flex-col items-center">
        <span className="h-9 w-5 rounded-[10px] bg-pri" />
        <span className="mt-1.5 h-1 w-8 rounded-[2px] bg-pri" />
      </span>
    </button>
  )
}

// Mini waveform: 44×44 pri square with 5 white bars (static) — used in audio part cards
const MINI_HEIGHTS = [10, 15, 20, 25, 30]
export function MiniWaveform() {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center gap-1 rounded-[4px] bg-pri">
      {MINI_HEIGHTS.map((h, i) => (
        <span key={i} className="w-1 rounded-[2px] bg-card" style={{ height: h }} />
      ))}
    </span>
  )
}

// Live waveform: 7 pri bars, animated — used while recording
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

// ── Tri-modal selector: three chips (文本/语音/视频). Active chip = big pri pill. ──
function Chip({ label, active, onClick, disabled }: { label: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-[90px] items-center justify-center text-[13px] font-medium transition active:scale-95',
        active ? 'h-12 rounded-[20px] bg-pri text-white' : 'h-11 rounded-card border border-brd bg-card text-t2',
      )}
    >
      {label}
    </button>
  )
}

export function TriModal({
  mode,
  top,
  disabled,
  onPick,
  onVideoPop,
}: {
  mode: Mode
  top: number
  disabled?: boolean
  onPick: (m: Mode) => void
  onVideoPop: () => void
}) {
  return (
    <div
      className={cn('absolute left-[40px] flex items-end gap-[20px]', disabled && 'opacity-45')}
      style={{ top }}
    >
      <Chip label="文本" active={mode === 'text'} onClick={() => onPick('text')} disabled={disabled} />
      <Chip label="语音" active={mode === 'voice'} onClick={() => onPick('voice')} disabled={disabled} />
      <Chip label="视频" active={mode === 'video'} onClick={onVideoPop} disabled={disabled} />
    </div>
  )
}

// ── Video sub-choice: 拍照 (pri) / 录视频 (card) ──
export function VideoPop({
  top,
  disabled,
  onPhoto,
  onVideo,
}: {
  top: number
  disabled?: boolean
  onPhoto: () => void
  onVideo: () => void
}) {
  return (
    <div
      className={cn(
        'absolute left-[238px] flex h-[46px] w-[112px] items-center gap-[2px] rounded-[12px] border border-brd bg-card p-[3px]',
        disabled && 'opacity-45',
      )}
      style={{ top }}
    >
      <button
        type="button"
        onClick={onPhoto}
        disabled={disabled}
        className="flex h-[38px] w-[52px] items-center justify-center gap-1 rounded-[8px] bg-pri text-[12px] font-medium text-white"
      >
        拍照
      </button>
      <button
        type="button"
        onClick={onVideo}
        disabled={disabled}
        className="flex h-[38px] w-[52px] items-center justify-center gap-1 rounded-[8px] border border-brd bg-card text-[12px] font-medium text-ink"
      >
        录视频
      </button>
    </div>
  )
}

// ── Parts stack: card holding accumulated parts + "添加片段" link ──
export function PartsStack({
  parts,
  onRemove,
  onAdd,
}: {
  parts: EntryPart[]
  onRemove: (i: number) => void
  onAdd: () => void
}) {
  return (
    <div className="absolute left-[16px] top-[104px] w-[358px] rounded-card border border-brd bg-card p-[15px]">
      <p className="text-[13px] font-bold text-ink">片段</p>
      <div className="mt-[12px] flex flex-col gap-2">
        {parts.map((p, i) => (
          <PartCard key={i} part={p} onRemove={() => onRemove(i)} />
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-[12px] text-[13px] font-medium text-pri active:opacity-60"
      >
        ＋ 添加片段
      </button>
    </div>
  )
}

function PartCard({ part, onRemove }: { part: EntryPart; onRemove: () => void }) {
  if (part.type === 'audio') {
    return (
      <div className="relative flex h-[76px] items-center rounded-[12px] bg-priS pl-3 pr-3">
        <MiniWaveform />
        <div className="ml-[14px] flex min-w-0 flex-col">
          <span className="text-[12px] font-medium text-pri">语音 · {fmtDur(part.durationSec)}</span>
          <span className="mt-1 line-clamp-2 w-[234px] text-[11px] leading-[1.4] text-t2">
            {part.transcript ?? ''}
          </span>
        </div>
        <RemoveButton onRemove={onRemove} />
      </div>
    )
  }
  if (part.type === 'video') {
    return (
      <div className="relative flex h-[76px] items-center rounded-[12px] bg-priS pl-3 pr-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[4px] bg-pri text-card">
          <Video size={20} strokeWidth={2.2} />
        </span>
        <div className="ml-[14px] flex min-w-0 flex-col">
          <span className="text-[12px] font-medium text-pri">视频 · {fmtDur(part.durationSec)}</span>
          <span className="mt-1 line-clamp-2 w-[234px] text-[11px] leading-[1.4] text-t2">
            {part.transcript ?? '视频片段'}
          </span>
        </div>
        <RemoveButton onRemove={onRemove} />
      </div>
    )
  }
  // text
  return (
    <div className="relative h-[64px] rounded-[12px] border border-brd bg-card px-[15px] py-[11px]">
      <span className="text-[11px] font-medium text-t3">文本</span>
      <p className="mt-[9px] w-[234px] truncate text-[13px] text-ink">{part.content}</p>
      <RemoveButton onRemove={onRemove} />
    </div>
  )
}

function RemoveButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="删除片段"
      className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-t3 active:opacity-60"
    >
      ✕
    </button>
  )
}
