import { dexieStorage } from '@/adapters/dexieStorage'
import { webCapture } from '@/adapters/webCapture'
import { deepSeekLlm } from '@/adapters/deepSeekLlm'
import { paraformerStt } from '@/adapters/paraformerStt'
import { localStorageSecrets } from '@/adapters/localStorageSecrets'
import type { CapturePort, LlmPort, SecretStorePort, StoragePort, SttPort } from '@/ports'

// DI 根：注入端口适配器。entries 走 DexieStorage；capture 走 webCapture；
// llm 走 deepSeekLlm（OpenAI 兼容 chat BYOK，key 在 SecretStorePort）；
// stt 走 paraformerStt（DashScope realtime WS，保存后离线转写，live 预览仍用 WebSpeech）；
// secrets 走 localStorage。
export interface Di {
  storage: StoragePort
  capture: CapturePort
  llm: LlmPort
  stt: SttPort
  secrets: SecretStorePort
}

export const di: Di = {
  storage: dexieStorage,
  capture: webCapture,
  llm: deepSeekLlm,
  stt: paraformerStt,
  secrets: localStorageSecrets,
}
