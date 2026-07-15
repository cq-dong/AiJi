import { dexieStorage } from '@/adapters/dexieStorage'
import { webCapture } from '@/adapters/webCapture'
import type { CapturePort, StoragePort } from '@/ports'

// DI 根：注入端口适配器。entries 走 DexieStorage（真实持久化）；capture 走 webCapture
// （getUserMedia 麦克风 + WebSpeech 实时预览 + MediaRecorder 录音）。SttPort/LlmPort 待接入。
export interface Di {
  storage: StoragePort
  capture: CapturePort
}

export const di: Di = {
  storage: dexieStorage,
  capture: webCapture,
}
