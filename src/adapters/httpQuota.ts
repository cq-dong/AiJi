// HTTP QuotaPort 适配器：GET /api/quota。
import type { QuotaPort } from '@/ports'
import { NotNetworkError } from '@/ports'
import type { Quota } from '@/domain/quota'
import { localSession } from '@/app/session'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

export const httpQuota: QuotaPort = {
  async getQuota() {
    const session = localSession.get()
    let res: Response
    try {
      res = await fetch(`${BASE}/api/quota`, {
        headers: { Authorization: `Bearer ${session?.jwt ?? ''}` },
      })
    } catch {
      throw new NotNetworkError('网络不可用')
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`quota HTTP ${res.status}: ${t.slice(0, 120)}`)
    }
    return (await res.json()) as Quota
  },
}
