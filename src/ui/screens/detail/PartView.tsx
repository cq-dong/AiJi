import type { EntryPart } from '@/domain/types'
import { Card } from '@/ui/components'
import { formatDateTime, formatDuration, partTypeLabel } from './helpers'

const BAR_HEIGHTS = [4, 11, 6, 13, 8, 15, 10, 5, 12, 7, 14, 9, 4, 11, 6, 13, 8, 15, 10, 5, 12, 7, 14, 9]

function PlayTriangle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={className} fill="currentColor" aria-hidden="true">
      <polygon points="2,1 9,5 2,9" />
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

function AudioPlayer({ durationSec }: { durationSec: number }) {
  return (
    <div className="flex items-center gap-2 h-[28px] rounded-[14px] bg-priS px-2">
      <span className="flex size-3 items-center justify-center text-pri">
        <PlayTriangle className="size-[10px]" />
      </span>
      <Waveform />
      <span className="ml-auto text-[11px] font-medium tabular-nums text-pri">{formatDuration(durationSec)}</span>
    </div>
  )
}

function VideoThumb({ durationSec }: { durationSec: number }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-gradient-to-br from-brd to-page">
      <span className="absolute bottom-2 left-2 rounded-[6px] bg-black/40 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
        {formatDuration(durationSec)}
      </span>
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
          <AudioPlayer durationSec={part.durationSec} />
        </>
      )}
      {part.type === 'video' && (
        <>
          <VideoThumb durationSec={part.durationSec} />
          {part.transcript && (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-t2">{part.transcript}</p>
          )}
        </>
      )}
    </Card>
  )
}
