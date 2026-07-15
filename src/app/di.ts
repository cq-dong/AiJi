import { mockStorage } from '@/adapters/mockStorage'
import type { StoragePort } from '@/ports'

// DI 根：注入端口适配器。UI 层阶段统一走 mock；真实适配后续替换此处。
export interface Di {
  storage: StoragePort
}

export const di: Di = {
  storage: mockStorage,
}
