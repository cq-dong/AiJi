import { dexieStorage } from '@/adapters/dexieStorage'
import { webCapture } from '@/adapters/webCapture'
import { openAiCompatLlm } from '@/adapters/openAiCompatLlm'
import { paraformerStreamStt } from '@/adapters/paraformerStreamStt'
import { whisperRestStt } from '@/adapters/whisperRestStt'
import { localStorageSecrets } from '@/adapters/localStorageSecrets'
import { notifications } from '@/adapters/notifications'
import { webAppUpdate } from '@/adapters/webAppUpdate'
import { capacitorAppUpdate } from '@/adapters/capacitorAppUpdate'
import { localNotifications } from '@/adapters/localNotifications'
import { githubFeedback } from '@/adapters/githubFeedback'
import { mockAuth } from '@/adapters/mockAuth'
import { mockQuota } from '@/adapters/mockQuota'
import { mockPlan } from '@/adapters/mockPlan'
import { httpAuth } from '@/adapters/httpAuth'
import { httpQuota } from '@/adapters/httpQuota'
import { httpPlan } from '@/adapters/httpPlan'
import { builtinLlm } from '@/adapters/builtinLlm'
import { builtinStt } from '@/adapters/builtinStt'
import { Capacitor } from '@capacitor/core'
import type {
  AppUpdatePort, AuthPort, CapturePort, FeedbackPort, LocalNotificationsPort,
  LlmPort, PlanPort, QuotaPort, SecretStorePort, StoragePort, SttPort,
} from '@/ports'

// Slice B Phase A env 分流：VITE_AIJI_BACKEND='http' → 真实后端（httpAuth/httpQuota/httpPlan），
// 否则 mock（mockAuth/mockQuota/mockPlan）。BASE 由各 http 适配器自读 VITE_AIJI_BACKEND_BASE。
const useHttp = import.meta.env.VITE_AIJI_BACKEND === 'http'
const authImpl: AuthPort = useHttp ? httpAuth : mockAuth
const quotaImpl: QuotaPort = useHttp ? httpQuota : mockQuota
const planImpl: PlanPort = useHttp ? httpPlan : mockPlan

// DI 根：注入端口适配器。Slice B 起接入 auth/quota/plan（mock 实现）；llm/stt 改为二级代理——
// 按 settings.keySource 路由：builtin → 内置 proxy（builtinLlm/builtinStt），byok → 用户自配
// （openAiCompatLlm / paraformerStreamStt|whisperRestStt by sttMode）。byok 路径与重构前字节等价：
// 代理只加一层 keySource 判定后直透调用既有 BYOK 适配器，BYOK 适配器自身未改。

export interface Di {
  storage: StoragePort
  capture: CapturePort
  llm: LlmPort
  stt: SttPort
  secrets: SecretStorePort
  auth: AuthPort
  quota: QuotaPort
  plan: PlanPort
  notifications: typeof notifications
  // appUpdate：平台分流——Android 原生壳走 capacitorAppUpdate（原生插件下载安装 APK），
  // 其余（PWA/iOS Safari）走 webAppUpdate（跳 release 页）。@capacitor/core 的
  // isNativePlatform() 在 web 上安全返回 false，不破 PWA build。
  appUpdate: AppUpdatePort
  // D4: 本地提醒通知——原生走 @capacitor/local-notifications（系统级铃声+弹窗，
  // 后台/被杀仍触发），web 走浏览器 Notification（前台 best-effort）。适配器内部分流。
  localNotifications: LocalNotificationsPort
  // 使用反馈——内置 GitHub PAT（.env.local inline），提交建 Issue。见
  // docs/superpowers/specs/2026-07-19-feedback-feature-design.md。
  feedback: FeedbackPort
}

// keySource 读取：每次调用读 IndexedDB 单行 settings (<1ms)，相对 LLM/STT 秒级 IO 可忽略；
// 缓存需 setKeySource 时跨模块 invalidate，YAGNI。undefined / 非 'builtin' 一律按 byok 处理，
// 与重构前默认行为一致（旧代码 di.llm = openAiCompatLlm 直连）。
async function readKeySource(): Promise<'byok' | 'builtin'> {
  const s = await dexieStorage.getSettings()
  return s.keySource === 'builtin' ? 'builtin' : 'byok'
}

// llmProxy：每次调用读 keySource，builtin → builtinLlm，否则 → openAiCompatLlm（与旧直连等价）。
const llmProxy: LlmPort = {
  classify: (id) => readKeySource().then((k) => (k === 'builtin' ? builtinLlm.classify(id) : openAiCompatLlm.classify(id))),
  aggregate: (ids, scope, range, d, id) => readKeySource().then((k) =>
    k === 'builtin' ? builtinLlm.aggregate(ids, scope, range, d, id) : openAiCompatLlm.aggregate(ids, scope, range, d, id)),
  parseChatIntent: (q, now) => readKeySource().then((k) =>
    k === 'builtin' ? builtinLlm.parseChatIntent(q, now) : openAiCompatLlm.parseChatIntent(q, now)),
  answerChat: (o) => readKeySource().then((k) => (k === 'builtin' ? builtinLlm.answerChat(o) : openAiCompatLlm.answerChat(o))),
  ping: (o) => readKeySource().then((k) => (k === 'builtin' ? builtinLlm.ping(o) : openAiCompatLlm.ping(o))),
}

// sttProxy：二级。builtin → builtinStt；byok → 按 sttMode 选 whisperRestStt / paraformerStreamStt
// （与旧 sttProxy 字节等价，仅在 byok 分支前加了 builtin 分支）。
const sttProxy: SttPort = {
  async transcribe(ref) {
    const settings = await dexieStorage.getSettings()
    if (settings.keySource === 'builtin') return builtinStt.transcribe(ref)
    const adapter = settings.sttMode === 'whisper' ? whisperRestStt : paraformerStreamStt
    return adapter.transcribe(ref)
  },
}

export const di: Di = {
  storage: dexieStorage,
  capture: webCapture,
  llm: llmProxy,
  stt: sttProxy,
  secrets: localStorageSecrets,
  auth: authImpl,
  quota: quotaImpl,
  plan: planImpl,
  notifications,
  appUpdate: Capacitor.isNativePlatform() ? capacitorAppUpdate : webAppUpdate,
  localNotifications,
  feedback: githubFeedback,
}
