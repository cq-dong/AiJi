import { dexieStorage } from '@/adapters/dexieStorage'
import type { StoragePort } from '@/ports'

// DI 根：注入端口适配器。entries 走 DexieStorage（真实持久化）；其余端口待接入。
export interface Di {
  storage: StoragePort
}

export const di: Di = {
  storage: dexieStorage,
}
