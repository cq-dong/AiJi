import { dexieStorage } from '@/adapters/dexieStorage'
import { webCapture } from '@/adapters/webCapture'
import { deepSeekLlm } from '@/adapters/deepSeekLlm'
import { localStorageSecrets } from '@/adapters/localStorageSecrets'
import type { CapturePort, LlmPort, SecretStorePort, StoragePort } from '@/ports'

// DI 根：注入端口适配器。entries 走 DexieStorage；capture 走 webCapture；
// llm 走 deepSeekLlm（OpenAI 兼容 chat BYOK，key 在 SecretStorePort）；secrets 走 localStorage。
// SttPort 待接入（paraformer 异步 file_url 不适配纯浏览器 PWA，待用户定 STT 方案）。
export interface Di {
  storage: StoragePort
  capture: CapturePort
  llm: LlmPort
  secrets: SecretStorePort
}

export const di: Di = {
  storage: dexieStorage,
  capture: webCapture,
  llm: deepSeekLlm,
  secrets: localStorageSecrets,
}
