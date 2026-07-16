import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, cn } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { exportZip } from '@/adapters/zipExport'
import { Toggle } from './Toggle'

type Theme = 'light' | 'dark' | 'system'

// 导出 Markdown：读 store 快照拼一份 Markdown，触发浏览器下载。
// 只读现成字段（entries / aiByEntry / categories / tags），不调 di.storage。
function buildExportMarkdown(): string {
  const { entries, aiByEntry, categories, tags } = useUiStore.getState()
  const catLabel = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? slug
  const tagLabel = (slug: string) => tags.find((t) => t.slug === slug)?.label ?? slug
  const sorted = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const lines: string[] = []
  lines.push('# AiJi 导出')
  lines.push('')
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN')} · 共 ${entries.length} 条`)
  lines.push('')
  for (const e of sorted) {
    const ai = aiByEntry[e.id]
    const firstText = e.parts.find((p) => p.type === 'text')?.content
    const firstTranscript = e.parts.find((p) => p.type !== 'text')?.transcript
    const fallbackTitle = (firstText ?? firstTranscript ?? '').slice(0, 16)
    const title = ai?.titleSuggestion || fallbackTitle || '（无标题）'
    lines.push(`## ${title}`)
    lines.push('')
    lines.push(`_${e.createdAt}_`)
    lines.push('')
    const bodyLines: string[] = []
    for (const p of e.parts) {
      if (p.type === 'text') bodyLines.push(p.content)
      else if (p.transcript) bodyLines.push(p.transcript)
    }
    lines.push(bodyLines.join('\n\n') || '（无正文）')
    lines.push('')
    if (ai) {
      const bits: string[] = []
      if (ai.category) bits.push(`类别：${catLabel(ai.category)}`)
      if (ai.tags.length) bits.push(`标签：${ai.tags.map(tagLabel).join('、')}`)
      if (ai.summary) bits.push(`摘要：${ai.summary}`)
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

function downloadMarkdown(md: string): void {
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'aiji-export.md'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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
      await navigator.share({ title: 'AiJi 导出', text: md })
      return
    }
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(md)
      alert('已复制到剪贴板')
    }
  } catch (err) {
    // 用户取消分享面板，静默处理。
    if (err instanceof DOMException && err.name === 'AbortError') return
    console.error('AiJi 分享失败：', err)
  }
}

// 待提醒列表用 — dueAt 格式化为本地时间 M/D HH:MM（简洁，如 7/17 15:00）。
function formatDueAt(iso: string): string {
  const d = new Date(iso)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}

const STATUS_LABELS = {
  pending: '待提醒',
  fired: '已提醒',
  snoozed: '已稍后',
  missed: '已错过',
} as const

const THEMES: { key: Theme; label: string }[] = [
  { key: 'light', label: '亮色' },
  { key: 'dark', label: '暗色' },
  { key: 'system', label: '跟随系统' },
]

function ChevronRight() {
  return <span className="text-[18px] leading-none text-t2">›</span>
}

function ChevronRow({
  label,
  value,
  onClick,
}: {
  label: string
  value?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-card border border-brd bg-card p-4 text-left"
    >
      <span className="text-[14px] font-medium text-ink">{label}</span>
      <span className="flex items-center gap-2">
        {value && <span className="text-[11px] text-t3">{value}</span>}
        <ChevronRight />
      </span>
    </button>
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
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between text-left">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      <span className="flex items-center gap-2">
        <span className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', hasKey ? 'bg-emerald-500' : 'bg-t3')} />
          <span className="text-[11px] text-t3">{hasKey ? '已配置' : '未配置'}</span>
        </span>
        <span className="max-w-[120px] truncate text-[11px] text-t3">{value}</span>
        <ChevronRight />
      </span>
    </button>
  )
}

function ByokSheet({ onClose }: { onClose: () => void }) {
  const settings = useUiStore((s) => s.settings)
  const setLlmConfig = useUiStore((s) => s.setLlmConfig)
  const [url, setUrl] = useState(settings.llmUrl ?? '')
  const [model, setModel] = useState(settings.llmModel ?? '')
  const [key, setKey] = useState('')
  const hasKey = settings.apiKeyRef === 'llm:key'
  const inputCls =
    'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">文本 / 分类模型</p>
          <button type="button" onClick={onClose} className="text-[16px] text-t3">
            ✕
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">BYOK · URL + 模型 + Key 本地存，不进源码</p>

        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[11px] text-t2">API URL（OpenAI 兼容 chat）</label>
            <input
              className={inputCls}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/compatible-mode/v1/chat/completions"
            />
          </div>
          <div>
            <label className="text-[11px] text-t2">模型</label>
            <input
              className={inputCls}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-v4-flash"
            />
          </div>
          <div>
            <label className="text-[11px] text-t2">
              API Key{hasKey ? '（已设置，留空不变）' : ''}
            </label>
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? '••••••（留空保持不变）' : 'sk-…'}
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={() => {
              setLlmConfig(url.trim(), model.trim() || 'deepseek-v4-flash', key)
              onClose()
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

function SttSheet({ onClose }: { onClose: () => void }) {
  const settings = useUiStore((s) => s.settings)
  const setSttConfig = useUiStore((s) => s.setSttConfig)
  const [model, setModel] = useState(settings.sttModel ?? '')
  const [key, setKey] = useState('')
  const hasKey = settings.sttKeyRef === 'stt:key'
  const inputCls =
    'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">音频转写模型</p>
          <button type="button" onClick={onClose} className="text-[16px] text-t3">
            ✕
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">BYOK · 阿里云 DashScope paraformer（WS 流式）· Key 本地存</p>

        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[11px] text-t2">模型</label>
            <input
              className={inputCls}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="paraformer-realtime-v2"
            />
          </div>
          <div>
            <label className="text-[11px] text-t2">
              API Key{hasKey ? '（已设置，留空不变）' : ''}
            </label>
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? '••••••（留空保持不变）' : 'sk-…'}
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={() => {
              setSttConfig(model.trim() || 'paraformer-realtime-v2', key)
              onClose()
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

function SectionEmpty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-card border border-dashed border-brd py-3">
      <p className="text-[12px] text-t3">{text}</p>
    </div>
  )
}

function RemindersSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const reminders = useUiStore((s) => s.reminders)
  // snoozed 在运行期仍由调度器当 pending 处理（store 注释：status stays 'pending'），
  // 这里把 snoozed 归入"待提醒"段，避免它在 UI 里无处安放。
  const pending = reminders
    .filter((r) => r.status === 'pending' || r.status === 'snoozed')
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1))
  const fired = reminders
    .filter((r) => r.status === 'fired')
    .sort((a, b) => (a.dueAt < b.dueAt ? 1 : -1))
  const missed = reminders
    .filter((r) => r.status === 'missed')
    .sort((a, b) => (a.dueAt < b.dueAt ? 1 : -1))

  const goEntry = (entryId: string) => {
    onClose()
    navigate(`/detail/${entryId}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-[420px] flex-col rounded-screen bg-page p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">提醒与待办</p>
          <button type="button" onClick={onClose} className="text-[16px] text-t3">
            ✕
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">查看与管理提醒事项 · 共 {reminders.length} 条</p>

        <div className="mt-3 flex-1 space-y-4 overflow-y-auto pb-2">
          {/* 待提醒 */}
          <section>
            <div className="flex items-center justify-between px-1">
              <p className="text-[12px] font-semibold text-t2">待提醒</p>
              {pending.length > 0 && <span className="text-[11px] text-t3">{pending.length}</span>}
            </div>
            <div className="mt-2 space-y-2">
              {pending.length === 0 ? (
                <SectionEmpty text="暂无待提醒事项" />
              ) : (
                pending.map((r) => (
                  <div key={r.id} className="rounded-card border border-brd bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium text-ink">{formatDueAt(r.dueAt)}</span>
                      <span className="rounded-chip bg-priS px-2 py-0.5 text-[10px] font-medium text-pri">
                        {STATUS_LABELS[r.status]}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => goEntry(r.entryId)}
                      className="mt-1 block w-full text-left"
                    >
                      <p className="truncate text-[13px] text-ink underline decoration-t3 underline-offset-2 active:text-pri">
                        {r.label}
                      </p>
                    </button>
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-[34px] flex-1 rounded-btn"
                        onClick={() => void useUiStore.getState().snoozeReminder(r.id, 10)}
                      >
                        稍后提醒
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-[34px] flex-1 rounded-btn"
                        onClick={() => void useUiStore.getState().dismissReminder(r.id)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 已提醒 */}
          <section>
            <div className="flex items-center justify-between px-1">
              <p className="text-[12px] font-semibold text-t2">已提醒</p>
              {fired.length > 0 && <span className="text-[11px] text-t3">{fired.length}</span>}
            </div>
            <div className="mt-2 space-y-2">
              {fired.length === 0 ? (
                <SectionEmpty text="暂无已提醒记录" />
              ) : (
                fired.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => goEntry(r.entryId)}
                    className="flex w-full items-center justify-between rounded-card border border-brd bg-card p-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-[12px] font-medium text-t2">{formatDueAt(r.dueAt)}</span>
                      <p className="mt-0.5 truncate text-[13px] text-ink">{r.label}</p>
                    </div>
                    <span className="flex items-center gap-2">
                      <span className="rounded-chip bg-priS px-2 py-0.5 text-[10px] font-medium text-t2">
                        {STATUS_LABELS[r.status]}
                      </span>
                      <ChevronRight />
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* 已错过 */}
          <section>
            <div className="flex items-center justify-between px-1">
              <p className="text-[12px] font-semibold text-t2">已错过</p>
              {missed.length > 0 && <span className="text-[11px] text-t3">{missed.length}</span>}
            </div>
            <div className="mt-2 space-y-2">
              {missed.length === 0 ? (
                <SectionEmpty text="暂无错过记录" />
              ) : (
                missed.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => goEntry(r.entryId)}
                    className="flex w-full items-center justify-between rounded-card border border-brd bg-card p-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-[12px] font-medium text-t2">{formatDueAt(r.dueAt)}</span>
                      <p className="mt-0.5 truncate text-[13px] text-ink">{r.label}</p>
                    </div>
                    <span className="flex items-center gap-2">
                      <span className="rounded-chip bg-priS px-2 py-0.5 text-[10px] font-medium text-catFail">
                        {STATUS_LABELS[r.status]}
                      </span>
                      <ChevronRight />
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const settings = useUiStore((s) => s.settings)
  const setSettings = useUiStore((s) => s.setSettings)
  const theme = settings.theme
  const recordLocation = settings.recordLocation
  const hasEntries = useUiStore((s) => s.entries.length > 0)
  const [editing, setEditing] = useState(false)
  const [editingStt, setEditingStt] = useState(false)
  const [viewingReminders, setViewingReminders] = useState(false)

  return (
    <div className="px-4 pb-4 pt-4">
      <h1 className="text-[24px] font-bold text-ink">设置</h1>

      {/* 外观 */}
      <Card className="mt-4">
        <p className="text-[14px] font-bold text-ink">外观</p>
        <p className="mt-1 text-[11px] text-t3">主题（亮/暗切换）</p>
        <div className="mt-3 flex gap-2">
          {THEMES.map((t) => {
            const active = t.key === theme
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSettings({ theme: t.key })}
                className={cn(
                  'h-8 flex-1 rounded-[16px] text-[12px] font-medium transition',
                  active ? 'bg-pri text-white' : 'border border-brd bg-card text-t2',
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </Card>

      {/* 记录地点 */}
      <div className="mt-3 flex items-center justify-between rounded-card border border-brd bg-card p-4">
        <div>
          <p className="text-[14px] font-medium text-ink">记录地点</p>
          <p className="mt-0.5 text-[11px] text-t3">
            默认关闭，开启后给条目加位置
          </p>
        </div>
        <Toggle checked={recordLocation} onChange={(v) => setSettings({ recordLocation: v })} />
      </div>

      {/* 提醒与待办 */}
      <div className="mt-3">
        <ChevronRow label="提醒与待办" value="查看与确认" onClick={() => setViewingReminders(true)} />
      </div>

      {/* AI 模型 */}
      <Card className="mt-3">
        <p className="text-[14px] font-bold text-ink">AI 模型</p>
        <p className="mt-1 text-[11px] text-t3">
          BYOK · 各模型独立配置 URL + Key
        </p>
        <div className="mt-3">
          <ModelRow
            label="文本 / 分类模型"
            value={settings.llmModel || settings.llmProvider}
            hasKey={settings.apiKeyRef === 'llm:key'}
            onClick={() => setEditing(true)}
          />
          <div className="my-3 h-px bg-brd" />
          <ModelRow
            label="音频转写模型"
            value={settings.sttModel || settings.sttProvider}
            hasKey={settings.sttKeyRef === 'stt:key'}
            onClick={() => setEditingStt(true)}
          />
        </div>
      </Card>

      {/* 导出与分享 */}
      <Card className="mt-3">
        <p className="text-[14px] font-bold text-ink">导出与分享</p>
        {!hasEntries && (
          <p className="mt-2 text-[11px] text-t3">暂无条目可导出</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            disabled={!hasEntries}
            onClick={() => downloadMarkdown(buildExportMarkdown())}
          >
            导出 Markdown
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            disabled={!hasEntries}
            onClick={() => void exportZip()}
          >
            导出 .zip
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-t3">分享</p>
        <div className="mt-2">
          <Button
            size="sm"
            className="h-[38px] w-full rounded-btn"
            disabled={!hasEntries || !canShare}
            onClick={() => void handleShare()}
          >
            分享
          </Button>
        </div>
      </Card>

      {/* 关于 */}
      <div className="mt-3">
        <ChevronRow label="关于 AiJi" value="v0.1" />
      </div>

      {editing && <ByokSheet onClose={() => setEditing(false)} />}
      {editingStt && <SttSheet onClose={() => setEditingStt(false)} />}
      {viewingReminders && <RemindersSheet onClose={() => setViewingReminders(false)} />}
    </div>
  )
}
