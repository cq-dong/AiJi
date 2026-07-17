import { useEffect, useRef, useState } from 'react'
import type { EntryPart } from '@/domain/types'
import { Card } from '@/ui/components'
import { di } from '@/app/di'
import { formatDateTime, formatDuration, partTypeLabel } from './helpers'

const BAR_HEIGHTS = [4, 11, 6, 13, 8, 15, 10, 5, 12, 7, 14, 9, 4, 11, 6, 13, 8, 15, 10, 5, 12, 7, 14, 9]

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

function AudioPlayer({ mediaRef, durationSec }: { mediaRef: string; durationSec: number }) {
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

function VideoThumb({ mediaRef, durationSec }: { mediaRef: string; durationSec: number }) {
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
      return <img src={url} alt="" className="w-full rounded-[12px] object-cover" />
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

export function PartView({ part, iso }: { part: EntryPart; iso: string }) {
  const helper = `${formatDateTime(iso)} · ${partTypeLabel(part)}${
    part.type !== 'text' ? ' ' + formatDuration(part.durationSec) : ''
  }`
  return (
    <Card className="flex flex-col gap-2">
      <p className="text-[11px] text-t3">{helper}</p>
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
    </Card>
  )
}
