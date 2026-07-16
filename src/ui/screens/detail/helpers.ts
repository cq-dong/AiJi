import type { Category, EntryPart, Tag } from '@/domain/types'

export type ChipTone = 'default' | 'idea' | 'project' | 'pending' | 'fail'

// 接受 store 数据作参数（屏实现传 useUiStore 的 categories/tags）。
// 不再依赖模块顶层 seed Map——涌现类别/标签由 LLM 落库后经 store 派发，此处只做纯查表。
export function categoryLabel(slug: string, categories: Category[]): string {
  return categories.find((c) => c.slug === slug)?.label ?? slug
}

export function categoryTone(slug: string, categories: Category[]): ChipTone {
  switch (categories.find((c) => c.slug === slug)?.accent) {
    case 'catIdea':
      return 'idea'
    case 'catProject':
      return 'project'
    case 'catPending':
      return 'pending'
    case 'catFail':
      return 'fail'
    default:
      return 'default'
  }
}

export function tagLabel(slug: string, tags: Tag[]): string {
  return tags.find((t) => t.slug === slug)?.label ?? slug
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${pad(m)}:${pad(s)}`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatTitle(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function relativeTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}天前`
  return formatDateTime(iso)
}

export function partTypeLabel(part: EntryPart): string {
  switch (part.type) {
    case 'text':
      return '文本'
    case 'audio':
      return '语音'
    case 'video':
      return '视频'
  }
}
