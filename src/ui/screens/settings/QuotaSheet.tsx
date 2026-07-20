import { Sheet } from '@/ui/components'
import { useQuotaStore } from '@/app/quotaStore'

// 额度详情 sheet：网络账号 + keySource=builtin 时展示今日 LLM/STT/聚合用量 + 重置时间。
// quota===null（未加载）→ 显加载中。Sheet 原语无 open prop，调用方条件渲染，故内部 `if (!open) return null`。
export function QuotaSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const quota = useQuotaStore((s) => s.quota)
  if (!open) return null
  return (
    <Sheet title="额度详情" onClose={onClose}>
      {!quota ? (
        <div className="py-4 text-[13px] text-t3">加载中…</div>
      ) : (
        <div className="space-y-3 py-2 text-[13px]">
          <Row
            label="LLM 今日"
            value={`${quota.llmUsed} / ${quota.llmLimit < 0 ? '∞' : quota.llmLimit} 次`}
          />
          <Row
            label="STT 今日"
            value={`${quota.sttUsedSec} / ${quota.sttLimitSec < 0 ? '∞' : quota.sttLimitSec} 秒`}
          />
          <Row
            label="聚合今日"
            value={`${quota.aggUsed} / ${quota.aggLimit < 0 ? '∞' : quota.aggLimit} 次`}
          />
          <Row label="重置时间" value={new Date(quota.resetAt).toLocaleString()} />
        </div>
      )}
    </Sheet>
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
