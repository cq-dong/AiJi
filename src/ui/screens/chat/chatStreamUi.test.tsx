import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Conversation } from '@/domain/types'

// m10/m12（2026-09-28 流式验收）UI 行为回归：
// - m10：流式增量滚动「贴底才跟」——用户上翻阅读历史时不被拽回底部。
// - m12：流式期间有 reasoning → TracePanel 强制展开；finalize 后回归手动控制（默认折叠）。

// 最小 di mock（store import 需要；本测试不触发 LLM/存储调用）
vi.mock('@/app/di', () => ({
  di: {
    llm: {},
    storage: {},
  },
}))

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import Chat from '@/ui/screens/chat'

function conversationWithStreaming(): Conversation {
  return {
    id: 'c1',
    messages: [
      { id: 'u1', role: 'user', content: '问', createdAt: '2026-09-28T00:00:00.000Z' },
      {
        id: 'a1',
        role: 'assistant',
        content: '正在',
        createdAt: '2026-09-28T00:00:01.000Z',
        streaming: true,
        trace: { recalled: [], reasoning: '思考中-逐步推理' },
      },
    ],
    updatedAt: '2026-09-28T00:00:01.000Z',
  }
}

describe('chat 屏流式 UI 行为', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    setCurrentLang('zh') // 文案断言钉死中文（jsdom navigator.language 默认 en-US）
    useUiStore.setState({
      online: true,
      conversation: conversationWithStreaming(),
      chatList: [],
      chatLoading: 'answer',
      entries: [],
      aiByEntry: {},
      memories: [],
      chatVoice: { recording: false, interim: '', finalized: '', micDenied: false },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>,
      )
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  function scrollEl(): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(el).toBeTruthy()
    return el!
  }

  it('m10: 流式增量滚动——贴底才跟，用户上翻不拽回', async () => {
    const el = scrollEl()
    // jsdom 无布局：手填滚动度量（viewport 400 / 内容 1000）
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true })

    // 用户贴底（1000-600-400=0 < 阈值）→ 流式增量跟到底
    el.scrollTop = 600
    await act(async () => {
      el.dispatchEvent(new Event('scroll'))
    })
    await act(async () => {
      useUiStore.getState().updateChatMessage('a1', { content: '正在输出更多内容' })
    })
    expect(el.scrollTop).toBe(1000)

    // 用户上翻（1000-100-400=500 远离底部）→ 流式增量不拽回
    el.scrollTop = 100
    await act(async () => {
      el.dispatchEvent(new Event('scroll'))
    })
    await act(async () => {
      useUiStore.getState().updateChatMessage('a1', { content: '正在输出更多更多更多内容' })
    })
    expect(el.scrollTop).toBe(100)

    // 用户滚回底部 → 恢复跟随
    el.scrollTop = 580
    await act(async () => {
      el.dispatchEvent(new Event('scroll'))
    })
    await act(async () => {
      useUiStore.getState().updateChatMessage('a1', { content: 'x' })
    })
    expect(el.scrollTop).toBe(1000)
  })

  it('m12: 流式有 reasoning → TracePanel 强制展开；finalize 后回归默认折叠', async () => {
    // streaming=true + reasoning 非空 → 推理全文直接可见（无需手动展开）
    expect(container.textContent).toContain('思考中-逐步推理')

    // finalize（streaming:false）→ 回归用户手动控制，默认折叠 → 推理全文收起
    await act(async () => {
      useUiStore.getState().updateChatMessage('a1', { streaming: false })
    })
    expect(container.textContent).not.toContain('思考中-逐步推理')
    // trace 折叠开关仍在（用户可手动展开回看）
    expect(container.textContent).toContain('过程')
  })
})
