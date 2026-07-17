import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import type { Entry, EntryAi } from '@/domain/types'
import { Chip, cn } from '@/ui/components'
import { di } from '@/app/di'
import { firstText, firstThumbRef, modalityLabel, timeLabel } from './helpers'

type Accent = 'catIdea' | 'catProject' | 'catPending' | 'catFail' | undefined

const BAR: Record<NonNullable<Accent>, string> = {
  catIdea: 'bg-catIdea/50',
  catProject: 'bg-catProject/50',
  catPending: 'bg-catPending/50',
  catFail: 'bg-catFail/50',
}

const CHIP_TONE: Record<NonNullable<Accent>, 'idea' | 'project' | 'pending' | 'fail'> = {
  catIdea: 'idea',
  catProject: 'project',
  catPending: 'pending',
  catFail: 'fail',
}

interface CardProps {
  entry: Entry
  ai?: EntryAi
  catLabel?: string
  catAccent?: Accent
}

export function TimelineCard({ entry, ai, catLabel, catAccent }: CardProps) {
  const isReady = entry.status === 'ready'
  if (isReady) return <ReadyCard entry={entry} ai={ai} catLabel={catLabel} catAccent={catAccent} />
  return <ProcessingCard entry={entry} catAccent={catAccent} />
}

// 右侧 48×48 媒体缩略图：图片直出，视频取首帧（#t=0.1）。seed 无 blob → 占位灰块。
function MediaThumb({ mediaRef }: { mediaRef: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    void (async () => {
      const blob = await di.storage.getMedia(mediaRef)
      if (cancelled) return
      if (!blob) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    })()
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [mediaRef])
  if (!url) {
    return <div className="size-12 shrink-0 rounded-[10px] bg-page" aria-hidden="true" />
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="size-12 shrink-0 rounded-[10px] object-cover"
    />
  )
}

function ReadyCard({ entry, ai, catLabel, catAccent }: CardProps) {
  const navigate = useNavigate()
  const title = ai?.titleSuggestion || firstText(entry.parts) || '未命名'
  const preview = firstText(entry.parts)
  const bar = catAccent ? BAR[catAccent] : 'bg-t3/40'
  const tone = catAccent ? CHIP_TONE[catAccent] : 'default'
  const thumbRef = firstThumbRef(entry.parts)
  const hasPreview = preview && preview !== title
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/detail/${entry.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/detail/${entry.id}`)
        }
      }}
      className="relative min-h-[84px] cursor-pointer overflow-hidden rounded-card border border-brd bg-card shadow-sm transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    >
      <span className={cn('absolute left-0 top-0 bottom-0 w-0.5', bar)} />
      <div className="flex gap-3 py-3 pl-[14px] pr-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{title}</h3>
          {hasPreview && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-t3">{preview}</p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-2 text-[11px] text-t3">
            {catLabel && <Chip tone={tone} className="!py-0">{catLabel}</Chip>}
            <span className="tabular-nums">{timeLabel(entry.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{modalityLabel(entry.parts)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-0.5 text-t3/80">
              <Check size={11} strokeWidth={2.5} className="text-catProject" />
              AI
            </span>
          </div>
        </div>
        {thumbRef && <MediaThumb mediaRef={thumbRef} />}
      </div>
    </article>
  )
}

function ProcessingCard({ entry, catAccent }: CardProps) {
  const navigate = useNavigate()
  const title = firstText(entry.parts) || '未命名'
  const bar = catAccent ? BAR[catAccent] : 'bg-catPending/50'
  const { leftText, rightLabel, rightClass } = statusMeta(entry.status)
  const thumbRef = firstThumbRef(entry.parts)
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/detail/${entry.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/detail/${entry.id}`)
        }
      }}
      className="relative min-h-[84px] cursor-pointer overflow-hidden rounded-card border border-brd bg-card shadow-sm transition duration-base ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    >
      <span className={cn('absolute left-0 top-0 bottom-0 w-0.5', bar)} />
      <div className="flex gap-3 py-3 pl-[14px] pr-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="line-clamp-1 text-[15px] font-semibold leading-snug text-ink">{title}</h3>
          <div className="mt-3 h-[5px] w-full max-w-[180px] overflow-hidden rounded-[3px] bg-catPending/10">
            <div className="h-full w-2/5 rounded-[3px] bg-catPending animate-indeterminate" />
          </div>
          <div className="mt-auto flex items-center gap-1.5 pt-2 text-[11px] font-medium">
            <span className="text-catPending">{leftText}</span>
            <span aria-hidden="true" className="text-t3/60">·</span>
            <span className={cn('tabular-nums', rightClass)}>{rightLabel}</span>
          </div>
        </div>
        {thumbRef && <MediaThumb mediaRef={thumbRef} />}
      </div>
    </article>
  )
}

function statusMeta(status: Entry['status']): {
  leftText: string
  rightLabel: string
  rightClass: string
} {
  switch (status) {
    case 'failed':
      return {
        leftText: '已转写 · 分类失败',
        rightLabel: '处理失败',
        rightClass: 'text-catFail',
      }
    case 'offline-pending':
      return {
        leftText: '已保存 · 待联网补跑',
        rightLabel: '离线·待补跑',
        rightClass: 'text-t2',
      }
    case 'processing':
    default:
      return {
        leftText: 'AI 正在分类 · 已转写',
        rightLabel: '处理中',
        rightClass: 'text-catPending',
      }
  }
}
