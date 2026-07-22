import { t } from '@/app/i18n'
import { getCurrentLang } from '@/app/currentLang'
import type { EntryPart } from '@/domain/types'

// "今天" 的参照点：取最新一条 entry 的日期作为时间线的锚定今天，
// 避免依赖系统真实日期（原型 seed 以 2026-07-15 为今天）。
// ISO → 本地日期键；seed +08:00 与新条目 Z 都走 new Date(iso) 取本地年月日，避免裸 slice 落到 UTC 日期。
function localDateKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayKeyFrom(entries: ReadonlyArray<{ createdAt: string }>): string {
  if (entries.length === 0) return ''
  let maxIso = entries[0]!.createdAt
  let maxT = new Date(maxIso).getTime()
  for (const e of entries) {
    const ts = new Date(e.createdAt).getTime()
    if (ts > maxT) { maxT = ts; maxIso = e.createdAt }
  }
  return localDateKey(maxIso)
}

export function dateKey(iso: string): string {
  return localDateKey(iso)
}

function locale(): string {
  return getCurrentLang() === 'zh' ? 'zh-CN' : 'en-US'
}

function parseYmd(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number)
  return [y, m - 1, d]
}

// 周几：Intl weekday short。zh→「周一」en→「Mon」。调用时读当前语言。
export function weekdayLabel(key: string): string {
  const [y, m, d] = parseYmd(key)
  return new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(y, m, d))
}

// M月D日：Intl month short + day。zh→「7月15日」en→「Jul 15」。
export function monthDayLabel(key: string): string {
  const [y, m, d] = parseYmd(key)
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(new Date(y, m, d))
}

function dayDiff(aKey: string, bKey: string): number {
  const [ay, am, ad] = parseYmd(aKey)
  const [by, bm, bd] = parseYmd(bKey)
  const a = new Date(ay, am, ad).getTime()
  const b = new Date(by, bm, bd).getTime()
  return Math.round((a - b) / 86_400_000)
}

// 日期分组表头：今天 / 昨天 / 明天 / 「M月D日 周X」
export function groupLabel(iso: string, todayKey: string): string {
  const key = dateKey(iso)
  const diff = dayDiff(key, todayKey)
  if (diff === 0) return t('date.today')
  if (diff === -1) return t('date.yesterday')
  if (diff === 1) return t('comp.rel.tomorrow')
  return `${monthDayLabel(key)} ${weekdayLabel(key)}`
}

// 顶部副标题里的日期：7月15日 周X
export function topDateLabel(todayKey: string): string {
  return `${monthDayLabel(todayKey)} ${weekdayLabel(todayKey)}`
}

// 时:分（时无前导 0）：经 new Date(iso) 取本地时分，兼容 +08:00 与 Z 两种 ISO。
export function timeLabel(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${min}`
}

export function modalityLabel(parts: EntryPart[]): string {
  if (parts.length > 1) return t('comp.modality.multi')
  const p = parts[0]
  if (!p) return t('comp.modality.text')
  if (p.type === 'audio') return t('comp.modality.audio')
  if (p.type === 'video') {
    // CLAUDE.md: 照片是 durationSec=0 的 video part（mediaType='image'）。
    // 区分照片与真视频，否则单拍照片在时间线被错标「视频」（D14）。
    return p.mediaType === 'image' || p.durationSec === 0 ? t('comp.modality.image') : t('comp.modality.video')
  }
  return t('comp.modality.text')
}

// 第一段可读文本（转写或正文），用于预览/无 AI 时的标题回退
export function firstText(parts: EntryPart[]): string {
  for (const p of parts) {
    if (p.type === 'text') return p.content
    if (p.type === 'audio' && p.transcript) return p.transcript
    if (p.type === 'video' && p.transcript) return p.transcript
  }
  return ''
}

// 首个可作为缩略图的媒体 part（图片或视频首帧）。无则 undefined。
export function firstThumbRef(parts: EntryPart[]): string | undefined {
  for (const p of parts) {
    if (p.type === 'video') return p.ref
  }
  return undefined
}
