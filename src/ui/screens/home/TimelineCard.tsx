import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import type { Entry, EntryAi } from '@/domain/types'
import { Chip, cn } from '@/ui/components'
import { di } from '@/app/di'
import { useT } from '@/app/i18n/useT'
import type { I18nKey } from '@/app/i18n'
import { firstText, firstThumbRef, modalityLabel, timeLabel } from './helpers'

type TFn = (key: I18nKey, params?: Record<string, string | number>) => string

type Accent = 'catIdea' | 'catProject' | 'catPending' | 'catFail' | undefined

// 左侧竖条：渐变色条内嵌卡片（上下留白），比贴边细线更精致
const BAR: Record<NonNullable<Accent>, string> = {
  catIdea: 'from-catIdea to-catIdea/40',
  catProject: 'from-catProject to-catProject/40',
  catPending: 'from-catPending to-catPending/40',
  catFail: 'from-catFail to-catFail/40',
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
  index?: number
}

// 卡片通用交互类：浮起阴影 + hover 边框提亮 + 按压下沉
const CARD_CLS =
  'group relative min-h-[84px] cursor-pointer overflow-hidden rounded-card border border-brd/80 bg-card shadow-card transition-all duration-base ease-out hover:border-t3/30 hover:shadow-cardHover active:scale-[0.98] active:shadow-sm focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card'

function cardStyle(index: number): React.CSSProperties {
  // stagger 入场：每张卡延迟 45ms，封顶 8 张（更早的立即出现，避免长列表持续跳动）
  return index < 8
    ? { animationDelay: `${index * 45}ms` }
    : { animation: 'none' }
}

export function TimelineCard({ entry, ai, catLabel, catAccent, index = 99 }: CardProps) {
  const isReady = entry.status === 'ready'
  if (isReady) return <ReadyCard entry={entry} ai={ai} catLabel={catLabel} catAccent={catAccent} index={index} />
  return <ProcessingCard entry={entry} catAccent={catAccent} index={index} />
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
    return <div className="size-12 shrink-0 rounded-[10px] bg-page ring-1 ring-brd/60" aria-hidden="true" />
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="size-12 shrink-0 rounded-[10px] object-cover ring-1 ring-brd/60"
    />
  )
}

function ReadyCard({ entry, ai, catLabel, catAccent, index = 99 }: CardProps) {
  const navigate = useNavigate()
  const t = useT()
  const title = ai?.titleSuggestion || firstText(entry.parts) || t('home.card.untitled')
  const preview = firstText(entry.parts)
  const bar = catAccent ? BAR[catAccent] : 'from-t3/50 to-t3/20'
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
      style={cardStyle(index)}
      className={cn(CARD_CLS, 'animate-fade-in-up')}
    >
      <span className={cn('absolute bottom-3 left-[7px] top-3 w-[3px] rounded-full bg-gradient-to-b', bar)} />
      <div className="flex gap-3 py-3 pl-[18px] pr-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink transition-colors duration-base group-hover:text-pri">
            {title}
          </h3>
          {hasPreview && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-t3">{preview}</p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-2 text-[11px] text-t3">
            {catLabel && <Chip tone={tone} className="!py-0">{catLabel}</Chip>}
            <span className="tabular-nums">{timeLabel(entry.createdAt)}</span>
            <span aria-hidden="true" className="text-t3/50">·</span>
            <span>{modalityLabel(entry.parts)}</span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-catProject/10 px-1.5 py-px font-medium text-catProject">
              <Check size={10} strokeWidth={3} />
              AI
            </span>
          </div>
        </div>
        {thumbRef && <MediaThumb mediaRef={thumbRef} />}
      </div>
    </article>
  )
}

function ProcessingCard({ entry, catAccent, index = 99 }: CardProps) {
  const navigate = useNavigate()
  const t = useT()
  const title = firstText(entry.parts) || t('home.card.untitled')
  const bar = catAccent ? BAR[catAccent] : 'from-catPending to-catPending/40'
  const { leftText, rightLabel, rightClass } = statusMeta(entry.status, t)
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
      style={cardStyle(index)}
      className={cn(CARD_CLS, 'animate-fade-in-up')}
    >
      <span className={cn('absolute bottom-3 left-[7px] top-3 w-[3px] rounded-full bg-gradient-to-b', bar)} />
      <div className="flex gap-3 py-3 pl-[18px] pr-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="line-clamp-1 text-[15px] font-semibold leading-snug text-ink">{title}</h3>
          <div className="mt-3 h-[5px] w-full max-w-[180px] overflow-hidden rounded-full bg-catPending/10">
            <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-catPending/60 to-catPending animate-indeterminate" />
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

function statusMeta(status: Entry['status'], t: TFn): {
  leftText: string
  rightLabel: string
  rightClass: string
} {
  switch (status) {
    case 'failed':
      return {
        leftText: t('home.card.status.failed.left'),
        rightLabel: t('home.card.status.failed.right'),
        rightClass: 'text-catFail',
      }
    case 'offline-pending':
      return {
        leftText: t('home.card.status.offline.left'),
        rightLabel: t('home.card.status.offline.right'),
        rightClass: 'text-t2',
      }
    case 'processing':
    default:
      return {
        leftText: t('home.card.status.processing.left'),
        rightLabel: t('home.card.status.processing.right'),
        rightClass: 'text-catPending',
      }
  }
}
