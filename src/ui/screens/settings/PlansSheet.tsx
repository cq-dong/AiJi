import { useState } from 'react'
import { Button, Sheet } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'
import { useQuotaStore } from '@/app/quotaStore'
import { useT } from '@/app/i18n/useT'
import { localizeError } from '@/app/i18n/errorText'
import { PLAN_TIERS } from '@/domain/plan'

// 权益方案 sheet：列三档（free/monthly/yearly），付费档显「升级到{name}」按钮。
// plan name/features 来自 domain/plan.ts（中文数据）→ 在视图层按 id 映射 t()，domain 保持纯 TS。
// Sheet 原语无 open prop → 内部 if (!open) return null。hooks 必须在 early-return 之前。
export function PlansSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const upgradePlan = useAccountStore((s) => s.upgradePlan)
  const refreshQuota = useQuotaStore((s) => s.refresh)
  const t = useT()
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  async function onUpgrade(id: string) {
    setBusy(true)
    try {
      await upgradePlan(id)
      await refreshQuota()
      setToast(t('settings.upgradeSuccessDemo'))
    } catch (e) {
      setToast(localizeError(e))
    } finally {
      setBusy(false)
    }
  }

  function planName(id: string): string {
    if (id === 'free') return t('settings.planFree')
    if (id === 'monthly') return t('settings.planMonthly')
    return t('settings.planYearly')
  }

  function planFeatures(id: string): string[] {
    if (id === 'free')
      return [
        t('settings.featFreeLlm'),
        t('settings.featFreeStt'),
        t('settings.featFreeKey'),
        t('settings.featFreeVision'),
      ]
    if (id === 'monthly')
      return [
        t('settings.featMonthlyLlm'),
        t('settings.featMonthlyStt'),
        t('settings.featMonthlyVision'),
      ]
    return [t('settings.featYearlyLlm'), t('settings.featYearlyStt'), t('settings.featYearlyAll')]
  }

  return (
    <Sheet title={t('settings.plans')} onClose={onClose}>
      <div className="space-y-3 py-2">
        {PLAN_TIERS.map((p) => (
          <div key={p.id} className="rounded-card border border-brd p-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium text-ink">{planName(p.id)}</span>
              <span className="text-[13px] text-t2">
                {p.price === 0
                  ? t('settings.free')
                  : `¥${(p.price / 100).toFixed(0)}/${p.period === 'monthly' ? t('settings.monthUnit') : t('settings.yearUnit')}`}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-[12px] text-t3">
              {planFeatures(p.id).map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
            {p.id !== 'free' && (
              <Button
                variant="primary"
                size="sm"
                className="mt-3 w-full"
                disabled={busy}
                onClick={() => void onUpgrade(p.id)}
              >
                {t('settings.upgradeTo', { name: planName(p.id) })}
              </Button>
            )}
          </div>
        ))}
        {toast && <p className="text-center text-[12px] text-pri">{toast}</p>}
      </div>
    </Sheet>
  )
}
