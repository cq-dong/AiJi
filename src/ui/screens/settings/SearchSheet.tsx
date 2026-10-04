import { useState } from 'react'
import { X } from 'lucide-react'
import { Button, useBackDismiss } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'

// 与 settings/index.tsx 的 inputCls 同款（抽出单文件便于独立测试，样式保持镜像）。
const inputCls =
  'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

// 网络搜索 sheet（2026-09-29 能力大补）：Tavily BYOK Key，问 AI 的搜索意图用。
// 结构镜像 GeocodingSheet——单 Key 字段；保存空串 = 清除（D8 语义同 GeocodingSheet）。
export function SearchSheet({ onClose }: { onClose: () => void }) {
  const settings = useUiStore((s) => s.settings)
  // 契约（Agent B 落地）：setSearchConfig(key)——空串清除 searchKeyRef。
  const setSearchConfig = useUiStore((s) => s.setSearchConfig)
  const t = useT()
  // D1 收尾波：硬件返回 = 收起本 sheet（组件随 open 挂载/卸载，栈内无残留 handler）。
  useBackDismiss(onClose)
  const [key, setKey] = useState('')
  const hasKey = settings.searchKeyRef === 'search:key'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">{t('settings.searchTitle')}</p>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-t3">{t('settings.searchHelp')}</p>

        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[11px] text-t2">
              {t('settings.searchKeyLabel')}{hasKey ? t('settings.apiKeySetHint') : ''}
            </label>
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? t('settings.apiKeyKeepPlaceholder') : t('settings.searchKeyPlaceholder')}
            />
            <p className="mt-1 text-[11px] text-t3">{t('settings.searchKeyHelp')}</p>
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
              void setSearchConfig(key.trim())
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
