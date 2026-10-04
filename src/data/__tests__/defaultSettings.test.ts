import { describe, it, expect } from 'vitest'
import { seedSettings } from '@/data/defaultSettings'
import { seedSettings as seedSettingsFromSeed } from '@/data/seed'

// d1-perf (a)：seedSettings 独立成模块——store.ts/devSeed.ts 静态 import 只拉
// defaultSettings，不再把整个 seed.ts（全部样例条目）拖进主 chunk。
// seed.ts 保持 re-export，既有动态导入方（dexieStorage）零改动。
describe('defaultSettings module (d1-perf a)', () => {
  it('seed.ts re-export 与 defaultSettings 导出恒等（同一对象引用）', () => {
    expect(seedSettingsFromSeed).toBe(seedSettings)
  })

  it('seedSettings top-level keys 一枚不缺（防剪切时漏字段）', () => {
    expect(Object.keys(seedSettings).sort()).toEqual(
      [
        'aggregateDetailLevel',
        'apiKeyRef',
        'dailyReminder',
        'geocodingKeyRef',
        'keySource',
        'llmModel',
        'llmProvider',
        'llmUrl',
        'onboarded',
        'recordLocation',
        'sttKeyRef',
        'sttMode',
        'sttModel',
        'sttProvider',
        'sttUrl',
        'theme',
        'videoFrameIntervalSec',
        'videoVisionEnabled',
        'vlmKeyRef',
        'vlmModel',
        'vlmProvider',
        'vlmUrl',
      ].sort(),
    )
  })
})
