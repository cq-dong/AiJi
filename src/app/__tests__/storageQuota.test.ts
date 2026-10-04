// Q6 ③（2026-10-05）：OPFS 配额监控编排。navigator.storage.estimate 三态——
// 正常 → store.storageQuota={usage,quota}；API 不存在 / reject → null（home 不出横幅）；
// usage/quota 字段 undefined → ?? 0 兜底。契约：docs/acceptance/q6-capture-compression.md §③。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// store import 需要 di 空壳；refreshStorageQuota 只读写 useUiStore，不触 di。
vi.mock('@/app/di', () => ({ di: {} }))

import { useUiStore } from '@/app/store'
import { refreshStorageQuota } from '@/app/storageQuota'

// jsdom 无 StorageManager——defineProperty 挂/卸 navigator.storage（configurable 才能 delete 复原）。
function stubStorage(value: unknown): void {
  Object.defineProperty(window.navigator, 'storage', {
    value,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  // 预置非 null：每例都观测「被改写为目标态」，而非恰好停在初始值。
  useUiStore.setState({ storageQuota: { usage: 1, quota: 1 } })
})

afterEach(() => {
  delete (window.navigator as unknown as Record<string, unknown>).storage
  useUiStore.setState({ storageQuota: null })
})

describe('refreshStorageQuota', () => {
  it('estimate 正常返回 → 写入 {usage, quota}', async () => {
    stubStorage({ estimate: () => Promise.resolve({ usage: 5_000, quota: 10_000 }) })
    await refreshStorageQuota()
    expect(useUiStore.getState().storageQuota).toEqual({ usage: 5_000, quota: 10_000 })
  })

  it('navigator.storage 不存在（API 不可用）→ 置 null', async () => {
    stubStorage(undefined)
    await refreshStorageQuota()
    expect(useUiStore.getState().storageQuota).toBeNull()
  })

  it('storage 存在但无 estimate 方法 → 置 null', async () => {
    stubStorage({})
    await refreshStorageQuota()
    expect(useUiStore.getState().storageQuota).toBeNull()
  })

  it('estimate reject → 置 null（静默降级，不抛出）', async () => {
    stubStorage({ estimate: () => Promise.reject(new Error('denied')) })
    await refreshStorageQuota()
    expect(useUiStore.getState().storageQuota).toBeNull()
  })

  it('usage/quota 字段 undefined → ?? 0 兜底', async () => {
    stubStorage({ estimate: () => Promise.resolve({}) })
    await refreshStorageQuota()
    expect(useUiStore.getState().storageQuota).toEqual({ usage: 0, quota: 0 })
  })
})
