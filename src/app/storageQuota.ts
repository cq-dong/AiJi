// Q6 ③（2026-10-05）：OPFS 配额监控编排。navigator.storage.estimate() 快照写入
// store.storageQuota——home 屏据此在 usage/quota ≥ 80% 时出警示横幅
//（契约：docs/acceptance/q6-capture-compression.md §③）。
// API 不可用（老 Safari 等）或抛错/reject → null（静默降级，不出横幅）。
// 由 home mount effect 触发（fire-and-forget，与 weeklyReview 同模式）；
// hydrate 不调——hydrate 是存储关键路径，配额查询只是 UI 增强，不该拖住载入。
import { useUiStore } from '@/app/store'

export async function refreshStorageQuota(): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est) {
      useUiStore.setState({ storageQuota: null })
      return
    }
    useUiStore.setState({ storageQuota: { usage: est.usage ?? 0, quota: est.quota ?? 0 } })
  } catch {
    useUiStore.setState({ storageQuota: null })
  }
}
