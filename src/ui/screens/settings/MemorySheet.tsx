// AI 记忆 sheet（2026-07-22；2026-10-03 抽出单文件便于独立测试，样式保持镜像）。
// P-C 记忆生命周期（spec 2026-10-03 §4 UI）：列表分两组——正常组（content + 启停开关 +
// 删除）+「已归档」折叠组置底。归档条目只显示「恢复」按钮（清 archivedAt + 刷
// lastConfirmedAt，恢复即回到 enabled），不再显示停用/启用开关。
import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { Button, cn, useBackDismiss } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import { Toggle } from './Toggle'

// 与 settings/index.tsx 的 inputCls 同款（抽出单文件便于独立测试，样式保持镜像）。
const inputCls =
  'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

export function MemorySheet({ onClose }: { onClose: () => void }) {
  const memories = useUiStore((s) => s.memories)
  const autoMemory = useUiStore((s) => s.settings.autoMemory)
  const setSettings = useUiStore((s) => s.setSettings)
  const saveMemory = useUiStore((s) => s.saveMemory)
  const deleteMemory = useUiStore((s) => s.deleteMemory)
  const toggleMemory = useUiStore((s) => s.toggleMemory)
  const restoreMemory = useUiStore((s) => s.restoreMemory)
  const t = useT()
  // D1 收尾波：硬件返回 = 收起本 sheet（组件随 open 挂载/卸载，栈内无残留 handler）。
  useBackDismiss(onClose)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  // P-C：archivedAt 非空的行进归档组（折叠置底）；正常组不含归档行。
  const active = memories.filter((m) => !m.archivedAt)
  const archived = memories.filter((m) => m.archivedAt)

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

        {/* 自动记忆开关（2026-09-10 陪伴化）：开=每轮聊天自动提取值得长期记住的信息；
            关=只剩显式「记住 X」意图与手动添加。undefined 视同开。 */}
        <div className="mt-2 flex items-center justify-between gap-2 rounded-card border border-brd/80 bg-card px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-snug text-ink">{t('settings.memoryAuto')}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-t3">{t('settings.memoryAutoHint')}</p>
          </div>
          <Toggle checked={autoMemory !== false} onChange={(v) => setSettings({ autoMemory: v })} />
        </div>

        <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto">
          {active.length === 0 && archived.length === 0 && (
            <div className="rounded-card border border-brd/80 bg-card px-3 py-4 text-center text-[12px] text-t3">
              {t('settings.memoryEmpty')}
            </div>
          )}
          {active.map((m) => (
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

          {/* P-C 已归档折叠组（spec §4）：90 天未确认自动归档的记忆，不参与 prompt 注入；
              条目只给「恢复」（清 archivedAt + 刷 lastConfirmedAt），无启停开关。 */}
          {archived.length > 0 && (
            <div className="rounded-card border border-brd/80 bg-card">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[12px] font-medium text-t2 transition duration-base ease-out cursor-pointer active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {showArchived ? <ChevronDown size={14} strokeWidth={2.2} /> : <ChevronRight size={14} strokeWidth={2.2} />}
                {t('settings.memoryArchived', { count: archived.length })}
              </button>
              {showArchived && (
                <div className="space-y-2 px-3 pb-3">
                  <p className="text-[11px] leading-snug text-t3">{t('settings.memoryArchivedHint')}</p>
                  {archived.map((m) => (
                    <div key={m.id} className="flex items-start gap-2 rounded-card border border-brd/60 bg-page p-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-[13px] leading-relaxed text-t3">{m.content}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={t('settings.memoryRestore')}
                        onClick={() => void restoreMemory(m.id)}
                        className="shrink-0 rounded-btn px-2 py-1 text-[12px] font-medium text-pri transition duration-base ease-out cursor-pointer hover:bg-priS active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                      >
                        {t('settings.memoryRestore')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
