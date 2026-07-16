import { useState } from 'react'
import { Button, Card, cn } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { Toggle } from './Toggle'

type Theme = 'light' | 'dark' | 'system'

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
  onClick,
}: {
  label: string
  value: string
  onClick?: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between text-left">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-[11px] text-t3">{value}</span>
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

export default function Settings() {
  const settings = useUiStore((s) => s.settings)
  const setSettings = useUiStore((s) => s.setSettings)
  const theme = settings.theme
  const recordLocation = settings.recordLocation
  const [editing, setEditing] = useState(false)

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
        <ChevronRow label="提醒与待办" value="查看与确认" />
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
            onClick={() => setEditing(true)}
          />
          <div className="my-3 h-px bg-brd" />
          <ModelRow label="音频转写模型" value={settings.sttProvider} />
        </div>
      </Card>

      {/* 导出与分享 */}
      <Card className="mt-3">
        <p className="text-[14px] font-bold text-ink">导出与分享</p>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" size="sm" className="h-[38px] flex-1 rounded-btn">
            导出 Markdown
          </Button>
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn">
            导出 .zip
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-t3">分享至</p>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            className="h-[30px] w-[76px] rounded-[15px] border-transparent bg-[#12ac50] text-white"
          >
            微信
          </Button>
          <Button
            size="sm"
            className="h-[30px] w-[76px] rounded-[15px] border-transparent bg-[#1f7ccc] text-white"
          >
            QQ
          </Button>
        </div>
      </Card>

      {/* 关于 */}
      <div className="mt-3">
        <ChevronRow label="关于 AiJi" value="v0.1" />
      </div>

      {editing && <ByokSheet onClose={() => setEditing(false)} />}
    </div>
  )
}
