// PRD trust pack t1（2026-10-05）：详情页 AI 面板上送行（隐私标识）。
// 契约：docs/acceptance/prd-trust-pack.md §范围③a / §测试要点 t1。
// - 含/不含媒体两态：含 audio/video part → 追加 STT/VLM 后缀；纯文本 → 仅上行。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/app/di', () => ({
  di: { llm: {}, storage: {} },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { AiUploadLine } from '@/ui/screens/detail/index'
import { setCurrentLang } from '@/app/currentLang'

describe('AiUploadLine 上送行（detail 隐私标识）', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    setCurrentLang('zh')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount()
      })
      root = null
    }
    container.remove()
  })

  it('纯文本条目：仅上送行（含真实 modelUsed）', async () => {
    await act(async () => {
      root!.render(<AiUploadLine model="deepseek-v4-flash" hasMedia={false} />)
    })
    const text = container.textContent ?? ''
    expect(text).toBe('文本与转写已上送 deepseek-v4-flash')
  })

  it('含音视频条目：追加 STT/VLM 后缀', async () => {
    await act(async () => {
      root!.render(<AiUploadLine model="builtin-llm" hasMedia={true} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('文本与转写已上送 builtin-llm')
    expect(text).toContain('STT/VLM')
  })
})
