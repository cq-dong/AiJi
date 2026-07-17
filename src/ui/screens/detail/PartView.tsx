import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MapPin } from 'lucide-react'
import type { EntryPart, GeoPoint } from '@/domain/types'
import { Card } from '@/ui/components'
import { di } from '@/app/di'
import { formatDateTime, formatDuration, partTypeLabel } from './helpers'

const BAR_HEIGHTS = [4, 11, 6, 13, 8, 15, 10, 5, 12, 7, 14, 9, 4, 11, 6, 13, 8, 15, 10, 5, 12, 7, 14, 9]

// 点击图片 → 显示边框 + 右下角拖拽手柄；拖手柄沿对角线自由缩放（30%~160%）。
// 外层 overflow-x-auto：放大超过容器宽时可横向滚动看全图，缩小则居中无留白。
function ImageZoomable({ src }: { src: string }) {
  const [pct, setPct] = useState(100)
  const [active, setActive] = useState(false)
  const dragRef = useRef<{ x: number; start: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = { x: e.clientX, start: pct }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const w = wrapRef.current?.getBoundingClientRect().width || 300
    const next = Math.min(160, Math.max(30, dragRef.current.start + (dx / w) * 100))
    setPct(next)
  }
  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* pointer already released */ }
  }

  return (
    <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div ref={wrapRef} className="relative mx-auto block" style={{ width: `${pct}%` }}>
        <img
          src={src}
          alt=""
          onClick={() => setActive((a) => !a)}
          className="block w-full cursor-pointer rounded-[12px] object-cover"
        />
        {active && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-[12px] ring-2 ring-pri" />
            <div
              role="slider"
              aria-label="缩放图片"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={30}
              aria-valuemax={160}
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              className="absolute -bottom-2 -right-2 size-6 cursor-nwse-resize rounded-full border-2 border-pri bg-card shadow touch-none"
            />
          </>
        )}
      </div>
    </div>
  )
}

function PlayTriangle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={className} fill="currentColor" aria-hidden="true">
      <polygon points="2,1 9,5 2,9" />
    </svg>
  )
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={className} fill="currentColor" aria-hidden="true">
      <rect x="2" y="1" width="2" height="8" />
      <rect x="6" y="1" width="2" height="8" />
    </svg>
  )
}

function Waveform() {
  return (
    <div className="flex items-center gap-[2px]" aria-hidden="true">
      {BAR_HEIGHTS.map((h, i) => (
        <span key={i} className="bg-pri rounded-[1px]" style={{ width: 4, height: h }} />
      ))}
    </div>
  )
}

export function AudioPlayer({ mediaRef, durationSec }: { mediaRef: string; durationSec: number }) {
  // Fetch the persisted blob from OPFS (A2). Seed parts have no blob → static/disabled.
  const [status, setStatus] = useState<'loading' | 'ready' | 'none'>('loading')
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null
    void (async () => {
      const blob = await di.storage.getMedia(mediaRef)
      if (cancelled) return
      if (!blob) { setStatus('none'); return }
      createdUrl = URL.createObjectURL(blob)
      setUrl(createdUrl)
      setStatus('ready')
    })()
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [mediaRef])

  const toggle = () => {
    const a = audioRef.current
    if (!a || status !== 'ready') return
    if (playing) { a.pause(); setPlaying(false) }
    else { void a.play(); setPlaying(true) }
  }

  const disabled = status !== 'ready'
  if (status === 'none') {
    // seed parts 无 blob / OPFS 不可用 → 显式「音频不可用（样例）」静默态，别留一个点了没反应的按钮。
    return (
      <div className="flex items-center gap-2 h-[28px] rounded-[14px] bg-page px-2 text-t3">
        <span className="flex size-3 items-center justify-center opacity-40">
          <PlayTriangle className="size-[10px]" />
        </span>
        <span className="text-[11px] font-medium">音频不可用（样例）</span>
        <span className="ml-auto text-[11px] font-medium tabular-nums">{formatDuration(durationSec)}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 h-[28px] rounded-[14px] bg-priS px-2">
      <div className="relative flex items-center">
        <span className={`flex size-3 items-center justify-center text-pri ${disabled ? 'opacity-40' : ''}`} aria-hidden="true">
          {playing ? <PauseIcon className="size-[10px]" /> : <PlayTriangle className="size-[10px]" />}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-label={playing ? '暂停' : '播放'}
          className="absolute left-1/2 top-1/2 size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed"
        />
      </div>
      <Waveform />
      <span className="ml-auto text-[11px] font-medium tabular-nums text-pri">{formatDuration(durationSec)}</span>
      {status === 'ready' && url && (
        <audio ref={audioRef} src={url} onEnded={() => setPlaying(false)} className="hidden" />
      )}
    </div>
  )
}

export function VideoThumb({ mediaRef, durationSec }: { mediaRef: string; durationSec: number }) {
  // 取真实媒体 blob：durationSec===0 → 图片（<img>）；>0 → 视频（<video controls>）。
  // seed parts 无 blob → 显式「视频/图片不可用（样例）」静默态，与音频不可用一致。
  const [status, setStatus] = useState<'loading' | 'ready' | 'none'>('loading')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null
    void (async () => {
      const blob = await di.storage.getMedia(mediaRef)
      if (cancelled) return
      if (!blob) { setStatus('none'); return }
      createdUrl = URL.createObjectURL(blob)
      setUrl(createdUrl)
      setStatus('ready')
    })()
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [mediaRef])

  if (status === 'none') {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-[12px] bg-page text-t3">
        <span className="text-[11px] font-medium">
          {durationSec === 0 ? '图片不可用（样例）' : '视频不可用（样例）'}
        </span>
      </div>
    )
  }

  if (status === 'ready' && url) {
    if (durationSec === 0) {
      return <ImageZoomable src={url} />
    }
    return <video controls src={url} className="w-full rounded-[12px]" />
  }

  // loading：保留占位渐变 + 播放钮（避免首屏跳）。
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-gradient-to-br from-brd to-page">
      <span className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-pri text-card shadow">
        <PlayTriangle className="size-4" />
      </span>
    </div>
  )
}

// D7: media type label for display. Prefers explicit `mediaType` field (set at
// capture time); falls back to inferring from `part.type` + `durationSec` (so
// pre-D7 parts without mediaType still display correctly).
function mediaTypeLabel(part: EntryPart): string {
  if (part.mediaType) {
    switch (part.mediaType) {
      case 'text': return '文本'
      case 'image': return '图片'
      case 'video': return '视频'
      case 'audio': return '语音'
    }
  }
  if (part.type === 'text') return '文本'
  if (part.type === 'audio') return '语音'
  // VideoPart with durationSec=0 is a photo; >0 is a video.
  if (part.type === 'video') return part.durationSec === 0 ? '图片' : '视频'
  return ''
}

// D7: media type badge — small colored chip distinguishing text/image/video/audio.
// Helps the user (and visually signals to the LLM prompt builder) the modality.
function MediaTypeBadge({ part }: { part: EntryPart }) {
  const label = mediaTypeLabel(part)
  // Color by modality: text=neutral, image=pri, video=teal, audio=amber.
  const tone =
    part.mediaType === 'image' || (part.mediaType === undefined && part.type === 'video' && part.durationSec === 0)
      ? 'bg-priS text-pri'
      : part.mediaType === 'video' || (part.mediaType === undefined && part.type === 'video' && part.durationSec > 0)
        ? 'bg-teal-50 text-teal-600'
        : part.mediaType === 'audio' || part.type === 'audio'
          ? 'bg-amber-50 text-amber-600'
          : 'bg-page text-t2'
  return (
    <span className={`shrink-0 rounded-chip px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      {label}
    </span>
  )
}

// D5: Location badge — shows a pin icon + address (or lat/lng fallback).
// Exported so detail/index.tsx can import and display the entry's location
// alongside the parts list. Displays `address` (reverse-geocoded) → `label`
// (LLM/user-curated) → formatted lat/lng as last resort.
export function LocationBadge({ location }: { location?: GeoPoint }) {
  if (!location) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-t3">
        <MapPin size={12} strokeWidth={2} />
        地点：未记录（设置中可开启）
      </p>
    )
  }
  const display = location.address ?? location.label ?? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
  return (
    <p className="flex items-center gap-1 text-[11px] text-t2">
      <MapPin size={12} strokeWidth={2} className="shrink-0 text-pri" />
      <span className="truncate">{display}</span>
    </p>
  )
}

export function PartView({ part, iso, location }: { part: EntryPart; iso: string; location?: GeoPoint }) {
  const helper = `${formatDateTime(iso)} · ${partTypeLabel(part)}${
    part.type !== 'text' ? ' ' + formatDuration(part.durationSec) : ''
  }`
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-t3">{helper}</p>
        {/* D7: media type badge — distinguishes photo/video/audio/text */}
        <MediaTypeBadge part={part} />
      </div>
      {part.type === 'text' && (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{part.content}</p>
      )}
      {part.type === 'audio' && (
        <>
          {part.transcript && (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{part.transcript}</p>
          )}
          <AudioPlayer mediaRef={part.ref} durationSec={part.durationSec} />
        </>
      )}
      {part.type === 'video' && (
        <>
          <VideoThumb mediaRef={part.ref} durationSec={part.durationSec} />
          {part.transcript && (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-t2">{part.transcript}</p>
          )}
        </>
      )}
      {/* D5: show location on the first part's card (or wherever passed) */}
      {location && <LocationBadge location={location} />}
    </Card>
  )
}
