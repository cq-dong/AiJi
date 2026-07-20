import { useState } from 'react'
import { Button, Sheet } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'
import { useQuotaStore } from '@/app/quotaStore'
import { PLAN_TIERS } from '@/domain/plan'

// 权益方案 sheet：列三档（free/monthly/yearly），付费档显「升级到{name}」按钮。
// Sheet 原语无 open prop → 内部 if (!open) return null。hooks 必须在 early-return 之前，
// 故 onUpgrade 作为闭包内函数定义在 return 之后调用即可（这里先声明再判断）。
export function PlansSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const upgradePlan = useAccountStore((s) => s.upgradePlan)
  const refreshQuota = useQuotaStore((s) => s.refresh)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  async function onUpgrade(id: string) {
    setBusy(true)
    try {
      await upgradePlan(id)
      await refreshQuota()
      setToast('升级成功（演示）')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '升级失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="权益方案" onClose={onClose}>
      <div className="space-y-3 py-2">
        {PLAN_TIERS.map((p) => (
          <div key={p.id} className="rounded-card border border-brd p-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium text-ink">{p.name}</span>
              <span className="text-[13px] text-t2">
                {p.price === 0
                  ? '免费'
                  : `¥${(p.price / 100).toFixed(0)}/${p.period === 'monthly' ? '月' : '年'}`}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-[12px] text-t3">
              {p.features.map((f) => (
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
                升级到{p.name}
              </Button>
            )}
          </div>
        ))}
        {toast && <p className="text-center text-[12px] text-pri">{toast}</p>}
      </div>
    </Sheet>
  )
}
