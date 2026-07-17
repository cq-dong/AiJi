# 多模态 + 通用 BYOK · 验收清单

> 范围：①LLM 通用化收尾（重命名+下拉+ping）②STT 双模式（stream WS / whisper REST）③Vision（classify 附图/视频帧）。
> 共享层已落地并 `npx tsc -p tsconfig.app.json` 绿。本清单验 UI 行为 + 持久化 + 构建，深路径（真 STT/真 vision）标 manual。

## 环境前置
- dev server：`npm run dev`（5173/5174），视口 390×844（chrome-devtools-mcp / Playwright）。
- DeepSeek dev key 已在 `.env.local`（`VITE_LLM_KEY/URL/MODEL`）→ 设置页 LLM 区应显「已配置」。
- STT 视模式：stream 用 `.env.local` 的 DashScope key；whisper 需手填 PI url+key（用户给 PI host，未给 key → manual）。

## A. 共享层静态验收（lead 已自检，复核）
- [ ] `npx tsc -p tsconfig.app.json` 干净（无 error）。
- [ ] `npm run build` 成功（确认 git-mv 后 `openAiCompatLlm` / `paraformerStreamStt` / `whisperRestStt` / `visionMedia` 模块 resolve 正常，无残留 `deepSeekLlm`/`paraformerStt` 引用）。
- [ ] `grep -rn "deepSeekLlm\|from '@/adapters/paraformerStt'" src/` → 0 命中（旧名清零）。

## B. Settings 屏 UI 行为（chrome-devtools 390×844）
- [ ] 屏渲染三区：LLM / STT / 视觉，无 statusbar/nav/Fab 重复（AppShell 提供）。
- [ ] **LLM model 下拉**：切预设（deepseek-v4-flash/gpt-4o/claude-sonnet-5/qwen-plus/gemini-2-flash）→ 选「自定义…」显文本输入；切回预设隐藏。
- [ ] **LLM 连通测试**：点「测试连通」→ 按钮变「测试中…」禁用 → 配置正确时显绿 ✓ + `{ms}ms`；填错 url 显红 ✗ + error 原文（如 HTTP 401/404）。
- [ ] **STT 模式 segmented**：切「流式 / Whisper」→ 立即持久；切后 url 占位/help 文按模式变（stream: `wss://…/api-ws/v1/inference` +「留空=默认端点」；whisper: `https://…/v1` +「OpenAI 兼容 REST base，如 Aliyun PI 的 /compatible-mode/v1」）。
- [ ] **视觉区**：videoVisionEnabled 开关切 → 持久；关时「视频抽帧间隔」输入禁用灰显；开时改值（1-60 clamp）持久。
- [ ] **持久化**：改任一上述项 → 刷新页面 → 值保留（Dexie settings 行已落库）。

## C. 深路径（manual / 需配置真 key，验收 agent 能跑则跑，不能则记 manual）
- [ ] **STT stream 路径**：录一条语音条目保存 → store 调 `di.stt.transcribe` → 走 paraformerStreamStt WS → transcript 入 EntryPart.transcript（detail 屏可见）。`.env.local` DashScope key 可用时跑。
- [ ] **STT whisper 路径**：设置切 whisper + 填 PI `https://llm-xxx…/compatible-mode/v1` + PI key + model `whisper-1`（或 PI 支持的 audio model）→ 录一条保存 → REST `/audio/transcriptions` → transcript。PI key 未给 → 标 manual，用户配置后自测。
- [ ] **Vision 路径**：新建含照片（durationSec=0）或短视频的条目 → 保存 → classify 附 image_url → EntryAi.summary/category 反映图内容（非空、非纯文本兜底）。用配置好的多模态 model 测；单模态 model 应静默降级纯文本不崩（console 不报错且条目不 failed）。
- [ ] **降级**：LLM model 填不支持 image_url 的（如 deepseek-v4-flash 纯文本）+ 视觉开 → classify 应自动去图重发纯文本成功（条目 ready 非 failed）。

## D. 回归（不破既有）
- [ ] 摘要屏聚合（aggregate）仍 work（LLM 通用化未动 prompt 逻辑）。
- [ ] AI Chat（parseChatIntent/answerChat）仍 work（未附图，逻辑未动）。
- [ ] 既有 LLM 配置（DeepSeek url/model/key）保存后仍能 classify（ping 绿即基本可判）。

## 缺陷回流
新缺陷追加到 `docs/acceptance/defects.md`，标 `[multimodal]` 前缀 + file:line + 严重度（blocker/major/minor）+ 触发链。修后全量复验（非抽查）。
