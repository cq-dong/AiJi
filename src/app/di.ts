import { dexieStorage } from '@/adapters/dexieStorage'
import { webCapture } from '@/adapters/webCapture'
import { openAiCompatLlm } from '@/adapters/openAiCompatLlm'
import { paraformerStreamStt } from '@/adapters/paraformerStreamStt'
import { whisperRestStt } from '@/adapters/whisperRestStt'
import { localStorageSecrets } from '@/adapters/localStorageSecrets'
import { notifications } from '@/adapters/notifications'
import { webAppUpdate } from '@/adapters/webAppUpdate'
import { capacitorAppUpdate } from '@/adapters/capacitorAppUpdate'
import { Capacitor } from '@capacitor/core'
import type { AppUpdatePort, CapturePort, LlmPort, SecretStorePort, StoragePort, SttPort } from '@/ports'

// DI 根：注入端口适配器。entries 走 DexieStorage；capture 走 webCapture；
// llm 走 openAiCompatLlm（OpenAI 兼容 chat BYOK，任意 OpenAI 兼容 endpoint，key 在 SecretStorePort）；
// secrets 走 localStorage；notifications 走 PWA Notification 适配（前台 only，非 domain port）。
// stt 走代理：按 settings.sttMode 选——stream=paraformer WS（公共 DashScope，REST CORS/404 死，
// 只剩 WS）、whisper=OpenAI 兼容 REST /audio/transcriptions（Aliyun PI / OpenAI / Groq）。capture
// 实时预览仍用 WebSpeech，本代理只负责保存后离线转写。

export interface Di {
  storage: StoragePort
  capture: CapturePort
  llm: LlmPort
  stt: SttPort
  secrets: SecretStorePort
  notifications: typeof notifications
  // appUpdate：平台分流——Android 原生壳走 capacitorAppUpdate（原生插件下载安装 APK），
  // 其余（PWA/iOS Safari）走 webAppUpdate（跳 release 页）。@capacitor/core 的
  // isNativePlatform() 在 web 上安全返回 false，不破 PWA build。
  appUpdate: AppUpdatePort
}

// sttMode 在 settings 里，transcribe(ref) 签名固定，故每次按 settings 现选 adapter。
const sttProxy: SttPort = {
  async transcribe(ref) {
    const settings = await dexieStorage.getSettings()
    const adapter = settings.sttMode === 'whisper' ? whisperRestStt : paraformerStreamStt
    return adapter.transcribe(ref)
  },
}

export const di: Di = {
  storage: dexieStorage,
  capture: webCapture,
  llm: openAiCompatLlm,
  stt: sttProxy,
  secrets: localStorageSecrets,
  notifications,
  appUpdate: Capacitor.isNativePlatform() ? capacitorAppUpdate : webAppUpdate,
}
