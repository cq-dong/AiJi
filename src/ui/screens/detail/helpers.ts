import type { EntryPart } from '@/domain/types'
import { seedCategories, seedTags } from '@/data/seed'

export type ChipTone = 'default' | 'idea' | 'project' | 'pending' | 'fail'

const CAT_BY_SLUG = new Map(seedCategories.map((c) => [c.slug, c]))
const TAG_BY_SLUG = new Map(seedTags.map((t) => [t.slug, t]))

export function categoryLabel(slug: string): string {
  return CAT_BY_SLUG.get(slug)?.label ?? slug
}

export function categoryTone(slug: string): ChipTone {
  switch (CAT_BY_SLUG.get(slug)?.accent) {
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

export function tagLabel(slug: string): string {
  return TAG_BY_SLUG.get(slug)?.label ?? slug
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
