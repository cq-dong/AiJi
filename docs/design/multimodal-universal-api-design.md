# AiJi · 多模态视觉理解 + 通用 BYOK API · 设计文档

> 版本：1.0 · 2026-07-17
> 状态：方案定稿（决策见 §0）
> 范围：①LLM 通用化收尾 ②STT 双模式 ③视觉理解（图 + 视频抽帧）
> 关联：读侧 `ai-chat-design.md`；AI 写 `ai-write-design.md`（暂搁置，A3/B4 未定）

---

## 0. 产品决策（已拍板）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| LLM 通用化 | 重命名 `openAiCompatLlm` + placeholder 中性 + model 下拉预设 + 连通性测试 + devSeed 默认空 | 后端已通用（OpenAI 兼容 + isDeepSeek 守门），只剩命名 + UI |
| STT 模式 | 双模式 `stream` / `whisper` | 保 WebSpeech 实时预览 + 通用 fallback |
| STT 实时预览 | **始终 WebSpeech**（不受 BYOK 影响） | 免费、浏览器内置、流式 interim+final |
| Vision 范围 | MVP 只 `classify` 附图 | aggregate/answerChat 靠 summary 间接含图，控成本 |
| 视频抽帧 | 首尾 + 中间每 N 秒（默认 10），cap 8 均匀采样，去重 | 覆盖前中后 + 防 context 爆 |
| 视频音轨 | 照常 STT 转录 transcript（双模态） | 视频有音轨，AI 拿图 + 话 |
| `videoVisionEnabled` 总开关 | 默认 true | model 不支持 / 省成本时可关 |
| vision 不支持降级 | 静默去图纯文本 | 不打扰，不崩 |
| 照片 | durationSec=0，不抽帧，整张压缩 | 无时长 |

---

## 1. 现状澄清（两关键简化）

### 1.1 LLM 后端已通用（不死板）
- `deepSeekLlm.ts` 是 OpenAI 兼容：POST `/chat/completions`，`Authorization: Bearer`
- `isDeepSeek(url, model)` 守门（:82-83）：非 DeepSeek endpoint 不发私有参数 → 任意 OpenAI 兼容 endpoint（Kimi/通义/Moonshot/Ollama/vLLM/llama.cpp/Azure/OpenRouter）都能填
- Settings UI 已有 url/model/key 三输入（`settings/index.tsx:154-200`），`setLlmConfig(url, model, key)`
- key 走 `SecretStorePort('llm:key')`，不入源码
- `devSeed.ts` DEV 从 `.env.local`（`VITE_LLM_URL/MODEL`）填，UI 改了 stick

→ **LLM 真要改的很小**：命名 + placeholder + devSeed 默认 + UI 增强（下拉/测试按钮）。后端逻辑不动。

### 1.2 STT 两层独立
- **capture 实时预览** = WebSpeech（`webCapture.ts:97`，浏览器内置 `SpeechRecognition`，免费流式 interim+final + t2s 转简体）
- **`SttPort.transcribe`** = 保存后离线高质量转录（`store.ts:449` processEntry 调，`paraformerStt.ts:144` DashScope WS）

→ **双模式只动 `SttPort.transcribe` 一层**，capture 实时预览不牺牲。用户体感不变（capture 时仍有 live 字），只是保存后转录的 provider 可选。

### 1.3 CORS 实测矩阵（2026-07-17，OPTIONS 预检）

| 端点 | 结果 |
|---|---|
| 公共 `dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions` | **404**（公共服务未暴露兼容音频端点；compatible-mode 只开了 chat/embeddings） |
| 公共 `dashscope.aliyuncs.com/api/v1`（native 音频 REST） | **CORS 401**（OPTIONS 预检即拒） |
| 公共 `dashscope.aliyuncs.com/api-ws/v1/inference`（WS） | **通**（`?api_key=` query 鉴权，无 CORS 预检） |
| Aliyun PI `llm-xxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/audio/transcriptions` | **200 + CORS 全开**（ACAO、POST、authorization/content-type 均放行） |
| Aliyun PI `/compatible-mode/v1/chat/completions` | **200 + CORS 全开**（PI 整个对浏览器友好） |

**结论修正**：先前"REST STT 不行"是只测了**公共**端点（native `/api/v1` → 401）后过度泛化。公共 DashScope 确实只能走 WS（REST 两条路都死），但 **Aliyun PI 的兼容音频端点 CORS 全开、REST 可行**。所以 `whisper` 模式（OpenAI REST `/audio/transcriptions`）对 PI/OpenAI/Groq 都走得通；`stream`（WS）保留给只有公共 DashScope key、无 PI 的用户。决策：**双模式都保留**（用户 2026-07-17 拍板——"原来跑通的肯定要保留"）。

---

## 2. 数据模型：Settings 新字段

```ts
// domain/types.ts Settings 追加
sttMode: 'stream' | 'whisper'        // 默认 'stream'
sttUrl?: string                       // stream=DashScope WS base；whisper=OpenAI REST base
videoFrameIntervalSec: number         // 默认 10
videoVisionEnabled: boolean           // 默认 true
```

现有 `llmUrl / llmModel / apiKeyRef / sttModel / sttKeyRef` 不动。

`seedSettings` 默认：`sttMode: 'stream'`、`sttUrl: undefined`、`videoFrameIntervalSec: 10`、`videoVisionEnabled: true`、`llmUrl: ''`、`llmModel: ''`（改空，让用户填；`.env.local` 仍可填 DEV 便利）。

---

## 3. L1 LLM 通用化收尾

- 重命名 `src/adapters/deepSeekLlm.ts` → `openAiCompatLlm.ts`，导出 `openAiCompatLlm: LlmPort`
- `di.ts` 注入改 `openAiCompatLlm`
- `isDeepSeek` 守门保留（DeepSeek 私有参数兼容性，无害）
- settings UI placeholder 中性化（见 §7 T1）
- `devSeed` 默认改空（`seedSettings.llmUrl/llmModel` → 空串）
- settings UI 加 model 下拉预设 + 连通性测试按钮（见 §7 T1）

---

## 4. S1 STT 双模式

拆 `paraformerStt.ts` → 两个 adapter：

### 4.1 paraformerStreamStt（流式 WS，现状）
- `WS_BASE` 改读 `settings.sttUrl`（默认 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`）
- 协议不变（DashScope paraformer WS 特定：`?api_key=` query 鉴权 + run-task/finish-task + PCM 16k 推帧）
- blob→PCM、streamAsr 逻辑照搬 `paraformerStt.ts`

### 4.2 whisperRestStt（非流式 REST，通用）
```ts
async transcribe(ref) {
  const { sttUrl, sttModel } = await di.storage.getSettings()
  const apiKey = await di.secrets.get('stt:key')
  const blob = await di.storage.getMedia(ref)
  if (!apiKey || !sttUrl) throw new Error('Whisper STT 未配置（url/key 缺失）')
  const form = new FormData()
  form.append('file', blob, 'audio.webm')
  form.append('model', sttModel || 'whisper-1')
  form.append('response_format', 'text')
  const res = await fetch(`${sttUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Whisper STT ${res.status}: ${await res.text()}`)
  return (await res.text()).trim()
}
```
任意 OpenAI Whisper 兼容 endpoint（OpenAI / Groq / DashScope audio-compatible / 本地 whisper.cpp server）。

### 4.3 di 注入
```ts
function pickStt(settings): SttPort {
  return settings.sttMode === 'whisper' ? whisperRestStt : paraformerStreamStt
}
// store 调用前读 settings.sttMode 选 adapter（或 di 提供方法）
```
capture 实时预览（WebSpeech）不变。

---

## 5. V1 Vision

### 5.1 classify 附图（openAiCompatLlm.classify）
1. 读 `entry.parts`，筛 video parts（照片 durationSec=0 + 真视频）
2. `if (!settings.videoVisionEnabled)` → 跳过（纯文本，现状）
3. 照片：`getMedia` blob → canvas resize 1024px 长边 JPEG 0.8 → base64 data URL
4. 视频：抽帧（§6）→ 每帧 canvas 压缩 → base64
5. 组装 OpenAI 兼容 messages：
```jsonc
{ "role": "user", "content": [
  { "type": "text", "text": "<classify prompt + 图描述指令>" },
  { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } },
  // ... 每帧/每图一项
]}
```
6. 发给 chat completion（model 用户填，支持多模态就 work）
7. 图描述纳入 `EntryAi.summary / category`（prompt 要求 LLM 描述图内容用于分类 + 摘要）

### 5.2 降级
- 响应报错（model 不支持 `image_url`，常见 400 "image not supported"）→ catch 后去图重发纯文本（静默，不崩，不提示）

### 5.3 aggregate / answerChat 不附图
- 控成本（多图多帧 base64 爆）
- 图语义已通过 classify 进 `summary`，aggregate 基于 summary 间接含图
- answerChat 检索附图放 v1.1

---

## 6. 视频抽帧算法

```js
function pickFrameTimes(durationSec, intervalSec = 10, cap = 8) {
  if (durationSec <= 0) return []            // 照片不抽
  const times = new Set([0, durationSec])     // 首尾
  for (let t = intervalSec; t < durationSec; t += intervalSec) times.add(t)
  let arr = [...times].sort((a, b) => a - b)
  arr = arr.filter((t, i) => i === 0 || t - arr[i - 1] > 0.5)  // 去极近重合
  if (arr.length > cap) arr = sampleUniform(arr, cap)          // 超 cap 均匀采样（含首尾）
  return arr
}
```

抽帧实现（浏览器）：
```js
async function extractFrame(blob, timeSec) {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.src = url; video.muted = true
  await new Promise((r, rej) => { video.onloadedmetadata = r; video.onerror = rej })
  video.currentTime = Math.min(timeSec, Math.max(0, video.duration - 0.05))
  await new Promise((r, rej) => {
    const t = setTimeout(r, 3000)            // seek 超时兜底（移动端 onseeked 偶不稳）
    video.onseeked = () => { clearTimeout(t); r() }
    video.onerror = () => { clearTimeout(t); rej() }
  })
  const canvas = document.createElement('canvas')
  // resize 1024 长边
  const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight))
  canvas.width = video.videoWidth * scale
  canvas.height = video.videoHeight * scale
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
  const frameBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8))
  URL.revokeObjectURL(url)
  return frameBlob
}
```
OPFS blob 同源 → canvas 不污染 → `toBlob` 可用。

抽帧数（interval=10, cap=8）：
- 5s → 2（首尾）
- 20s → 3（首 + 10s + 尾）
- 60s → 7（首 + 10/20/30/40/50s + 尾）
- 600s → cap 8 均匀采样

---

## 7. 落地步骤

| 步骤 | 内容 | 谁 |
|------|------|----|
| 1 | 写本文档 | lead ✓ |
| 2 | `domain/types.ts` Settings 加 4 字段；`seed.ts` 默认 | lead |
| 3 | adapters：重命名 `openAiCompatLlm` + vision 附图/抽帧 + 拆 STT 双 adapter | lead |
| 4 | `di.ts` 按 `sttMode` 注入；store 不变（classify 调用不变，adapter 内附图） | lead |
| 5 | `npx tsc -p tsconfig.app.json` 绿 | lead |
| 6 | fan-out `settings/` subagent（T1） | subagent |
| 7 | `npm run typecheck` 集成 | lead |
| 8 | 验收 agent chrome-devtools 390×844 | subagent |
| 9 | commit（不 push 除非用户要） | lead |

### T1 `settings/` subagent 规格
**仅写 `src/ui/screens/settings/`，不碰共享层。**
- **LLM 区**：model 下拉（`<select>`）含 `deepseek-v4-flash` / `gpt-4o` / `claude-sonnet-5` / `qwen-plus` / `gemini-2-flash` / 自定义（自定义时显 `<input>`）。连通性测试按钮：调 `di.llm` 发 `{messages:[{role:'user',content:'ping'}], max_tokens:1}` → 显绿 ✓ + 延迟 ms 或红 ✗ + 错误。placeholder 中性化（url `https://…/v1/chat/completions`、model `model 名`、key `sk-…`）。
- **STT 区**：模式 segmented 切换（流式 / 非流式 Whisper）+ 按模式显隐 url/model/key。stream url placeholder `wss://…/api-ws/v1/inference`，whisper url placeholder `https://…/v1`。
- **视觉区**：`videoVisionEnabled` 开关 + `videoFrameIntervalSec` 输入（默认 10，单位秒）。

---

## 8. 风险与开放

| 风险 | 影响 | 缓解 |
|------|------|------|
| 视频抽帧浏览器兼容 | `<video>` + canvas seek，移动端 onseeked 偶不稳 | seek 超时兜底（3s）+ onerror reject |
| base64 体积 | 图 100-300KB；视频 cap 8 帧 ≈ 800KB-2.4MB | cap 8 + 压缩 1024 JPEG 0.8；超长视频均匀采样 |
| vision model 格式差异 | OpenAI `image_url` vs Claude `source` | BYOK 走 OpenAI 兼容代理统一 `image_url`；原生 Claude API 不走（非兼容） |
| 隐私：图/视频上云 | BYOK provider 看到私照 | onboarding/设置明示；用户自选 provider |
| Whisper REST 非流式 | transcribe 本就非流式（传 ref 返文本） | 无 UX 损失；capture 实时预览走 WebSpeech 不变 |
| DashScope WS endpoint 可配但协议特定 | 换非 DashScope WS provider 要换适配 | 未来；whisper 模式已通用 |
| model 不支持 vision | classify 报 400 | 静默降级去图纯文本（§5.2） |
