import { AnimatePresence } from 'framer-motion'
import { Sheet } from '@/ui/components'
import { useQuotaStore } from '@/app/quotaStore'
import { useT } from '@/app/i18n/useT'

// 额度详情 sheet：网络账号 + keySource=builtin 时展示今日 LLM/STT/聚合用量 + 重置时间。
// quota===null（未加载）→ 显加载中。
// AnimatePresence 常驻 + open 条件渲染 → Sheet 退出动画（下滑淡出）完成后才卸载。
export function QuotaSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const quota = useQuotaStore((s) => s.quota)
  const t = useT()
  const times = t('settings.unitTimes')
  const secs = t('settings.unitSeconds')
  return (
    <AnimatePresence>
      {open && (
        <Sheet title={t('settings.quotaDetails')} onClose={onClose}>
          {!quota ? (
            <div className="py-4 text-[13px] text-t3">{t('common.loading')}</div>
          ) : (
            <div className="space-y-3 py-2 text-[13px]">
              <Row
                label={t('settings.quotaLlmToday')}
                value={`${quota.llmUsed} / ${quota.llmLimit < 0 ? '∞' : quota.llmLimit} ${times}`}
              />
              <Row
                label={t('settings.quotaSttToday')}
                value={`${quota.sttUsedSec} / ${quota.sttLimitSec < 0 ? '∞' : quota.sttLimitSec} ${secs}`}
              />
              <Row
                label={t('settings.quotaAggToday')}
                value={`${quota.aggUsed} / ${quota.aggLimit < 0 ? '∞' : quota.aggLimit} ${times}`}
              />
              <Row label={t('settings.quotaReset')} value={new Date(quota.resetAt).toLocaleString()} />
            </div>
          )}
        </Sheet>
      )}
    </AnimatePresence>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-t3">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  )
}
