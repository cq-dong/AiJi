import type { EntryAi, Facets } from '@/domain/types'
import { Button, Card, Chip, Skeleton, Spinner } from '@/ui/components'
import { categoryLabel, categoryTone, relativeTime, tagLabel, type ChipTone } from './helpers'

export type AiState = 'ready' | 'processing' | 'failed'

function FacetChips({ facets }: { facets: Facets }) {
  const chips: { label: string; tone: ChipTone }[] = []
  if (facets.mood) chips.push({ label: `情绪·${facets.mood}`, tone: 'pending' })
  if (facets.place) chips.push({ label: `地点·${facets.place}`, tone: 'project' })
  if (facets.project) chips.push({ label: `项目·${facets.project}`, tone: 'project' })
  if (facets.event) chips.push({ label: `事件·${facets.event}`, tone: 'fail' })
  facets.person?.forEach((p) => chips.push({ label: `人物·${p}`, tone: 'idea' }))
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-t3">侧面</span>
      {chips.map((c) => (
        <Chip key={c.label} tone={c.tone}>
          {c.label}
        </Chip>
      ))}
    </div>
  )
}

function ReadyBody({ ai }: { ai: EntryAi }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-t3">
        {ai.modelUsed} · {relativeTime(ai.createdAt)}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-t3">类别</span>
        <Chip tone={categoryTone(ai.category)}>{categoryLabel(ai.category)}</Chip>
      </div>
      {ai.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-t3">标签</span>
          {ai.tags.map((t) => (
            <Chip key={t} tone="default">
              {tagLabel(t)}
            </Chip>
          ))}
        </div>
      )}
      <FacetChips facets={ai.facets} />
      <div className="h-px bg-brd" />
      {ai.titleSuggestion && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-t3">标题</span>
          <p className="text-[14px] font-bold text-ink">{ai.titleSuggestion}</p>
        </div>
      )}
      {ai.summary && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-t3">摘要</span>
          <p className="text-[12px] leading-relaxed text-t2">{ai.summary}</p>
        </div>
      )}
      <div className="flex items-center gap-4 pt-1">
        <button type="button" className="text-[12px] text-t3">编辑</button>
        <button type="button" className="text-[12px] text-t3">重处理</button>
        <button type="button" className="text-[12px] text-catFail">删除</button>
      </div>
    </div>
  )
}

function ProcessingBody() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Spinner size={14} />
        <p className="text-[14px] font-medium text-pri">AI 处理中…</p>
      </div>
      <p className="text-[11px] text-t3">正在分类 · 已转写</p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-[200px]" rounded="rounded" />
        <Skeleton className="h-3 w-[260px]" rounded="rounded" />
        <Skeleton className="h-3 w-[180px]" rounded="rounded" />
      </div>
      <p className="text-[11px] text-t3">类别 / 标签 / 侧面 由 AI 自动涌现</p>
    </div>
  )
}

function FailedBody() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] font-bold text-catFail">处理失败</p>
      <p className="text-[11px] text-t2">网络或模型异常，原始条目已保存</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="primary" className="bg-catFail">
          重试
        </Button>
        <Button type="button" variant="secondary">
          手动编辑
        </Button>
      </div>
    </div>
  )
}

export function AiPanel({ state, ai }: { state: AiState; ai?: EntryAi }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold text-ink">AI 处理</h2>
        <Chip tone="pending">上送云端</Chip>
      </div>
      {state === 'ready' && ai && <ReadyBody ai={ai} />}
      {state === 'ready' && !ai && <p className="text-[12px] text-t3">暂无 AI 处理结果</p>}
      {state === 'processing' && <ProcessingBody />}
      {state === 'failed' && <FailedBody />}
    </Card>
  )
}
