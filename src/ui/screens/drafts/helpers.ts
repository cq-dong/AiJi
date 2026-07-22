import { t } from '@/app/i18n'
import type { Draft } from '@/domain/types'

// 第一个 text part 的 content（无则空串）。
function firstText(d: Draft): string {
  for (const p of d.parts) {
    if (p.type === 'text') return p.content
  }
  return ''
}

// 第一个 audio/video part 的 transcript（无则空串）。
function firstTranscript(d: Draft): string {
  for (const p of d.parts) {
    if ((p.type === 'audio' || p.type === 'video') && p.transcript) return p.transcript
  }
  return ''
}

// 卡片标题：显式 title → 首段文本/转写前 16 字 → 「未命名草稿」。
export function draftTitle(d: Draft): string {
  if (d.title) return d.title
  const src = firstText(d) || firstTranscript(d)
  return src ? src.slice(0, 16) : t('drafts.untitled')
}

// 卡片预览：首段文本内容 → 首段转写 → 仅音视频时「（仅音频/视频）」→ 空。
export function draftPreview(d: Draft): string {
  const text = firstText(d)
  if (text) return text
  const tr = firstTranscript(d)
  if (tr) return tr
  const hasMedia = d.parts.some((p) => p.type === 'audio' || p.type === 'video')
  return hasMedia ? t('drafts.mediaOnly') : ''
}

// 相对时间：<1min「刚刚」· <60min「X 分钟前」· <24h「X 小时前」· <7d「X 天前」· 其余「MM-DD」。
// 局部变量改名 ts（避开 i18n 的 t），让插值 key 走模块级 t()。
export function relTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return t('drafts.justNow')
  if (diff < 3_600_000) return t('drafts.ago.minutes', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('drafts.ago.hours', { n: Math.floor(diff / 3_600_000) })
  if (diff < 604_800_000) return t('drafts.ago.days', { n: Math.floor(diff / 86_400_000) })
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
