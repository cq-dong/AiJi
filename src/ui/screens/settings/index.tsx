import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brain, Check, ChevronDown, ChevronRight, Download, Info, MapPin, MessageSquare, Plus, Trash2, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Capacitor } from '@capacitor/core'
import { Button, Card, cn } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import { t } from '@/app/i18n'
import { getCurrentLang } from '@/app/currentLang'
import { di } from '@/app/di'
import { exportZip } from '@/adapters/zipExport'
import { canShareFiles, saveBlob, type SaveResult } from '@/adapters/fileShare'
import { importSampleData } from '@/adapters/dexieStorage'
import { BUILTIN_VLM_URL, BUILTIN_VLM_MODEL, BUILTIN_STT_URL_STREAM, BUILTIN_STT_URL_WHISPER, BUILTIN_STT_MODEL_STREAM, BUILTIN_STT_MODEL_WHISPER } from '@/adapters/builtinDefaults'
import { Toggle } from './Toggle'
import { AccountSection } from './AccountSection'
import type { UpdateInfo, DownloadProgress } from '@/ports'
import type { EntryPart, Settings as SettingsType } from '@/domain/types'

type Theme = 'light' | 'dark' | 'system'

const inputCls =
  'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

// 自定义下拉（替代原生 <select>——iOS 上原生 select 弹系统轮盘选择器，与卡片设计严重不搭）。
function SelectDropdown({
  value,
  options,
  onChange,
  placeholder = t('settings.selectPlaceholder'),
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  type DropStyle = { top?: number; bottom?: number; left?: number; width?: number; maxHeight?: number }
  const [dropStyle, setDropStyle] = useState<DropStyle>({})

  useEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const vh = window.innerHeight
    const margin = 8
    const spaceBelow = vh - rect.bottom - margin
    const spaceAbove = rect.top - margin
    const itemH = 40
    const listH = options.length * itemH + 8
    const needH = Math.min(listH, 240)
    if (spaceBelow >= needH || spaceBelow >= spaceAbove) {
      setDropStyle({ top: rect.bottom + 4, left: rect.left, width: rect.width, maxHeight: spaceBelow })
    } else {
      setDropStyle({ bottom: vh - rect.top + 4, left: rect.left, width: rect.width, maxHeight: spaceAbove })
    }
  }, [open, options.length])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    function onResize() {
      if (open) setOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  const selected = options.find((o) => o.value === value)
  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(inputCls, 'flex items-center justify-between text-left', !selected && 'text-t2')}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={cn('shrink-0 text-t2 transition-transform duration-base ease-out', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          className="fixed z-50 overflow-y-auto rounded-card border border-brd bg-card shadow-sheet"
          style={dropStyle}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center px-3 py-2.5 text-[13px] transition-colors duration-base ease-out',
                value === o.value ? 'bg-priS text-pri' : 'text-ink hover:bg-page',
              )}
            >
              {value === o.value ? (
                <Check size={14} strokeWidth={2} className="mr-2 shrink-0 text-pri" />
              ) : (
                <span className="mr-2 w-3.5 shrink-0" />
              )}
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// LLM 模型预设。选「自定义…」时展开一个自由 input。
const LLM_MODEL_PRESETS = [
  'deepseek-v4-flash',
  'gpt-4o',
  'claude-sonnet-5',
  'qwen-plus',
  'gemini-2-flash',
] as const
const CUSTOM_SENTINEL = '__custom'

// VLM（视觉多模态）模型预设。含图条目 classify 走此端点；未配则回落主 LLM。
const VLM_MODEL_PRESETS = [
  'qwen3.5-flash',
  'qwen-vl-max',
  'gpt-4o',
  'claude-sonnet-5',
  'gemini-2-flash',
] as const

// STT 双模式：stream=DashScope WS paraformer；whisper=OpenAI 兼容 REST。
const STT_MODES = ['stream', 'whisper'] as const
type SttMode = (typeof STT_MODES)[number]
// 标签/帮助文案随当前语言变 → 用函数（t() 读 currentLang），不用模块级常量（会在 import 时冻结）。
function sttModeLabel(m: SttMode): string {
  return m === 'stream' ? t('settings.sttModeStream') : t('settings.sttModeWhisper')
}
const STT_URL_PLACEHOLDERS: Record<SttMode, string> = {
  stream: 'wss://…/api-ws/v1/inference',
  whisper: 'https://…/v1',
}
// 用户未填时的默认填充。D30: 优先用 env 烘入的 BUILTIN_STT_*（CI 注入），否则回落硬编码公共端点。
const STT_URL_DEFAULTS: Partial<Record<SttMode, string>> = {
  stream: BUILTIN_STT_URL_STREAM || 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  whisper: BUILTIN_STT_URL_WHISPER || '',
}
function sttUrlHelp(m: SttMode): string {
  return m === 'stream' ? t('settings.sttUrlHelpStream') : t('settings.sttUrlHelpWhisper')
}
const STT_MODEL_PLACEHOLDERS: Record<SttMode, string> = {
  stream: BUILTIN_STT_MODEL_STREAM || 'paraformer-realtime-v2',
  whisper: BUILTIN_STT_MODEL_WHISPER || 'whisper-1',
}
const STT_MODEL_DEFAULTS: Record<SttMode, string> = STT_MODEL_PLACEHOLDERS

// 导出 Markdown：读 store 快照拼一份 Markdown，触发浏览器下载。
// 只读现成字段（entries / aiByEntry / categories / tags），不调 di.storage。
// 结构文案（标题/生成时间/类别/标签/摘要/无标题/无正文）随当前语言；条目正文/类别标签是用户数据，不翻译。
function buildExportMarkdown(): string {
  const { entries, aiByEntry, categories, tags } = useUiStore.getState()
  const catLabel = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? slug
  const tagLabel = (slug: string) => tags.find((tg) => tg.slug === slug)?.label ?? slug
  const tagSep = getCurrentLang() === 'zh' ? '、' : ', '
  const dateLocale = getCurrentLang() === 'zh' ? 'zh-CN' : 'en-US'
  const sorted = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const lines: string[] = []
  lines.push(`# ${t('settings.exportShareTitle')}`)
  lines.push('')
  lines.push(
    t('settings.mdHeader', {
      time: new Date().toLocaleString(dateLocale),
      count: entries.length,
    }),
  )
  lines.push('')
  for (const e of sorted) {
    const ai = aiByEntry[e.id]
    const firstText = e.parts.find((p) => p.type === 'text')?.content
    const firstTranscript = e.parts.find((p) => p.type !== 'text')?.transcript
    const fallbackTitle = (firstText ?? firstTranscript ?? '').slice(0, 16)
    const title = ai?.titleSuggestion || fallbackTitle || t('settings.mdNoTitle')
    lines.push(`## ${title}`)
    lines.push('')
    lines.push(`_${e.createdAt}_`)
    lines.push('')
    const bodyLines: string[] = []
    for (const p of e.parts) {
      if (p.type === 'text') bodyLines.push(p.content)
      else if (p.transcript) bodyLines.push(p.transcript)
    }
    lines.push(bodyLines.join('\n\n') || t('settings.mdNoBody'))
    lines.push('')
    if (ai) {
      const bits: string[] = []
      if (ai.category) bits.push(`${t('settings.mdCategory')}${catLabel(ai.category)}`)
      if (ai.tags.length)
        bits.push(`${t('settings.mdTags')}${ai.tags.map(tagLabel).join(tagSep)}`)
      if (ai.summary) bits.push(`${t('settings.mdSummary')}${ai.summary}`)
      if (bits.length) {
        lines.push(`> ${bits.join(' · ')}`)
        lines.push('')
      }
    }
    lines.push('---')
    lines.push('')
  }
  return lines.join('\n')
}

// D15: 走 saveBlob（平台分流：Web Share / Filesystem / a.click fallback），与 zipExport
// 同路径——Android WebView 里 <a download>.click() 静默失败，必须走 saveBlob。
async function downloadMarkdown(md: string): Promise<SaveResult> {
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  return saveBlob(blob, 'aiji-export.md')
}

// Web Share API：可用时弹原生分享面板（由系统选择目标 App，不做 per-app 定向）；
// 否则回退到剪贴板复制；两者皆不可用则禁用按钮。
const canShare =
  typeof navigator !== 'undefined' &&
  (typeof navigator.share === 'function' ||
    typeof navigator.clipboard?.writeText === 'function')

async function handleShare(): Promise<void> {
  const md = buildExportMarkdown()
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: t('settings.exportShareTitle'), text: md })
      return
    }
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(md)
      alert(t('settings.copiedToClipboard'))
    }
  } catch (err) {
    // 用户取消分享面板，静默处理。
    if (err instanceof DOMException && err.name === 'AbortError') return
    console.error('AiJi 分享失败：', err)
  }
}

// 提醒与待办已提升为独立 tab（/reminders），settings 不再持有入口或 sheet。
const THEMES: Theme[] = ['light', 'dark', 'system']
function themeLabel(key: Theme): string {
  return key === 'light'
    ? t('settings.themeLight')
    : key === 'dark'
      ? t('settings.themeDark')
      : t('settings.themeSystem')
}

// D10: 把 SaveResult 翻译成人类可读的反馈文案。method 决定主语态（分享/保存/下载），
// path 仅 filesystem 方式有值（content/file URI）。失败时返回 error 原文。
function formatSaveFeedback(result: SaveResult): string {
  if (!result.ok) {
    return result.error
      ? t('settings.exportFailedWith', { error: result.error })
      : t('settings.exportFailed')
  }
  if (result.method === 'share') return t('settings.shared')
  if (result.method === 'filesystem') {
    const p = result.path ?? ''
    // file:// 长 URI 截尾显示目录段；空时退回通用文案。
    const tail = p ? p.replace(/^file:\/\//, '').replace(/^content:\/\//, '') : ''
    return tail ? t('settings.savedTo', { path: tail }) : t('settings.savedToDefault')
  }
  if (result.method === 'download') return t('settings.downloadedToDir')
  return t('settings.exported')
}

// 统计媒体数（用于确认对话框预估）。仅按 parts 类型粗判，不读 OPFS（避免预热大 blob）。
function countMedia(parts: EntryPart[]): number {
  let n = 0
  for (const p of parts) {
    if (p.type === 'audio' || p.type === 'video') n++
  }
  return n
}

// D10: 导出 .zip 确认对话框。说明范围 + 文件名 + 媒体数 + 保存位置，确认后执行。
function ExportConfirmSheet({
  scopeLabel,
  filename,
  entryCount,
  mediaCount,
  onClose,
  onConfirm,
}: {
  scopeLabel: string
  filename: string
  entryCount: number
  mediaCount: number
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()
  const isNative = Capacitor.isNativePlatform()
  const locationHint = canShareFiles()
    ? t('settings.locShareSheet')
    : isNative
      ? t('settings.locDocuments')
      : t('settings.locDownloads')
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.exportConfirmTitle')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('settings.exportScope')}</span>
            <span className="text-[13px] font-medium text-ink">{scopeLabel}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('settings.entryCount')}</span>
            <span className="text-[13px] font-medium text-ink">{t('common.itemsCount', { count: entryCount })}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('settings.mediaCount')}</span>
            <span className="text-[13px] font-medium text-ink">{t('settings.mediaCountValue', { count: mediaCount })}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('settings.fileName')}</span>
            <span className="text-[12px] font-medium text-ink">{filename}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('settings.saveLocation')}</span>
            <span className="text-[12px] font-medium text-t2">{locationHint}</span>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={onConfirm}
          >
            {t('settings.confirmExport')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// D10: 轻量 toast——3 秒后自动消失。成功/失败用颜色区分。
function Toast({ message, ok, onDismiss }: { message: string; ok: boolean; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 pointer-events-none">
      <div
        className={cn(
          'pointer-events-auto max-w-[360px] rounded-btn px-4 py-2.5 text-[12px] font-medium shadow-sheet animate-slide-up',
          ok ? 'bg-ink text-card' : 'bg-catFail text-card',
        )}
        role="status"
      >
        {message}
      </div>
    </div>
  )
}

function ChevronRow({
  label,
  value,
  icon,
  onClick,
}: {
  label: string
  value?: string
  icon?: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-card border border-brd/80 bg-card p-4 text-left shadow-card transition-all duration-base ease-out cursor-pointer hover:border-t3/30 hover:shadow-cardHover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    >
      <span className="flex items-center gap-3">
        {icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-priS text-pri">
            {icon}
          </span>
        )}
        <span className="text-[14px] font-medium text-ink">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        {value && <span className="text-[11px] text-t3">{value}</span>}
        <ChevronRight size={17} strokeWidth={2.2} className="text-t3" />
      </span>
    </button>
  )
}

// 使用反馈入口：跳 /feedback（裸路由，多建议 + 可选图片，提交建 GitHub Issue）。
function FeedbackRow() {
  const navigate = useNavigate()
  const t = useT()
  return (
    <ChevronRow
      label={t('settings.feedback')}
      icon={<MessageSquare size={15} strokeWidth={2.2} />}
      onClick={() => navigate('/feedback')}
    />
  )
}

function ModelRow({
  label,
  value,
  hasKey,
  onClick,
}: {
  label: string
  value: string
  hasKey: boolean
  onClick?: () => void
}) {
  // Key 状态点：绿点=已配置 Key，灰点=未配置。settings.*KeyRef 是"Key 已存"的引用，
  // 真实值在 SecretStorePort；这里只反映 ref 是否存在，让用户一眼看到 Key 配置情况。
  const t = useT()
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between text-left transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      <span className="flex items-center gap-2">
        <span className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', hasKey ? 'bg-catProject' : 'bg-t3')} />
          <span className="text-[11px] text-t3">{hasKey ? t('settings.keyConfigured') : t('settings.keyNotConfigured')}</span>
        </span>
        <span className="max-w-[120px] truncate text-[11px] text-t3">{value}</span>
        <ChevronRight size={18} className="text-t2" />
      </span>
    </button>
  )
}

type PingResult = { ok: boolean; latencyMs?: number; error?: string }

function ByokSheet({ onClose }: { onClose: () => void }) {
  const settings = useUiStore((s) => s.settings)
  const setLlmConfig = useUiStore((s) => s.setLlmConfig)
  const t = useT()
  const [url, setUrl] = useState(settings.llmUrl ?? '')
  const initialModel = settings.llmModel ?? ''
  const initialSelect = LLM_MODEL_PRESETS.some((p) => p === initialModel)
    ? initialModel
    : initialModel
      ? CUSTOM_SENTINEL
      : 'deepseek-v4-flash'
  const [modelSelect, setModelSelect] = useState(initialSelect)
  const [modelCustom, setModelCustom] = useState(
    initialSelect === CUSTOM_SENTINEL ? initialModel : '',
  )
  const [key, setKey] = useState('')
  const hasKey = settings.apiKeyRef === 'llm:key'

  // 连通性测试：tiniest chat ping。测试前先把 url/model/key 同步进 store，再调 port。
  // 不同步则 ping 读的是旧 settings，测不出刚填的新配置。
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<PingResult | null>(null)

  const resolvedModel =
    modelSelect === CUSTOM_SENTINEL ? modelCustom.trim() : modelSelect

  async function handlePing() {
    setTesting(true)
    setTestResult(null)
    try {
      // 测表单未保存值：url/model 直传；key 留空时适配器回落已存 secret
      // （只改 url 不重填 key 也能测，不误删旧 key）。
      const r = await di.llm.ping({
        url: url.trim(),
        model: resolvedModel || 'deepseek-v4-flash',
        key: key.trim(),
      })
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.llmModelTitle')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">{t('settings.byokHelpLlm')}</p>

        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[11px] text-t2">{t('settings.llmUrlLabel')}</label>
            <input
              className={inputCls}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/v1/chat/completions"
            />
          </div>
          <div>
            <label className="text-[11px] text-t2">{t('settings.modelLabel')}</label>
            <SelectDropdown
              value={modelSelect}
              options={[
                ...LLM_MODEL_PRESETS.map((p) => ({ value: p, label: p })),
                { value: CUSTOM_SENTINEL, label: t('settings.customOption') },
              ]}
              onChange={(v) => setModelSelect(v)}
              placeholder={t('settings.selectModelPlaceholder')}
            />
            {modelSelect === CUSTOM_SENTINEL && (
              <input
                className={cn(inputCls, 'mt-2')}
                value={modelCustom}
                onChange={(e) => setModelCustom(e.target.value)}
                placeholder={t('settings.modelNamePlaceholder')}
              />
            )}
          </div>
          <div>
            <label className="text-[11px] text-t2">
              {t('settings.apiKeyLabel')}{hasKey ? t('settings.apiKeySetHint') : ''}
            </label>
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? t('settings.apiKeyKeepPlaceholder') : 'sk-…'}
            />
          </div>
        </div>

        {/* 连通性测试 */}
        <div className="mt-3">
          <button
            type="button"
            disabled={testing}
            onClick={() => void handlePing()}
            className={cn(
              'h-[38px] w-full rounded-btn text-[12px] font-medium transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              testing
                ? 'bg-brd text-t3'
                : 'border border-brd bg-card text-t2',
            )}
          >
            {testing ? t('settings.testing') : t('settings.testConnection')}
          </button>
          {testResult && (
            <p
              className={cn(
                'mt-2 text-[11px]',
                testResult.ok ? 'text-catProject' : 'text-catFail',
              )}
            >
              {testResult.ok
                ? `✓ +${testResult.latencyMs ?? '?'}ms`
                : `✗ ${testResult.error ?? t('settings.unknownError')}`}
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={() => {
              setLlmConfig(url.trim(), resolvedModel || 'deepseek-v4-flash', key)
              onClose()
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SttSheet({ onClose }: { onClose: () => void }) {
  const settings = useUiStore((s) => s.settings)
  const setSettings = useUiStore((s) => s.setSettings)
  const setSttConfig = useUiStore((s) => s.setSttConfig)
  const t = useT()
  const mode = settings.sttMode
  const [url, setUrl] = useState(settings.sttUrl ?? STT_URL_DEFAULTS[mode] ?? '')
  const [model, setModel] = useState(settings.sttModel ?? '')
  const [key, setKey] = useState('')
  const hasKey = settings.sttKeyRef === 'stt:key'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.sttModelTitle')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">{t('settings.byokHelpStt')}</p>

        <div className="mt-3 space-y-3">
          {/* 模式切换：stream / whisper。立即落 settings.sttMode。 */}
          <div>
            <label className="text-[11px] text-t2">{t('settings.sttModeLabel')}</label>
            <div className="mt-2 flex gap-2">
              {STT_MODES.map((m) => {
                const active = m === mode
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSettings({ sttMode: m })}
                    className={cn(
                      'h-11 flex-1 rounded-[16px] text-[12px] font-medium transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                      active ? 'bg-pri text-white' : 'border border-brd bg-card text-t2',
                    )}
                  >
                    {sttModeLabel(m)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* URL：单字段，含义随 mode 变。 */}
          <div>
            <label className="text-[11px] text-t2">{t('settings.endpointUrlLabel')}</label>
            <input
              className={inputCls}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={STT_URL_PLACEHOLDERS[mode]}
            />
            <p className="mt-1 text-[11px] text-t3">{sttUrlHelp(mode)}</p>
          </div>

          <div>
            <label className="text-[11px] text-t2">{t('settings.modelLabel')}</label>
            <input
              className={inputCls}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={STT_MODEL_PLACEHOLDERS[mode]}
            />
          </div>
          <div>
            <label className="text-[11px] text-t2">
              {t('settings.apiKeyLabel')}{hasKey ? t('settings.apiKeySetHint') : ''}
            </label>
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? t('settings.apiKeyKeepPlaceholder') : 'sk-…'}
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={() => {
              setSttConfig(model.trim() || STT_MODEL_DEFAULTS[mode], key)
              setSettings({ sttUrl: url.trim() || undefined })
              onClose()
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// D24: 地理编码 sheet——高德 web 服务 BYOK Key。未配 → 回落 Nominatim（境内常超时，
// 地址退化为坐标）。结构镜像 SttSheet 的单 Key 字段。
function GeocodingSheet({ onClose }: { onClose: () => void }) {
  const settings = useUiStore((s) => s.settings)
  const setGeocodingConfig = useUiStore((s) => s.setGeocodingConfig)
  const t = useT()
  const [key, setKey] = useState('')
  const hasKey = settings.geocodingKeyRef === 'geocoding:key'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.geocodingTitle')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">{t('settings.geocodingHelp')}</p>

        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[11px] text-t2">
              {t('settings.geocodingKeyLabel')}{hasKey ? t('settings.apiKeySetHint') : ''}
            </label>
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? t('settings.apiKeyKeepPlaceholder') : t('settings.geocodingKeyPlaceholder')}
            />
            <p className="mt-1 text-[11px] text-t3">{t('settings.geocodingKeyHelp')}</p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={() => {
              setGeocodingConfig(key.trim())
              onClose()
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// AI 记忆 sheet（2026-07-22）：用户明确记忆/偏好，classify 与 answerChat 注入 prompt。
// 结构镜像 SttSheet：记忆列表（content + 开关 + 删除）+ 底部输入框 + 添加按钮。
// 增/删/开关走 store action（落库 + 内存态），即时生效；prompt 注入由适配器拉 listMemories。
function MemorySheet({ onClose }: { onClose: () => void }) {
  const memories = useUiStore((s) => s.memories)
  const saveMemory = useUiStore((s) => s.saveMemory)
  const deleteMemory = useUiStore((s) => s.deleteMemory)
  const toggleMemory = useUiStore((s) => s.toggleMemory)
  const t = useT()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleAdd() {
    const trimmed = draft.trim()
    if (!trimmed) return
    setAdding(true)
    try {
      await saveMemory(trimmed)
      setDraft('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.memoryTitle')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">{t('settings.memoryHelp')}</p>

        <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto">
          {memories.length === 0 && (
            <div className="rounded-card border border-brd/80 bg-card px-3 py-4 text-center text-[12px] text-t3">
              {t('settings.memoryEmpty')}
            </div>
          )}
          {memories.map((m) => (
            <div key={m.id} className="flex items-start gap-2 rounded-card border border-brd/80 bg-card p-3">
              <div className="min-w-0 flex-1">
                <p className={cn('break-words text-[13px] leading-relaxed', m.enabled ? 'text-ink' : 'text-t3 line-through')}>{m.content}</p>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <Toggle checked={m.enabled} onChange={() => void toggleMemory(m.id)} />
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() => void deleteMemory(m.id)}
                  className="flex size-7 items-center justify-center rounded-btn text-t3 transition duration-base ease-out cursor-pointer hover:text-catFail active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <label className="text-[11px] text-t2">{t('settings.memoryAddLabel')}</label>
          <div className="mt-1 flex gap-2">
            <input
              className={inputCls}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('settings.memoryPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !adding) void handleAdd()
              }}
            />
            <Button
              variant="primary"
              size="sm"
              className="h-[38px] shrink-0 rounded-btn"
              disabled={adding || !draft.trim()}
              onClick={() => void handleAdd()}
            >
              <Plus size={14} strokeWidth={2.2} />
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <Button variant="secondary" size="sm" className="h-[38px] w-full rounded-btn" onClick={onClose}>
            {t('common.done')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// VLM sheet：含图条目分类的多模态端点（BYOK）。结构镜像 ByokSheet：
// url 必须是完整 chat completions URL（适配器不补 /chat/completions）。
function VlmSheet({ onClose }: { onClose: () => void }) {
  const settings = useUiStore((s) => s.settings)
  const setVlmConfig = useUiStore((s) => s.setVlmConfig)
  const t = useT()
  const [url, setUrl] = useState(settings.vlmUrl ?? BUILTIN_VLM_URL ?? '')
  const initialModel = settings.vlmModel ?? BUILTIN_VLM_MODEL ?? ''
  const initialSelect = VLM_MODEL_PRESETS.some((p) => p === initialModel)
    ? initialModel
    : initialModel
      ? CUSTOM_SENTINEL
      : 'qwen3.5-flash'
  const [modelSelect, setModelSelect] = useState(initialSelect)
  const [modelCustom, setModelCustom] = useState(
    initialSelect === CUSTOM_SENTINEL ? initialModel : '',
  )
  const [key, setKey] = useState('')
  const hasKey = settings.vlmKeyRef === 'vlm:key'

  // 连通性测试：同 ByokSheet——di.llm.ping 直传表单值；key 留空时适配器回落已存 secret。
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<PingResult | null>(null)

  const resolvedModel =
    modelSelect === CUSTOM_SENTINEL ? modelCustom.trim() : modelSelect

  async function handlePing() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await di.llm.ping({
        url: url.trim(),
        model: resolvedModel || 'qwen3.5-flash',
        key: key.trim(),
      })
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.vlmModelTitle')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">{t('settings.byokHelpVlm')}</p>

        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[11px] text-t2">{t('settings.vlmUrlLabel')}</label>
            <input
              className={inputCls}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/v1/chat/completions"
            />
            <p className="mt-1 text-[11px] text-t3">{t('settings.vlmUrlHelp')}</p>
          </div>
          <div>
            <label className="text-[11px] text-t2">{t('settings.modelLabel')}</label>
            <SelectDropdown
              value={modelSelect}
              options={[
                ...VLM_MODEL_PRESETS.map((p) => ({ value: p, label: p })),
                { value: CUSTOM_SENTINEL, label: t('settings.customOption') },
              ]}
              onChange={(v) => setModelSelect(v)}
              placeholder={t('settings.selectModelPlaceholder')}
            />
            {modelSelect === CUSTOM_SENTINEL && (
              <input
                className={cn(inputCls, 'mt-2')}
                value={modelCustom}
                onChange={(e) => setModelCustom(e.target.value)}
                placeholder={t('settings.modelNamePlaceholder')}
              />
            )}
          </div>
          <div>
            <label className="text-[11px] text-t2">
              {t('settings.apiKeyLabel')}{hasKey ? t('settings.apiKeySetHint') : ''}
            </label>
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? t('settings.apiKeyKeepPlaceholder') : 'sk-…'}
            />
          </div>
        </div>

        {/* 连通性测试 */}
        <div className="mt-3">
          <button
            type="button"
            disabled={testing}
            onClick={() => void handlePing()}
            className={cn(
              'h-[38px] w-full rounded-btn text-[12px] font-medium transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              testing
                ? 'bg-brd text-t3'
                : 'border border-brd bg-card text-t2',
            )}
          >
            {testing ? t('settings.testing') : t('settings.testConnection')}
          </button>
          {testResult && (
            <p
              className={cn(
                'mt-2 text-[11px]',
                testResult.ok ? 'text-catProject' : 'text-catFail',
              )}
            >
              {testResult.ok
                ? `✓ +${testResult.latencyMs ?? '?'}ms`
                : `✗ ${testResult.error ?? t('settings.unknownError')}`}
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={() => {
              setVlmConfig(url.trim(), resolvedModel || 'qwen3.5-flash', key)
              onClose()
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// 关于 sheet：显示当前版本 / 最新版本 / 检查状态 / 更新日志。镜像 ByokSheet 的
// 底部 sheet 模式。checkForUpdate 走 di.appUpdate（web=fetch GitHub API，Android=同）；
// downloadAndInstall 走 di.appUpdate（Android=原生插件下载安装，web=跳 release 页）。
type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; info: UpdateInfo }
  | { status: 'error'; message: string }

function AboutSheet({ onClose }: { onClose: () => void }) {
  const isNative = Capacitor.isNativePlatform()
  const t = useT()
  const [state, setState] = useState<CheckState>({ status: 'idle' })
  const [installing, setInstalling] = useState(false)
  const [installErr, setInstallErr] = useState<string | null>(null)
  // 下载进度（仅 Android 原生）：received/total bytes，percent 0-100（-1=总大小未知）。
  // null = 未在下载 / 已重置；非 null 即正在下载或刚完成（UI 据此显示进度条）。
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  // 下载完成（promise resolve）后系统安装器会拉起，UI 显示「下载完成，等待安装…」短暂态。
  // downloaded flag 在 resolve 时置 true，下次点击安装按钮或关闭 sheet 时重置。
  const [downloaded, setDownloaded] = useState(false)

  async function handleCheck() {
    setState({ status: 'checking' })
    setInstallErr(null)
    try {
      const info = await di.appUpdate.checkForUpdate()
      setState({ status: 'ok', info })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function handleInstall() {
    if (state.status !== 'ok') return
    setInstalling(true)
    setInstallErr(null)
    setProgress(null)
    setDownloaded(false)
    try {
      await di.appUpdate.downloadAndInstall(state.info, (p) => setProgress(p))
      setDownloaded(true)
    } catch (e) {
      setInstallErr(e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(false)
    }
  }

  const formatMB = (bytes: number): string => (bytes / 1048576).toFixed(1)
  const hasProgress = !!progress
  const showProgressBar = hasProgress && progress!.percent >= 0
  const percentClamped = hasProgress ? Math.max(0, Math.min(100, progress!.percent)) : 0

  const info = state.status === 'ok' ? state.info : null
  const latestLabel = info ? (info.latest === '—' ? t('settings.notReleased') : `v${info.latest}`) : '—'
  const hasUpdate = info?.hasUpdate ?? false

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.aboutTitle')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('settings.currentVersion')}</span>
            <span className="text-[13px] font-medium text-ink">v{__APP_VERSION__}</span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('settings.latestVersion')}</span>
            <span className={cn('text-[13px] font-medium', hasUpdate ? 'text-catFail' : 'text-ink')}>
              {latestLabel}
              {hasUpdate && ` · ${t('settings.hasUpdate')}`}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-brd bg-card px-3 py-2.5">
            <span className="text-[13px] text-t2">{t('settings.runtimeEnv')}</span>
            <span className="text-[13px] text-t3">{isNative ? t('settings.envNative') : t('settings.envPwa')}</span>
          </div>
        </div>

        <div className="mt-3">
          <button
            type="button"
            disabled={state.status === 'checking'}
            onClick={() => void handleCheck()}
            className={cn(
              'h-[38px] w-full rounded-btn text-[12px] font-medium transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              state.status === 'checking'
                ? 'bg-brd text-t3'
                : 'border border-brd bg-card text-t2',
            )}
          >
            {state.status === 'checking' ? t('settings.checking') : t('settings.checkUpdate')}
          </button>
        </div>

        {state.status === 'error' && (
          <p className="mt-2 text-[11px] text-catFail">✗ {state.message}</p>
        )}
        {info && info.releaseNotes && (
          <div className="mt-3 max-h-[160px] overflow-y-auto rounded-card border border-brd bg-card p-3">
            <p className="mb-1 text-[11px] text-t3">{t('settings.releaseNotes')}</p>
            <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-t2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {info.releaseNotes}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {hasUpdate && (
          <div className="mt-3">
            <Button
              variant="primary"
              size="sm"
              className="h-[38px] w-full rounded-btn"
              disabled={installing || downloaded}
              onClick={() => void handleInstall()}
            >
              <Download size={14} strokeWidth={2} />
              {downloaded
                ? t('settings.downloadDoneWaiting')
                : installing
                  ? t('settings.downloading')
                  : isNative
                    ? t('settings.downloadAndInstall')
                    : t('settings.gotoGithubDownload')}
            </Button>

            {/* 下载进度条：仅 Android 原生 + 正在下载时显示。
                percent=-1（总大小未知）只显示已下载字节无百分比条；否则显示 X.X/Y.Y MB + 百分比条。 */}
            {isNative && installing && hasProgress && (
              <div className="mt-2 rounded-btn border border-brd bg-card p-3">
                {showProgressBar ? (
                  <>
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-t2">
                      <span>
                        {t('settings.downloadedMb', {
                          received: formatMB(progress!.received),
                          total: formatMB(progress!.total),
                        })}
                      </span>
                      <span className="font-medium text-pri">{progress!.percent}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-priS">
                      <div
                        className="h-full rounded-full bg-pri transition-[width] duration-base ease-out"
                        style={{ width: `${percentClamped}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-[11px] text-t2">
                    <span className="inline-block size-2 animate-pulse rounded-full bg-pri" />
                    <span>{t('settings.downloadingMb', { received: formatMB(progress!.received) })}</span>
                  </div>
                )}
              </div>
            )}

            {installErr && (
              <p className="mt-2 text-[11px] text-catFail">✗ {installErr}</p>
            )}
            {isNative && (
              <p className="mt-2 text-[11px] text-t3">
                {t('settings.installHint')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function VisionSection({
  settings,
  setSettings,
}: {
  settings: SettingsType
  setSettings: (patch: Partial<SettingsType>) => void
}) {
  const [frameInput, setFrameInput] = useState(String(settings.videoFrameIntervalSec))
  const t = useT()
  // hydrate 后 settings.videoFrameIntervalSec 才是真实值（mount 时还是 seed 默认）。
  // 同步防显错（10 vs 60）+ 防 onBlur 用 stale 值静默回退已存值。
  useEffect(() => setFrameInput(String(settings.videoFrameIntervalSec)), [settings.videoFrameIntervalSec])
  return (
    <Card className="mt-3">
      <p className="text-[14px] font-bold text-ink">{t('settings.visionTitle')}</p>
      <p className="mt-1 text-[11px] text-t3">{t('settings.visionHelp')}</p>

      <div className="mt-3 flex items-center justify-between">
        <div className="pr-3">
          <p className="text-[13px] font-medium text-ink">{t('settings.visionUnderstanding')}</p>
          <p className="mt-0.5 text-[11px] text-t3">
            {t('settings.visionHelpDetail')}
          </p>
        </div>
        <Toggle
          checked={settings.videoVisionEnabled}
          onChange={(v) => setSettings({ videoVisionEnabled: v })}
        />
      </div>

      <div className={cn('mt-3', !settings.videoVisionEnabled && 'opacity-40')}>
        <label className="text-[11px] text-t2">{t('settings.videoFrameIntervalLabel')}</label>
        <input
          type="number"
          min={1}
          max={60}
          value={frameInput}
          onChange={(e) => setFrameInput(e.target.value)}
          onBlur={() => {
            const n = Math.min(60, Math.max(1, parseInt(frameInput, 10) || 10))
            setFrameInput(String(n))
            setSettings({ videoFrameIntervalSec: n })
          }}
          disabled={!settings.videoVisionEnabled}
          className={inputCls}
        />
      </div>
    </Card>
  )
}

// 语言切换 sheet（仿 MemorySheet 的底部弹层 + KeySourceSheet 的二选一行）。
// 点击 → setSettings({ language })，store 内同步 setCurrentLang，所有 useT 订阅者即时重渲。
function LanguageSheet({ onClose }: { onClose: () => void }) {
  const setSettings = useUiStore((s) => s.setSettings)
  const lang = useUiStore((s) => s.settings.language) ?? 'zh'
  const t = useT()
  const options: { value: 'zh' | 'en'; label: string }[] = [
    { value: 'zh', label: t('settings.language.zh') },
    { value: 'en', label: t('settings.language.en') },
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.language')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {options.map((o) => {
            const active = o.value === lang
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  setSettings({ language: o.value })
                  onClose()
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-btn border px-4 py-3 text-left text-[13px] transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                  active ? 'border-pri bg-priS text-pri' : 'border-brd bg-card text-ink',
                )}
              >
                <span>{o.label}</span>
                {active && <Check size={16} strokeWidth={2} className="text-pri" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const settings = useUiStore((s) => s.settings)
  const setSettings = useUiStore((s) => s.setSettings)
  const t = useT()
  const theme = settings.theme
  const recordLocation = settings.recordLocation
  const entries = useUiStore((s) => s.entries)
  const hasEntries = entries.length > 0
  const memories = useUiStore((s) => s.memories)
  const enabledMemoryCount = memories.filter((m) => m.enabled).length
  const [editing, setEditing] = useState(false)
  const [editingStt, setEditingStt] = useState(false)
  const [editingVlm, setEditingVlm] = useState(false)
  const [editingAbout, setEditingAbout] = useState(false)
  const [editingGeo, setEditingGeo] = useState(false)
  const [editingMemory, setEditingMemory] = useState(false)
  const [editingLanguage, setEditingLanguage] = useState(false)
  // D9: 导入示例数据状态。导入后 rehydrate 刷新 store；错误显红字提示。
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [importOk, setImportOk] = useState(false)

  // D10: .zip 导出确认 + 反馈状态。
  const [zipConfirm, setZipConfirm] = useState(false)
  const [zipExporting, setZipExporting] = useState(false)
  const [zipToast, setZipToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // D15: Markdown 导出反馈状态（镜像 zip：导出中 + toast）。
  const [mdExporting, setMdExporting] = useState(false)
  const [mdToast, setMdToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const zipMediaCount = entries.reduce((sum, e) => sum + countMedia(e.parts), 0)

  async function handleZipExport() {
    setZipConfirm(false)
    setZipExporting(true)
    try {
      const result = await exportZip()
      // 用户取消（method=none, ok=false, error='CANCELLED'）——静默，不弹 toast。
      if (!result.ok && result.method === 'none' && result.error === 'CANCELLED') {
        return
      }
      setZipToast({ msg: formatSaveFeedback(result), ok: result.ok })
    } catch (e) {
      setZipToast({ msg: t('settings.exportFailedWith', { error: e instanceof Error ? e.message : String(e) }), ok: false })
    } finally {
      setZipExporting(false)
    }
  }

  // D15: Markdown 导出——走 saveBlob 平台分流，复用 zip 同款 toast 反馈。
  async function handleMarkdownExport() {
    setMdExporting(true)
    try {
      const result = await downloadMarkdown(buildExportMarkdown())
      if (!result.ok && result.method === 'none' && result.error === 'CANCELLED') {
        return
      }
      setMdToast({ msg: formatSaveFeedback(result), ok: result.ok })
    } catch (e) {
      setMdToast({ msg: t('settings.exportFailedWith', { error: e instanceof Error ? e.message : String(e) }), ok: false })
    } finally {
      setMdExporting(false)
    }
  }

  async function handleImportSample() {
    setImporting(true)
    setImportMsg(null)
    try {
      await importSampleData()
      await useUiStore.getState().rehydrate()
      setImportOk(true)
      setImportMsg(t('settings.sampleImported'))
    } catch (e) {
      setImportOk(false)
      setImportMsg(e instanceof Error ? e.message : t('settings.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="px-4 pb-4 pt-4">
      <h1 className="text-[24px] font-bold text-ink">{t('settings.title')}</h1>

      {/* 账号 */}
      <AccountSection />

      {/* 外观 */}
      <Card className="mt-4">
        <p className="text-[14px] font-bold text-ink">{t('settings.appearance')}</p>
        <p className="mt-1 text-[11px] text-t3">{t('settings.themeHelp')}</p>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-[14px] border border-brd/60 bg-page p-1 shadow-inner">
          {THEMES.map((th) => {
            const active = th === theme
            return (
              <button
                key={th}
                type="button"
                onClick={() => setSettings({ theme: th })}
                className={cn(
                  'h-10 cursor-pointer rounded-[10px] text-[12px] transition-all duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                  active
                    ? 'bg-card font-semibold text-ink shadow-sm'
                    : 'font-medium text-t3 hover:text-t2 active:scale-95',
                )}
              >
                {themeLabel(th)}
              </button>
            )
          })}
        </div>
      </Card>

      {/* 语言 */}
      <div className="mt-3">
        <ChevronRow
          label={t('settings.language')}
          value={settings.language === 'en' ? t('settings.language.en') : t('settings.language.zh')}
          onClick={() => setEditingLanguage(true)}
        />
      </div>

      {/* 记录地点 */}
      <div className="mt-3 flex items-center justify-between rounded-card border border-brd/80 bg-card p-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-priS text-pri">
            <MapPin size={15} strokeWidth={2.2} />
          </span>
          <div>
            <p className="text-[14px] font-medium text-ink">{t('settings.recordLocation')}</p>
            <p className="mt-0.5 text-[11px] text-t3">
              {t('settings.recordLocationHelp')}
            </p>
          </div>
        </div>
        <Toggle checked={recordLocation} onChange={(v) => setSettings({ recordLocation: v })} />
      </div>
      {/* D24: 地点编码 Key——高德 BYOK。未自配时：network 账号由服务端内置 Key 反查（随账号）；
          用户自配 Key 优先。 */}
      <div className="mt-2">
        <ChevronRow
          label={t('settings.geocodingKey')}
          value={settings.geocodingKeyRef ? t('settings.geocodingValueConfigured') : t('settings.geocodingValueBuiltin')}
          onClick={() => setEditingGeo(true)}
        />
      </div>

      {/* AI 模型 */}
      <Card className="mt-3">
        <p className="text-[14px] font-bold text-ink">{t('settings.aiModels')}</p>
        <p className="mt-1 text-[11px] text-t3">
          {t('settings.aiModelsHelp')}
        </p>
        <div className="mt-3">
          <ModelRow
            label={t('settings.llmModelTitle')}
            value={settings.llmModel || settings.llmProvider}
            hasKey={settings.apiKeyRef === 'llm:key'}
            onClick={() => setEditing(true)}
          />
          <div className="my-3 h-px bg-brd" />
          <ModelRow
            label={t('settings.sttModelTitle')}
            value={settings.sttModel || settings.sttProvider}
            hasKey={settings.sttKeyRef === 'stt:key'}
            onClick={() => setEditingStt(true)}
          />
          <div className="my-3 h-px bg-brd" />
          <ModelRow
            label={t('settings.vlmModelTitle')}
            value={settings.vlmModel || settings.vlmProvider}
            hasKey={settings.vlmKeyRef === 'vlm:key'}
            onClick={() => setEditingVlm(true)}
          />
        </div>
        <p className="mt-3 text-[11px] text-t3">
          {t('settings.vlmFallbackHelp')}
        </p>
      </Card>

      {/* 视觉 */}
      <VisionSection settings={settings} setSettings={setSettings} />

      {/* AI 记忆（2026-07-22）：用户明确记忆/偏好，classify 与 answerChat 注入 prompt */}
      <div className="mt-3">
        <ChevronRow
          label={t('settings.memoryTitle')}
          value={enabledMemoryCount > 0 ? t('settings.memoryActiveCount', { count: enabledMemoryCount }) : t('settings.memoryNotSet')}
          icon={<Brain size={15} strokeWidth={2.2} />}
          onClick={() => setEditingMemory(true)}
        />
      </div>

      {/* 导出与分享 */}
      <Card className="mt-3">
        <p className="text-[14px] font-bold text-ink">{t('settings.exportShare')}</p>
        {!hasEntries && (
          <p className="mt-2 text-[11px] text-t3">{t('settings.noEntriesToExport')}</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            disabled={!hasEntries || mdExporting}
            onClick={() => void handleMarkdownExport()}
          >
            {mdExporting ? t('settings.exporting') : t('settings.exportMarkdown')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            disabled={!hasEntries || zipExporting}
            onClick={() => setZipConfirm(true)}
          >
            {zipExporting ? t('settings.exporting') : t('settings.exportZip')}
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-t3">{t('common.share')}</p>
        <div className="mt-2">
          <Button
            size="sm"
            className="h-[38px] w-full rounded-btn"
            disabled={!hasEntries || !canShare}
            onClick={() => void handleShare()}
          >
            {t('common.share')}
          </Button>
        </div>

        {/* D9: 示例数据导入——空库时可主动导入 12 条原型记录了解 App。 */}
        <div className="mt-4 border-t border-brd pt-3">
          <p className="text-[11px] text-t3">{t('settings.sampleData')}</p>
          <p className="mt-0.5 text-[11px] text-t3">{t('settings.sampleDataHelp')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 h-[38px] w-full rounded-btn"
            disabled={importing}
            onClick={() => void handleImportSample()}
          >
            {importing ? t('settings.importing') : t('settings.importSample')}
          </Button>
          {importMsg && (
            <p className={cn('mt-2 text-[11px]', importOk ? 'text-catProject' : 'text-catFail')}>
              {importOk ? '✓ ' : '✗ '}{importMsg}
            </p>
          )}
        </div>
      </Card>

      {/* 使用反馈 */}
      <div className="mt-3">
        <FeedbackRow />
      </div>

      {/* 关于 */}
      <div className="mt-3">
        <ChevronRow
          label={t('settings.aboutTitle')}
          value={`v${__APP_VERSION__}`}
          icon={<Info size={15} strokeWidth={2.2} />}
          onClick={() => setEditingAbout(true)}
        />
      </div>

      {editing && <ByokSheet onClose={() => setEditing(false)} />}
      {editingStt && <SttSheet onClose={() => setEditingStt(false)} />}
      {editingVlm && <VlmSheet onClose={() => setEditingVlm(false)} />}
      {editingAbout && <AboutSheet onClose={() => setEditingAbout(false)} />}
      {editingGeo && <GeocodingSheet onClose={() => setEditingGeo(false)} />}
      {editingMemory && <MemorySheet onClose={() => setEditingMemory(false)} />}
      {editingLanguage && <LanguageSheet onClose={() => setEditingLanguage(false)} />}
      {zipConfirm && (
        <ExportConfirmSheet
          scopeLabel={t('settings.scopeAll')}
          filename="aiji-export.zip"
          entryCount={entries.length}
          mediaCount={zipMediaCount}
          onClose={() => setZipConfirm(false)}
          onConfirm={() => void handleZipExport()}
        />
      )}
      {zipToast && (
        <Toast
          message={zipToast.msg}
          ok={zipToast.ok}
          onDismiss={() => setZipToast(null)}
        />
      )}
      {mdToast && (
        <Toast
          message={mdToast.msg}
          ok={mdToast.ok}
          onDismiss={() => setMdToast(null)}
        />
      )}
    </div>
  )
}
