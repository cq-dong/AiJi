# STT 终稿 — DashScope paraformer-realtime-v2 WS 协议（已验通，存档）

> 用户在另一 session 验通此协议（2026-07-16）。AiJi 的 Option A 适配器（`src/adapters/paraformerStt.ts`）已按此协议写完，但**当前 deferred**（用户指示"先不管这个"），整批 STT 工作 stash 在 `stash@{0}`。本文件是唯一存档——队友无记忆，resume 前先读此。

## 为什么 WS 能直连（REST 不能）

- **WS 不走 CORS 预检**（无 OPTIONS 闸门）→ 浏览器可直连。
- **REST 死在 CORS 预检**：浏览器没法在 preflight 上放 `Authorization` → DashScope REST 被挡。
- DashScope WS 接受 `?api_key=<key>` query 鉴权（探了 4 个名字，只有 `api_key` 通）→ `new WebSocket("wss://...?api_key=…")`，**不要自定义头**（浏览器 WebSocket 设不了）。
- 注意 host 分裂：REST 用 workspace host（`llm-….maas.aliyuncs.com`），WS 用 dashscope host（`dashscope.aliyuncs.com`）。workspace key 在 WS host 也能用。

## 已验通协议（写适配器照抄）

**握手**：
```
wss://dashscope.aliyuncs.com/api-ws/v1/inference?api_key=<key>
```

**run-task**（open 后立即发）：
```json
{
  "header": { "action": "run-task", "task_id": "<uuid>", "streaming": "duplex" },
  "payload": {
    "task_group": "audio",
    "task": "asr",
    "function": "recognition",
    "model": "paraformer-realtime-v2",
    "parameters": {
      "format": "pcm",
      "sample_rate": 16000,
      "enable_punctuation_prediction": true,
      "language_hints": ["zh", "en"]
    },
    "input": {}
  }
}
```

**推 PCM 二进制帧**：16kHz 单声道 16-bit。分块推（适配器用 3200 样本/帧）。→ 服务端增量 `result-generated`，`payload.output.sentence.text` 滚动生长（`sentence_end: false`）。

**finish-task**（音频推完发）：
```json
{ "header": { "action": "finish-task", "task_id": "<uuid>" }, "payload": { "input": {} } } }
```
⚠️ `payload.input:{}` **不能漏**，否则报 `Missing required parameter 'payload.input'`。→ 收 `sentence_end: true` 最终句 + `task-finished`。

**事件**：`result-generated`（累积句）/ `task-failed`（reject）/ `task-finished`（resolve）。

## AiJi 接法（Option A，已写完在 stash 里）

`src/adapters/paraformerStt.ts` 实现 `SttPort.transcribe(ref)`：
1. `di.storage.getMedia(ref)` 取 OPFS blob（webm/opus）。
2. `AudioContext.decodeAudioData` 解码 → `OfflineAudioContext` 重采样 16k 单声道 → Float32→Int16。
3. 开 WS（`?api_key=`）→ run-task → 分块推 PCM → finish-task。
4. 拼 `sentence_end` 句返回。

**BYOK**：key 存 `SecretStorePort('stt:key')`；settings 加 STT 区块（`SttSheet`，照 LLM 区块抄）；`Settings.sttModel`/`sttKeyRef`。key 缺失 → throw，管线 catch 标 failed（跟 `deepSeekLlm.ts` 同款降级）。

**集成点**（`store.processEntry`，已在 stash 里改好）：classify 前，若 `stt:key` 存在 → 对每条 audio/video part 跑 `di.stt.transcribe(ref)` 重写 `transcript`（终稿比 WebSpeech live 预览准）→ saveEntry → 再 classify。无 key 跳过整步（用 WebSpeech 预览文本分类即可）；单 part 失败回退预览文本，不阻断分类。

## Option A vs B（用户已选 A，B 后置）

- **A. 只做离线 SttPort**（已实现，deferred）：保 WebSpeech 做 live interim，paraformer 负责保存后高精度转写录制 blob。改动小、不碰 Phase 3 录音链路、零回归风险。← 当前
- **B. WS 也喂实时麦克风帧**做 live interim（替代 WebSpeech，质量更高、多语 zh/en/ja/yue/ko…）。后置，待用户要。

## Resume 步骤（用户说"做 STT"时）

```sh
git stash pop    # 恢复 paraformerStt.ts + di/store/seed/types/settings 的 STT 改动
npx tsc -p tsconfig.app.json   # 应 EXIT=0（stash 前是绿的，但 STT 改动未在 UI 验过）
```
然后浏览器验收：
1. 设置 → 音频转写模型 → 填 `paraformer-realtime-v2` + DashScope key（用户自己填，BYOK）。
2. 采集 → 录一段语音（WebSpeech live 预览）→ 保存。
3. console 应见 `processEntry` 跑 STT 终稿（paraformer 重写 transcript）→ DeepSeek classify → 详情 AI 面板用终稿文本。
4. 无 key 时：保存后 STT 跳过，用 WebSpeech 预览文本分类，不报错。

**Stash 标识**：`stash@{0}: On main: STT paraformer Option A (deferred per user 2026-07-16)`。
