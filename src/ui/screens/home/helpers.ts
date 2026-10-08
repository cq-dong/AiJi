import { t } from '@/app/i18n'
import { getCurrentLang } from '@/app/currentLang'
import type { EntryPart } from '@/domain/types'

// ISO → 本地日期键；seed +08:00 与新条目 Z 都走 new Date(iso) 取本地年月日，避免裸 slice 落到 UTC 日期。
function localDateKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

// 首个可作为缩略图的媒体 part 的 ref + 是否真视频。无则 undefined。
// isVideo 判定链（Q6 钉死顺序）：mediaType==='video' → true；mime video/* → true；
// durationSec>0 → true；否则 false。照片 = type:'video' + durationSec:0
//（mediaType='image' / mime image/*）→ false；seed 老数据无 mime/mediaType → 靠 durationSec。
export function firstThumb(parts: EntryPart[]): { ref: string; isVideo: boolean } | undefined {
  for (const p of parts) {
    if (p.type !== 'video') continue
    const isVideo = p.mediaType === 'video' || (p.mime?.startsWith('video/') ?? false) || p.durationSec > 0
    return { ref: p.ref, isVideo }
  }
  return undefined
}

// P-A 性能（2026-10-03）：窗口化分组。按组顺序累计渲染到 limit 截断（组内允许截断——
// 该组剩余条目下次加载再出）。纯函数，jsdom 可测。
export interface EntryGroup<E> {
  key: string
  label: string
  entries: E[]
}

export function windowGroups<E>(
  groups: ReadonlyArray<EntryGroup<E>>,
  limit: number,
): { visible: EntryGroup<E>[]; rendered: number } {
  const visible: EntryGroup<E>[] = []
  let rendered = 0
  for (const g of groups) {
    if (rendered >= limit) break
    const slice = g.entries.slice(0, limit - rendered)
    visible.push({ ...g, entries: slice })
    rendered += slice.length
  }
  return { visible, rendered }
}
