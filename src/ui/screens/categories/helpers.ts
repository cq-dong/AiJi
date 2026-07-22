import type { EntryPart } from '@/domain/types'
import { t } from '@/app/i18n'
import type { I18nKey } from '@/app/i18n'

// 6 lens 维度 → i18n key（ViewSwitcher / CategoryDetail 分组 / FacetLens 共用）。
// 类别名/标签名是用户数据不入字典；这 6 个是固定 facet 维度枚举，入字典。
export type LensKind = 'category' | 'time' | 'mood' | 'project' | 'person' | 'place'
export const LENS_KEYS: Record<LensKind, I18nKey> = {
  category: 'categories.lens.category',
  time: 'categories.lens.time',
  mood: 'categories.lens.mood',
  project: 'categories.lens.project',
  person: 'categories.lens.person',
  place: 'categories.lens.place',
}

// Local date helpers — self-contained, NOT imported from screens/home/.
// ISO → local date key 'YYYY-MM-DD' (handles +08:00 and Z formats via new Date).
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

// "今天" anchor: newest entry's date (so seed data with 2026-07-15 still labels "今天").
export function todayKeyFrom(entries: ReadonlyArray<{ createdAt: string }>): string {
  if (entries.length === 0) return ''
  let maxIso = entries[0]!.createdAt
  let maxT = new Date(maxIso).getTime()
  for (const e of entries) {
    const t = new Date(e.createdAt).getTime()
    if (t > maxT) { maxT = t; maxIso = e.createdAt }
  }
  return localDateKey(maxIso)
}

// getDay() → 0=Sunday … 6=Saturday；对齐 categories.date.weekday.* 的 sun..sat 顺序。
const WEEKDAY_KEYS: I18nKey[] = [
  'categories.date.weekday.sun',
  'categories.date.weekday.mon',
  'categories.date.weekday.tue',
  'categories.date.weekday.wed',
  'categories.date.weekday.thu',
  'categories.date.weekday.fri',
  'categories.date.weekday.sat',
]

function parseYmd(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number)
  return [y, m - 1, d]
}

function weekdayLabel(key: string): string {
  const [y, m, d] = parseYmd(key)
  const wd = new Date(y, m, d).getDay()
  return t(WEEKDAY_KEYS[wd] ?? 'categories.date.weekday.unknown')
}

function monthDayLabel(key: string): string {
  const [, m, d] = parseYmd(key)
  return t('categories.date.monthDay', { m: m + 1, d })
}

function dayDiff(aKey: string, bKey: string): number {
  const [ay, am, ad] = parseYmd(aKey)
  const [by, bm, bd] = parseYmd(bKey)
  const a = new Date(ay, am, ad).getTime()
  const b = new Date(by, bm, bd).getTime()
  return Math.round((a - b) / 86_400_000)
}

// Date section header: 今天 / 昨天 / 明天 / 「M月D日 周X」
export function groupLabel(iso: string, todayKey: string): string {
  const key = localDateKey(iso)
  const diff = dayDiff(key, todayKey)
  if (diff === 0) return t('date.today')
  if (diff === -1) return t('date.yesterday')
  if (diff === 1) return t('categories.date.tomorrow')
  return `${monthDayLabel(key)} ${weekdayLabel(key)}`
}

// 时:分 (no leading zero on hour)
export function timeLabel(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${min}`
}

export function modalityLabel(parts: EntryPart[]): string {
  if (parts.length > 1) return t('categories.modality.multi')
  const p = parts[0]
  if (!p) return t('categories.modality.text')
  if (p.type === 'audio') return t('categories.modality.audio')
  if (p.type === 'video') return t('categories.modality.video')
  return t('categories.modality.text')
}

// First readable text (transcript or content) for preview / title fallback.
export function firstText(parts: EntryPart[]): string {
  for (const p of parts) {
    if (p.type === 'text') return p.content
    if (p.type === 'audio' && p.transcript) return p.transcript
    if (p.type === 'video' && p.transcript) return p.transcript
  }
  return ''
}
