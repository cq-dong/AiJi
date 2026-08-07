// 云端同步 HTTP 适配器：/api/sync/* 的 fetch 封装。
// 401 → di.auth.refresh 单飞重试一次 → 再 401 抛 SessionExpiredError（与 builtinLlm.chatFetch 同型）。
import { SessionExpiredError, StorageFullError } from '@/ports'
import { di } from '@/app/di'
import { localSession } from '@/app/session'
import type { SyncChange } from '@/domain/sync'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

// 统一 authed fetch：附带 JWT；401 时 refresh 重试一次；再 401 抛 SessionExpiredError。
async function authedFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const session = localSession.get()
  if (!session) throw new SessionExpiredError()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.jwt}`, ...(init.headers ?? {}) },
  })
  if (res.status === 401 && retry) {
    let newSession
    try {
      newSession = await di.auth.refresh()
      localSession.set(newSession)
    } catch {
      localSession.clear()
      throw new SessionExpiredError()
    }
    return authedFetch(path, init, false)
  }
  if (res.status === 401 && !retry) {
    // refresh 后仍 401——session 彻底失效，按 spec 抛 SessionExpiredError（不让 checkOk 吞成 generic）。
    localSession.clear()
    throw new SessionExpiredError()
  }
  return res
}

async function checkOk(res: Response, ep: string): Promise<void> {
  if (res.ok) return
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  throw new Error(body?.message ?? `${ep} HTTP ${res.status}`)
}

export async function pushChanges(
  changes: SyncChange[],
): Promise<{ applied: number; rejected: { kind: string; id: string }[] }> {
  const res = await authedFetch('/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  })
  await checkOk(res, 'push')
  return (await res.json()) as { applied: number; rejected: { kind: string; id: string }[] }
}

export async function pullChanges(
  since: number,
  limit = 200,
): Promise<{ changes: SyncChange[]; cursor: number; hasMore: boolean }> {
  const res = await authedFetch(`/api/sync/pull?since=${since}&limit=${limit}`)
  await checkOk(res, 'pull')
  return (await res.json()) as { changes: SyncChange[]; cursor: number; hasMore: boolean }
}

// PUT raw blob。403 → StorageFullError（引擎据此置 storageFull，UI 提示升级）。
export async function uploadMedia(ref: string, blob: Blob): Promise<void> {
  const res = await authedFetch(`/api/sync/media/${encodeURIComponent(ref)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  if (res.status === 403) throw new StorageFullError()
  await checkOk(res, 'media upload')
}

export async function downloadMedia(ref: string): Promise<Blob> {
  const res = await authedFetch(`/api/sync/media/${encodeURIComponent(ref)}`)
  if (res.status === 404) throw new Error(`media 不存在: ${ref}`)
  await checkOk(res, 'media download')
  return res.blob()
}

export async function getSyncStatus(): Promise<{ usedBytes: number; limitBytes: number }> {
  const res = await authedFetch('/api/sync/status')
  await checkOk(res, 'status')
  return (await res.json()) as { usedBytes: number; limitBytes: number }
}
