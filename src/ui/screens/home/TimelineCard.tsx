import { useNavigate } from 'react-router-dom'
import type { Entry, EntryAi } from '@/domain/types'
import { Chip, cn } from '@/ui/components'
import { firstText, modalityLabel, timeLabel } from './helpers'

type Accent = 'catIdea' | 'catProject' | 'catPending' | 'catFail' | undefined

const BAR: Record<NonNullable<Accent>, string> = {
  catIdea: 'bg-catIdea',
  catProject: 'bg-catProject',
  catPending: 'bg-catPending',
  catFail: 'bg-catFail',
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

function ReadyCard({ entry, ai, catLabel, catAccent }: CardProps) {
  const navigate = useNavigate()
  const title = ai?.titleSuggestion || firstText(entry.parts) || '未命名'
  const preview = firstText(entry.parts)
  const bar = catAccent ? BAR[catAccent] : 'bg-t3'
  const tone = catAccent ? CHIP_TONE[catAccent] : 'default'
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
      className="relative h-[120px] cursor-pointer overflow-hidden rounded-card border border-brd bg-card"
    >
      <span className={cn('absolute left-0 top-0 bottom-0 w-1', bar)} />
      <div className="flex h-full flex-col py-[13px] pl-[19px] pr-3">
        <div>
          <h3 className="line-clamp-2 text-[14px] font-medium leading-tight text-ink">{title}</h3>
          {preview && (
            <p className="mt-[4px] line-clamp-2 text-[13px] leading-tight text-t2">{preview}</p>
          )}
        </div>
        <div className="mt-auto flex items-center gap-2">
          {catLabel && <Chip tone={tone}>{catLabel}</Chip>}
          <span className="text-[11px] text-t3">
            {timeLabel(entry.createdAt)} · {modalityLabel(entry.parts)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <span className="inline-block size-[7px] rounded-full bg-[#7c3aed]" />
            <span className="text-[10px] font-medium text-[#7c3aed]">AI 已分类</span>
          </div>
        </div>
      </div>
    </article>
  )
}

function ProcessingCard({ entry, catAccent }: CardProps) {
  const navigate = useNavigate()
  const title = firstText(entry.parts) || '未命名'
  const bar = catAccent ? BAR[catAccent] : 'bg-catPending'
  const { leftText, rightLabel, rightClass } = statusMeta(entry.status)
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
      className="relative h-[96px] cursor-pointer overflow-hidden rounded-card border border-brd bg-card"
    >
      <span className={cn('absolute left-0 top-0 bottom-0 w-1', bar)} />
      <div className="flex h-full flex-col py-[13px] pl-[19px] pr-3">
        <h3 className="line-clamp-1 text-[14px] font-medium leading-tight text-ink">{title}</h3>
        <div className="mt-[15px] h-[6px] w-full overflow-hidden rounded-[3px] bg-[#fdf2e0]">
          <div className="h-full w-3/5 rounded-[3px] bg-catPending" />
        </div>
        <div className="mt-[10px] flex items-center justify-between">
          <span className="text-[11px] font-medium text-catPending">{leftText}</span>
          <span className={cn('text-[11px] font-medium', rightClass)}>{rightLabel}</span>
        </div>
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
        rightClass: 'text-[#e56666]',
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
