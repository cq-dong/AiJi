import { t } from '@/app/i18n'
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
  return t('detail.titleFormat', {
    m: d.getMonth() + 1,
    d: d.getDate(),
    hh: pad(d.getHours()),
    mm: pad(d.getMinutes()),
  })
}

export function relativeTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return t('detail.justNow')
  if (min < 60) return t('detail.minutesAgo', { min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('detail.hoursAgo', { hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return t('detail.daysAgo', { day })
  return formatDateTime(iso)
}

export function partTypeLabel(part: EntryPart): string {
  switch (part.type) {
    case 'text':
      return t('detail.partType.text')
    case 'audio':
      return t('detail.partType.audio')
    case 'video':
      // CLAUDE.md: 照片是 durationSec=0 的 video part（mediaType='image'）。
      // 区分照片与真视频，否则单拍照片在详情页被错标「视频」（D14）。
      return part.mediaType === 'image' || part.durationSec === 0 ? t('detail.partType.image') : t('detail.partType.video')
  }
}
