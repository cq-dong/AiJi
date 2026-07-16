# AiJi · 阿里云 DashScope Paraformer 离线语音转写（SttPort BYOK）实施文档

> 本文是给代码团队的可执行实施手册。所有结论均已在本机用真实 API key + 真实 PCM 端到端验证过（见 §12）。
> 目标：在 AiJi 现有架构（React 19 + Vite + TS strict + Zustand + Dexie/OPFS + Port/adapter）里接入一个**离线、保存后触发**的语音转写端口，把录好的音频 blob 转成文本，喂给已有的 DeepSeek 分类管线。
> 约束：纯浏览器 PWA，**不引入任何后端代理**；API key 永不入源码/不入 git，走 `SecretStorePort`。

---

## 1. 一句话结论

- **不要走 DashScope 录音文件识别 REST API**（`paraformer-v2` 那条）——它被浏览器 CORS 预检挡死，且需要公网可下载 URL，PWA 给不出。
- **走 DashScope 实时流式 WebSocket**（`paraformer-realtime-v2`）：浏览器 `WebSocket` 无 CORS 预检，鉴权用 `?api_key=<key>` query 参数（这是浏览器侧唯一可行的鉴权方式）。
- **离线文件复用同一条 WS**：把 OPFS 里录好的 blob 用 Web Audio API 解码 → 重采样成 16kHz 单声道 16-bit PCM → 按 200ms 帧推过去 → 收 `sentence_end` 句拼终稿。
- WebSpeech 实时预览**保留不动**，只负责采集时的 live interim；paraformer 只在保存后跑一次，产出更准的终稿 transcript 覆盖到 `part.transcript`。

---

## 2. 已验证的关键事实（别再踩这些坑）

### 2.1 REST 文件转写 API 在浏览器里不可行

- 端点：`https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcriptions`（POST）。
- 浏览器先发 OPTIONS 预检；阿里云在预检阶段返回 **401 "No API-key provided"**，且响应头**不带** `Access-Control-Allow-Origin`。
- 根因：阿里云要求 `Authorization` 头出现在握手/预检上，但浏览器**无法**在 CORS 预检请求上挂自定义 `Authorization` 头（预检由浏览器自动发，只带 `Access-Control-Request-*`）。
- 结论：REST 文件 API 不适合纯浏览器 BYOK，**放弃这条**。它还需要公网可下载的 `file_urls`，PWA 也没有。

### 2.2 实时流式 WS 在浏览器里可行 —— 用 `?api_key=` query 鉴权

- WS 端点：`wss://dashscope.aliyuncs.com/api-ws/v1/inference`
- 浏览器原生 `WebSocket(url, [protocols])` **不能设任意 HTTP 头**（标准限制）。所以 `Authorization: Bearer ...` 这条路在浏览器里走不通。
- DashScope 的 WS 支持 query 参数鉴权，但**只认 `api_key` 这个参数名**：`apikey`、`token`、`authorization` 都返回 401。
- 正确连接：`new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference?api_key=' + encodeURIComponent(apiKey))`
- WS 握手不走 CORS 预检（WS 有自己的握手，不受 CORS preflight 约束），所以这条在浏览器里通。

### 2.3 WS host 用 `dashscope.aliyuncs.com`

- 工作区 MaaS 域名（`*.maas.aliyuncs.com`）也能 101，但 WS 的规范域名是 `dashscope.aliyuncs.com`。工作区作用域的 key 在这个域名上可用。

### 2.4 已验证的端到端结果（Python 探针，真实 key）

把一段 16kHz 单声道 16-bit PCM 的样本 wav（内容为英文测试句）按帧推过 WS，收到的终稿文本为：

> **"Hello, word的，这里是阿里巴巴语音实验室。"**

并收到 `task-finished` ack。说明协议链路、鉴权、payload schema、二进制 PCM 推流、结果收集全部正确。浏览器适配只需把这条 Python 逻辑翻译成 TS + Web Audio 解码。


---

## 3. DashScope realtime WS 协议（逐字段，照抄即可）

### 3.1 连接

```
wss://dashscope.aliyuncs.com/api-ws/v1/inference?api_key=<encodeURIComponent(apiKey)>
```

- `ws.binaryType = 'arraybuffer'`（要收二进制？实际服务端只回 JSON 文本帧，但设上无害；我们**发**的是二进制 PCM 帧）。
- 鉴权只靠 URL 里的 `api_key` query。**不要**尝试在 `WebSocket` 第二参数塞 protocols 当 header 用——没用。

### 3.2 发送 run-task（握手后第一条）

`onopen` 里发这条 JSON 文本帧：

```json
{
  "header": {
    "action": "run-task",
    "task_id": "<uuid>",
    "streaming": "duplex"
  },
  "payload": {
    "task_group": "audio",
    "task": "asr",
    "function": "recognition",
    "model": "paraformer-realtime-v2",
    "parameters": {
      "format": "pcm",
      "sample_rate": 16000,
      "enable_punctuation_prediction": true,
      "disfluency_removal_enabled": false,
      "language_hints": ["zh", "en"]
    },
    "input": {}
  }
}
```

**踩过的坑：**
- `payload.task_group` 必须是 `"audio"`——漏了会报 `Missing required parameter 'payload.task_group'`。
- `payload.input` 必须存在（空对象 `{}`）——run-task 和 finish-task 都要，漏了报 `Missing required parameter 'payload.input'`。
- `header.streaming` 用 `"duplex"`（双向流式）。
- `task_id` 用 `crypto.randomUUID()` 生成，后续 finish-task 和它配对。

### 3.3 推送音频（二进制 PCM 帧）

发完 run-task 后，立刻开始推二进制 PCM 帧。每帧 **3200 个 Int16 sample**（= 6400 字节 = 200ms @16kHz）。直接 `ws.send(arrayBuffer)`，**不要**包 JSON。

```ts
const chunkElems = 3200
for (let i = 0; i < pcm.length; i += chunkElems) {
  const chunk = pcm.subarray(i, i + chunkElems)
  const buf = new ArrayBuffer(chunk.byteLength)
  new Int16Array(buf).set(chunk)
  ws.send(buf)
}
```

> 为什么 copy 进新 ArrayBuffer 而不是 `ws.send(pcm.subarray(...))`：见 §10.2 的 TS 类型坑。`Int16Array.buffer` 是 `ArrayBufferLike`（含 `SharedArrayBuffer`），`WebSocket.send` 的 `BufferSource` 参数要 `ArrayBuffer`（不是 `SharedArrayBuffer`），直发 subarray 类型不过。

### 3.4 发送 finish-task（音频推完之后）

PCM 全部推完后，发这条 JSON 文本帧，告诉服务端音频结束：

```json
{
  "header": { "action": "finish-task", "task_id": "<同一个 task_id>" },
  "payload": { "input": {} }
}
```

**踩过的坑：** `payload.input: {}` 必须有，不能省，也不能 `payload: {}`。漏了报 `Missing required parameter 'payload.input'`，且收不到终稿。

### 3.5 接收服务端消息（`onmessage`）

服务端发回的是 **JSON 文本帧**。关键事件（`header.event` 字段区分）：

| `header.event` | 含义 | 取值位置 |
|---|---|---|
| `task-started` | 任务已开始，可以推音频 | （可忽略，收到即可推） |
| `result-generated` | 增量/最终识别结果 | `payload.output.sentence` |
| `task-finished` | 任务全部完成 | 收到后 resolve |
| `task-failed` | 任务失败 | `header.error_message` |

`result-generated` 的 `payload.output.sentence` 结构：

```json
{
  "text": "当前句子的识别文本（可能是中间结果也可能是终稿）",
  "sentence_end": true   // true=本句终稿；false=中间增量
}
```

**收集逻辑：**
- 每次 `result-generated`：把 `sentence.text` 记到 `lastInterim`（覆盖，作为兜底）。
- 若 `sentence_end === true`：把 `sentence.text` push 到 `finals[]`（累加终稿句）。
- `task-finished`：`resolve(finals.join('') || lastInterim)`。
- `task-failed`：`reject(new Error(error_message))`。

### 3.6 超时与错误

- 超时：`Math.min(120000, Math.max(30000, (pcm.length / 16000) * 5000))`——即「音频时长的 5 倍秒数，夹在 30s~120s 之间」。超时则 `ws.close()` + reject。
- `ws.onerror`：reject（多半是 key 错/网络断/端点错）。
- `ws.onclose`：若还没 settle，reject（提前关闭，code 记进错误信息）。
- 用 `settled` 标志保证 resolve/reject 只触发一次，并 `clearTimeout(timer)`。


---

## 4. 音频格式要求

- **采样率**：16000 Hz
- **声道**：单声道（mono）
- **位深**：16-bit signed integer（Int16，little-endian）
- **格式名**（run-task parameters.format）：`"pcm"`（裸 PCM，不带 wav 头）

录制的 blob 通常是 `audio/webm; codecs=opus`（MediaRecorder 默认）或其它容器格式，**必须解码 + 重采样**成上述 PCM，不能直推。

### 4.1 解码 → 重采样 → Int16 流程

1. `blob.arrayBuffer()` → `ArrayBuffer`
2. `new AudioContext().decodeAudioData(arrBuf)` → `AudioBuffer`（解码成 32-bit float PCM，采样率 = 源文件采样率，可能多声道）
3. `new OfflineAudioContext(1, length, 16000)`：`length = Math.ceil(decoded.length * 16000 / decoded.sampleRate)`。把源 buffer 接到 destination，`startRendering()` → 渲染成 16kHz 单声道 `AudioBuffer`。
4. `rendered.getChannelData(0)` → `Float32Array`（-1.0~1.0）
5. Float32 → Int16：`s < 0 ? s * 0x8000 : s * 0x7fff`，clamp 到 [-1, 1]。
6. 得到 `Int16Array`，按 §3.3 帧大小推送。

### 4.2 Safari 兼容

- `AudioContext` / `OfflineAudioContext` 在旧 Safari 是 `webkitAudioContext` / `webkitOfflineAudioContext`，做 fallback 探测。
- `decodeAudioData` 在 Safari 旧版是回调式，但现代 Safari 支持 Promise。给 `decodeAudioData` 传 `arrBuf.slice(0)`（拷一份），避免某些实现会 detach 原 buffer。

---

## 5. 适配器实现（`src/adapters/paraformerStt.ts`，可直接落地）

这是 `SttPort` 的 PWA 适配器。结构镜像 `src/adapters/deepSeekLlm.ts`（BYOK：key 从 `di.secrets.get('stt:key')`，model 从 `settings.sttModel`，缺失 → throw → 管线 catch → 条目 `failed`）。

```ts
import type { SttPort } from '@/ports'
import { di } from '@/app/di'

// SttPort PWA 适配：阿里云 DashScope paraformer-realtime-v2 实时流式 WS（BYOK）。
// key 从 SecretStorePort('stt:key') 取，model 从 Settings.sttModel 取——永不入源码。
// 浏览器直连已验通：WS 无 CORS 预检，鉴权走 ?api_key= query。离线文件复用同一条 WS：
// 把 OPFS blob 解码成 PCM 16k 单声道 16-bit 推过去。key 缺失 → throw，管线 catch 后
// 条目标 failed（AI-only 降级，采集存储不伤）。WebSpeech live interim 不动。

const SECRET_KEY = 'stt:key'
const WS_BASE = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
const TARGET_RATE = 16000

function getAudioContextCtor(): typeof AudioContext {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) throw new Error('AudioContext 不支持（无法解码音频）')
  return Ctor
}

async function blobToPcm16k(blob: Blob): Promise<Int16Array> {
  const arrBuf = await blob.arrayBuffer()
  const ACtor = getAudioContextCtor()
  const decodeCtx = new ACtor()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(arrBuf.slice(0))
  } finally {
    void decodeCtx.close()
  }
  const length = Math.ceil((decoded.length * TARGET_RATE) / decoded.sampleRate)
  const OCtor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!OCtor) throw new Error('OfflineAudioContext 不支持（无法重采样）')
  const off = new OCtor(1, length, TARGET_RATE)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  const rendered = await off.startRendering()
  const float = rendered.getChannelData(0)
  const int16 = new Int16Array(float.length)
  for (let i = 0; i < float.length; i++) {
    const s = Math.max(-1, Math.min(1, float[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

function streamAsr(pcm: Int16Array, apiKey: string, model: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(`${WS_BASE}?api_key=${encodeURIComponent(apiKey)}`)
    } catch (e) {
      reject(new Error('STT WS 构造失败: ' + (e as Error).message))
      return
    }
    ws.binaryType = 'arraybuffer'
    const finals: string[] = []
    let lastInterim = ''
    let taskId = ''
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timeoutMs = Math.min(120000, Math.max(30000, (pcm.length / TARGET_RATE) * 5000))
    const timer = setTimeout(() => {
      settle(() => {
        try { ws.close() } catch { /* noop */ }
        reject(new Error('STT 超时'))
      })
    }, timeoutMs)

    ws.onopen = () => {
      taskId = crypto.randomUUID()
      ws.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model,
            parameters: {
              format: 'pcm',
              sample_rate: TARGET_RATE,
              enable_punctuation_prediction: true,
              disfluency_removal_enabled: false,
              language_hints: ['zh', 'en'],
            },
            input: {},
          },
        }),
      )
      const chunkElems = 3200
      for (let i = 0; i < pcm.length; i += chunkElems) {
        const chunk = pcm.subarray(i, i + chunkElems)
        const buf = new ArrayBuffer(chunk.byteLength)
        new Int16Array(buf).set(chunk)
        ws.send(buf)
      }
      ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId }, payload: { input: {} } }))
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: {
        header?: { event?: string; error_message?: string }
        payload?: { output?: { sentence?: { text?: string; sentence_end?: boolean } } }
      }
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const event = msg.header?.event
      if (event === 'result-generated') {
        const s = msg.payload?.output?.sentence
        if (!s) return
        if (typeof s.text === 'string') lastInterim = s.text
        if (s.sentence_end && typeof s.text === 'string') finals.push(s.text)
      } else if (event === 'task-failed') {
        settle(() => reject(new Error('STT task-failed: ' + (msg.header?.error_message ?? ''))))
      } else if (event === 'task-finished') {
        settle(() => resolve(finals.join('') || lastInterim))
      }
    }
    ws.onerror = () => {
      settle(() => reject(new Error('STT WS error（key/网络/端点）')))
    }
    ws.onclose = (ev) => {
      settle(() => reject(new Error('STT WS 提前关闭 code=' + ev.code)))
    }
  })
}

export const paraformerStt: SttPort = {
  async transcribe(ref) {
    const settings = await di.storage.getSettings()
    const model = settings.sttModel || 'paraformer-realtime-v2'
    const apiKey = await di.secrets.get(SECRET_KEY)
    if (!apiKey) throw new Error('STT BYOK 未配置（stt:key 缺失）')
    const blob = await di.storage.getMedia(ref)
    if (!blob) throw new Error('音频 blob 未找到: ' + ref)
    const pcm = await blobToPcm16k(blob)
    if (pcm.length === 0) throw new Error('音频解码为空: ' + ref)
    const text = await streamAsr(pcm, apiKey, model)
    return text.trim()
  },
}
```

> `di.storage.getMedia(ref)` 已在 `dexieStorage.ts` 实现（读 OPFS）。`SttPort` 接口已在 `src/ports/index.ts` 定义（`transcribe(ref: string): Promise<string>`）。**不需要改 port 接口。**


---

## 6. Domain 类型 & seed 改动（`src/domain/types.ts` + `src/data/seed.ts`）

### 6.1 `Settings` 接口加三个字段

`src/domain/types.ts` 的 `Settings` 接口里，在 `llmModel?` 之后、`recordLocation` 之前加：

```ts
  sttProvider: string
  sttModel?: string   // e.g. 'paraformer-realtime-v2'（DashScope realtime WS, BYOK）
  sttKeyRef?: string  // 'stt:key' when a key is set in SecretStorePort
```

完整 `Settings` 应为：

```ts
export interface Settings {
  llmProvider: string
  apiKeyRef?: string
  llmUrl?: string
  llmModel?: string
  sttProvider: string
  sttModel?: string
  sttKeyRef?: string
  recordLocation: boolean
  dailyReminder: boolean
  theme: 'light' | 'dark' | 'system'
}
```

### 6.2 `seedSettings` 默认值

`src/data/seed.ts` 的 `seedSettings` 改成（注意 `sttProvider`/`sttModel`/`sttKeyRef` 三行）：

```ts
export const seedSettings = {
  llmProvider: 'DeepSeek · BYOK',
  apiKeyRef: undefined,
  llmUrl: 'https://api.deepseek.com/v1/chat/completions',
  llmModel: 'deepseek-v4-flash',
  sttProvider: 'Paraformer · BYOK',
  sttModel: 'paraformer-realtime-v2',
  sttKeyRef: undefined,
  recordLocation: false,
  dailyReminder: false,
  theme: 'light' as const,
}
```

> Settings 在 Dexie 里是整对象存取（`getSettings` 读单行 `db.settings.get(1)`，`saveSettings` upsert key=1），**加字段不需要 Dexie schema 迁移**。

---

## 7. DI 接线（`src/app/di.ts`）

加 `paraformerStt` 导入、`SttPort` 类型导入、`stt` 字段：

```ts
import { dexieStorage } from '@/adapters/dexieStorage'
import { webCapture } from '@/adapters/webCapture'
import { deepSeekLlm } from '@/adapters/deepSeekLlm'
import { paraformerStt } from '@/adapters/paraformerStt'
import { localStorageSecrets } from '@/adapters/localStorageSecrets'
import type { CapturePort, LlmPort, SecretStorePort, StoragePort, SttPort } from '@/ports'

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
```

---

## 8. Store 接线（`src/app/store.ts`）

两处改动：加 `setSttConfig` action；在 `processEntry` 开头插 STT 步。

### 8.1 接口加 `setSttConfig`

`UiState` 接口里，`setLlmConfig` 之后加一行：

```ts
  setLlmConfig: (url: string, model: string, key: string) => void
  setSttConfig: (model: string, key: string) => void
  processEntry: (entryId: string) => Promise<void>
```

### 8.2 实现 `setSttConfig`（镜像 `setLlmConfig`）

在 `setLlmConfig` 实现之后、`processEntry` 之前加：

```ts
  setSttConfig: (model, key) => {
    const cur = get().settings
    const next = { ...cur, sttModel: model, sttKeyRef: key ? 'stt:key' : cur.sttKeyRef }
    set({ settings: next })
    void di.storage.saveSettings(next).catch((e) => console.error('[store] saveSettings failed', e))
    if (key) void di.secrets.set('stt:key', key).catch((e) => console.error('[store] setSttKey failed', e))
  },
```

### 8.3 `processEntry` 开头插 STT 步（在 `const ai = await di.llm.classify(entryId)` **之前**）

STT 终稿要在分类**之前**跑，这样 `deepSeekLlm.classify` 读 `entry.parts[].transcript` 时拿到的是 paraformer 的高质量文本，而不是 WebSpeech 的 live 预览。

```ts
  processEntry: async (entryId) => {
    try {
      // STT 终稿（保存后）：paraformer 重写音频/视频 transcript，比 WebSpeech live 预览准。
      // 无 stt:key → 跳过整步（用 WebSpeech 预览文本分类即可）；
      // 单 part 失败 → 回退预览文本，不阻断分类。
      const sttKey = await di.secrets.get('stt:key')
      if (sttKey) {
        const fresh = await di.storage.getEntry(entryId)
        if (fresh) {
          let changed = false
          const parts = await Promise.all(
            fresh.parts.map(async (p) => {
              if (p.type !== 'audio' && p.type !== 'video') return p
              try {
                const text = await di.stt.transcribe(p.ref)
                if (!text) return p
                changed = true
                return { ...p, transcript: text }
              } catch (e) {
                console.error('[store] stt failed for ' + p.ref, e)
                return p
              }
            }),
          )
          if (changed) {
            const updated: Entry = { ...fresh, parts, updatedAt: new Date().toISOString() }
            await di.storage.saveEntry(updated)
          }
        }
      }
      const ai = await di.llm.classify(entryId)
      // …（后续 saveEntryAi / 重载 categories,tags / 标 ready 的逻辑保持不变）
```

**退化语义（重要）：**
- **无 `stt:key`** → 整个 STT 块跳过，用 WebSpeech live 预览文本（`stopRecording` 里存的 `finalized+interim`）去分类。AI-only 降级，采集存储不伤。
- **某 part 的 paraformer 失败**（网络/key 过期/解码失败）→ 该 part 回退到 WebSpeech 预览 transcript，其它 part 继续，不阻断分类。
- STT 成功的 part：`part.transcript` 被覆盖成 paraformer 终稿，落库（`saveEntry`）。
- `Entry` 类型已 import 在 store.ts 顶部（`import type { ... Entry ... }`），不用额外加。


---

## 9. Settings UI（`src/ui/screens/settings/index.tsx`）

加一个 `SttSheet`（镜像现有 `ByokSheet`，但只有 model + key 两个输入，没有 URL），让「音频转写模型」那一行可点开。

### 9.1 在 `ByokSheet` 之后、`export default function Settings()` 之前，插入 `SttSheet`

```tsx
function SttSheet({ onClose }: { onClose: () => void }) {
  const settings = useUiStore((s) => s.settings)
  const setSttConfig = useUiStore((s) => s.setSttConfig)
  const [model, setModel] = useState(settings.sttModel ?? '')
  const [key, setKey] = useState('')
  const hasKey = settings.sttKeyRef === 'stt:key'
  const inputCls =
    'w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-screen bg-page p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">音频转写模型</p>
          <button type="button" onClick={onClose} className="text-[16px] text-t3">✕</button>
        </div>
        <p className="mt-1 text-[11px] text-t3">BYOK · 阿里云 DashScope paraformer（WS 流式）· Key 本地存</p>

        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[11px] text-t2">模型</label>
            <input
              className={inputCls}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="paraformer-realtime-v2"
            />
          </div>
          <div>
            <label className="text-[11px] text-t2">
              API Key{hasKey ? '（已设置，留空不变）' : ''}
            </label>
            <input
              className={inputCls}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? '••••••（留空保持不变）' : 'sk-…'}
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" className="h-[38px] flex-1 rounded-btn" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={() => {
              setSttConfig(model.trim() || 'paraformer-realtime-v2', key)
              onClose()
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
```

### 9.2 `Settings` 组件里加 `editingStt` state

```tsx
  const [editing, setEditing] = useState(false)
  const [editingStt, setEditingStt] = useState(false)
```

### 9.3 「音频转写模型」`ModelRow` 改成可点 + value 显示 `sttModel || sttProvider`

原来：

```tsx
<ModelRow label="音频转写模型" value={settings.sttProvider} />
```

改成：

```tsx
<ModelRow
  label="音频转写模型"
  value={settings.sttModel || settings.sttProvider}
  onClick={() => setEditingStt(true)}
/>
```

### 9.4 渲染 `SttSheet`

在 `{editing && <ByokSheet onClose={() => setEditing(false)} />}` 之后加：

```tsx
{editingStt && <SttSheet onClose={() => setEditingStt(false)} />}
```

> `ModelRow` 组件已支持 `onClick`（可点）。`Button` 从 `@/ui/components` import（已在文件顶部）。设计 tokens 见 CLAUDE.md §4。

---

## 10. TypeScript 严格性注意（违反则 typecheck 挂）

tsconfig.app.json 关键项：`verbatimModuleSyntax`、`erasableSyntaxOnly`、`noUnusedLocals`、`noUnusedParameters` 全开。

### 10.1 类型 import 必须 `import type`

`verbatimModuleSyntax: true` → 纯类型 import 必须写 `import type { SttPort } from '@/ports'`。混用可写 `import { di } from '@/app/di'`（值）。

### 10.2 `ws.send` 的 Int16Array 类型坑（已踩、已修）

`Int16Array.buffer` 在新 TS lib 里是 `ArrayBufferLike`（含 `SharedArrayBuffer`）。`WebSocket.send(data: string | Blob | BufferSource)` 的 `BufferSource = ArrayBuffer | ArrayBufferView<ArrayBuffer>`，**不接受** `SharedArrayBuffer`。所以 `ws.send(pcm.subarray(i, i+chunkElems))` 会报：

```
error TS2345: Argument of type 'Int16Array<ArrayBufferLike>' is not assignable to
parameter of type 'string | Blob | BufferSource'.
  Type 'SharedArrayBuffer' is not assignable to type 'ArrayBuffer'.
```

**修法**（见 §5 代码）：把每个 chunk copy 进一个**新 `ArrayBuffer`** 再发：

```ts
const chunk = pcm.subarray(i, i + chunkElems)
const buf = new ArrayBuffer(chunk.byteLength)
new Int16Array(buf).set(chunk)
ws.send(buf)   // buf 是 ArrayBuffer，类型通过
```

### 10.3 无 `enum` / `namespace` / 构造函数参数属性

`erasableSyntaxOnly: true` → 禁 `enum`、`namespace`、构造函数参数属性。用字符串字面量联合 + `as const`（本项目 `EntryStatus`、`PartType` 都这么写）。

### 10.4 自检命令

```sh
npx tsc -p tsconfig.app.json
```

- **不要**用 `npm run typecheck` / `tsc -b`——后者写共享 tsbuildinfo 缓存，并发会竞态。
- 集成阶段（lead）才跑 `npm run typecheck`。


---

## 11. 退化与边界

| 场景 | 行为 |
|---|---|
| 未设置 `stt:key` | `processEntry` 里 STT 块整段跳过；用 WebSpeech live 预览文本分类。采集/存储/AI 都不伤。 |
| 某 part paraformer 失败（网络断、key 过期、WS error、解码失败） | 该 part 回退到 WebSpeech 预览 transcript；其它 part 继续；不阻断 `classify`。错误记 `console.error`。 |
| 全部 part 都 STT 失败 | 等价于跳过；用各 part 原有 WebSpeech transcript 分类。 |
| `classify` 本身失败（LLM key 缺失/网络） | 条目标 `failed`（已有逻辑，不动）。 |
| 音频解码后为空（`pcm.length === 0`） | `transcribe` throw → 该 part 回退预览文本。 |
| WS 超时 | `ws.close()` + reject → 该 part 回退预览文本。 |

**核心不变量**：STT 失败**永远不阻断采集存储**，也**不阻断分类**（回退到 WebSpeech）。最坏情况 = 退化到 Phase 3 的 WebSpeech-only 行为。

---

## 12. 验收方法（代码团队照做）

### 12.1 静态

```sh
npx tsc -p tsconfig.app.json   # 期望 EXIT=0
```

### 12.2 浏览器 e2e（390×844，真机/桌面均可）

难点：浏览器自动化没法"对麦克风吹中文语音"，所以**用 macOS TTS 生成真实中文语音 wav 注入**，而不是靠 live 录音。

**步骤：**

1. 生成测试语音（macOS）：
   ```sh
   say -v Tingting -o /tmp/asr-test.aiff "你好，这是一段测试语音，用来验证语音识别"
   afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/asr-test.aiff /tmp/asr-test.wav
   ```
   把 `asr-test.wav` 放进项目 `public/`（vite 会以 `/asr-test.wav` 提供它）。

2. 加一个 **DEV-only 测试钩子**（验收后删掉），在 `src/main.tsx`：
   ```ts
   import { di } from '@/app/di'
   // ...在 hydrate() 之后...
   if (import.meta.env.DEV) {
     ;(window as unknown as { __aiji?: unknown }).__aiji = { di, useUiStore }
   }
   ```
   > 这是为了在浏览器 console 里能拿到 `di` 和 `useUiStore`，验收完**务必移除**这段 + 移除 `public/asr-test.wav`。

3. `npm run dev`（http://localhost:5173 或 5174）。

4. 浏览器打开 app，进 **设置 → 音频转写模型**，在 SttSheet 里填 model（`paraformer-realtime-v2`）+ 真实 key，保存。验证：`localStorage.getItem('stt:key')` 非空；Dexie `settings` 表 `sttKeyRef === 'stt:key'`。

5. 浏览器 console 注入测试音频条目并触发 STT：
   ```js
   const { di, useUiStore } = window.__aiji
   const blob = await (await fetch('/asr-test.wav')).blob()
   const ref = 'asr-test-1'
   await di.storage.saveMedia(ref, blob)
   const now = new Date().toISOString()
   const entry = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, status: 'processing',
     parts: [{ type: 'audio', ref, durationSec: 5, transcript: '（WebSpeech 预览占位）' }] }
   await di.storage.saveEntry(entry)
   useUiStore.setState({ entries: [entry, ...useUiStore.getState().entries] })
   useUiStore.getState().processEntry(entry.id)
   ```

6. 等 WS 跑完（~2-5s）。验收通过标志：
   - `useUiStore.getState().entries.find(e=>e.id===entry.id).parts[0].transcript` 变成 paraformer 终稿（应含"你好/测试语音/验证语音识别"等字样），**不再是** "（WebSpeech 预览占位）"。
   - 条目 `status` 变 `ready`，`aiId` 有值（说明 DeepSeek 分类也跑通了）。
   - console 无 `[store] stt failed` 或 `processEntry failed`。

7. 验收后清理：移除 `main.tsx` 的 `__aiji` 钩子 + `import { di }`；删 `public/asr-test.wav`；再跑一次 `npx tsc -p tsconfig.app.json` 确认 EXIT=0。

### 12.3 回归

跑一遍已有 Phase 7a 的文本条目分类（不录音频），确认未配 STT key 时 STT 块被跳过、文本条目照常分类 → `ready`。

---

## 13. 安全

- **API key 永不入源码 / 不入 git**。key 只经 `SecretStorePort('stt:key')` 存到 `localStorage`（`localStorageSecrets.ts` 实现，隐私模式吞错返回 undefined）。
- `paraformerStt.ts` 里**没有**硬编码 key；运行时从 `di.secrets.get('stt:key')` 取。
- key 缺失 → throw，不静默失败、不写死 fallback key。
- `?api_key=<key>` 会出现在 WS URL 里——这是浏览器侧的唯一选项，属于已知妥协。key 不进服务端日志（DashScope 侧），但本机调试时别把带 key 的 WS URL 截图外发。

---

## 14. 文件清单（改/新建）

| 文件 | 动作 |
|---|---|
| `src/adapters/paraformerStt.ts` | **新建**（§5 全文） |
| `src/domain/types.ts` | 改 `Settings`（§6.1，加 3 字段） |
| `src/data/seed.ts` | 改 `seedSettings`（§6.2） |
| `src/app/di.ts` | 改（§7，加 stt 字段 + import） |
| `src/app/store.ts` | 改（§8，加 `setSttConfig` + `processEntry` STT 步） |
| `src/ui/screens/settings/index.tsx` | 改（§9，加 `SttSheet` + `editingStt` + ModelRow 可点） |
| `src/ports/index.ts` | **不改**（`SttPort` 已定义） |
| `src/adapters/dexieStorage.ts` | **不改**（`getMedia` 已实现） |
| `src/adapters/webCapture.ts` | **不改**（WebSpeech live 预览保留） |

**实现顺序建议**：§5 适配器 → §6 类型/seed → §7 DI → §8 store → §9 UI → §10 自检 → §12 验收 → §12.2 清理钩子。

---

## 15. 与已有 Phase 7a（DeepSeek LLM）的关系

- Phase 7a（commit `99c12d5`）已把 LLM 分类管线落地：`deepSeekLlm.ts` + `localStorageSecrets.ts` + `processEntry` 里 `di.llm.classify` + Settings 的 LLM BYOK UI。
- STT 是在 `processEntry` 里、`classify` **之前**插一步：把音频 part 的 transcript 用 paraformer 终稿覆盖，再让 `classify` 读到更准的文本。
- 两者共用 `SecretStorePort`（不同 key：`llm:key` vs `stt:key`）、共用 Settings BYOK 模式、共用「key 缺失 → throw → AI-only 降级」语义。
- STT 不依赖 LLM，LLM 不依赖 STT（STT 跳过/失败时 LLM 照用 WebSpeech 预览文本分类）。可独立 commit 成 Phase 7b。

