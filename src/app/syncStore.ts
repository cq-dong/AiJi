// 同步状态（UI 只读）：引擎写入，设置页云端同步区消费。
// 纯状态容器，无业务逻辑——引擎通过 set/get 改写，UI 通过 useSyncStore 订阅。
import { create } from 'zustand'

interface SyncUiState {
  running: boolean // 引擎已启动
  syncing: boolean // 一轮 flush/pull 进行中
  phase: 'idle' | 'push' | 'pull' // 当前轮进行到哪步（同步中才有意义）
  lastSyncAt: string | null
  pendingCount: number // outbox 待推条数
  migrating: boolean
  migrationTotal: number
  migrationRemaining: number
  usedBytes: number
  limitBytes: number
  storageFull: boolean
  lastError: string | null
}

export const useSyncStore = create<SyncUiState>(() => ({
  running: false,
  syncing: false,
  phase: 'idle',
  lastSyncAt: null,
  pendingCount: 0,
  migrating: false,
  migrationTotal: 0,
  migrationRemaining: 0,
  usedBytes: 0,
  limitBytes: -1,
  storageFull: false,
  lastError: null,
}))
