// D30: 内置默认端点（CI 构建时从 VITE_* env 烘入）。开箱即用——用户未手动配置时
// 适配器回落这些默认 URL/model；用户在「设置」自配的值仍优先（settings.vlmUrl/sttUrl 非空则用之）。
// 与 geocoding.ts 的 BUILTIN_GAODE_KEY 同模式：env 默认 + 用户可覆盖。
//
// 仅烘 URL/model（端点公开，非密钥）；BYOK Key 仍走 SecretStorePort 用户自配，不烘入。
// 本地 dev 未注入 env → 空串，适配器回落各自硬编码的公共端点（paraformerStreamStt 的 DEFAULT_WS_BASE 等）。

// VLM（视觉多模态）默认端点。典型：阿里云 DashScope compatible-mode。
export const BUILTIN_VLM_URL = (import.meta.env.VITE_VLM_URL as string | undefined) ?? ''
export const BUILTIN_VLM_MODEL = (import.meta.env.VITE_VLM_MODEL as string | undefined) ?? ''

// STT 默认端点。stream 模式=DashScope WS；whisper 模式=OpenAI 兼容 REST base。
export const BUILTIN_STT_URL_STREAM = (import.meta.env.VITE_STT_URL_STREAM as string | undefined) ?? ''
export const BUILTIN_STT_URL_WHISPER = (import.meta.env.VITE_STT_URL_WHISPER as string | undefined) ?? ''
export const BUILTIN_STT_MODEL_STREAM = (import.meta.env.VITE_STT_MODEL_STREAM as string | undefined) ?? ''
export const BUILTIN_STT_MODEL_WHISPER = (import.meta.env.VITE_STT_MODEL_WHISPER as string | undefined) ?? ''

// LLM（文本模型）默认端点——与 DeepSeek seed 对齐，env 可覆盖（如切到自部署端点）。
export const BUILTIN_LLM_URL = (import.meta.env.VITE_LLM_URL as string | undefined) ?? ''
export const BUILTIN_LLM_MODEL = (import.meta.env.VITE_LLM_MODEL as string | undefined) ?? ''
