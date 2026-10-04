// 默认设置（非样例数据）——d1-perf 起从 seed.ts 独立成模块：store.ts/devSeed.ts
// 静态 import 只拉本文件，不再把整个 seed.ts（全部样例条目）拖进主 chunk。
// seed.ts 对本模块做 re-export，既有动态导入方（dexieStorage）零改动。
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
  aggregateDetailLevel: 3 as const,
  onboarded: false,
  sttMode: 'stream' as const,
  sttUrl: undefined,
  videoVisionEnabled: true,
  videoFrameIntervalSec: 10,
  vlmProvider: 'VLM · BYOK',
  vlmUrl: undefined,
  vlmModel: undefined,
  vlmKeyRef: undefined,
  geocodingKeyRef: undefined,
  keySource: 'byok' as const,
}
