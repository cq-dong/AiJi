import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { ChatMessage, Conversation } from '@/domain/types'

// D1（2026-10-05）chat 消息窗口化（对照 home P-A PAGE=30，本屏 CHAT_WINDOW=50）：
// - >CHAT_WINDOW 条 → 只渲尾部窗口 + 顶部「加载更早」按钮显剩余数；点击 → limit 扩窗。
// - 窗口首条 prevDay=null 天然补 DateSeparator（截断的昨日组仍有自己的界）。
// - seenIds/streamLen/贴底滚动仍读全量 messages——流式消息（全量尾部）不被窗口截断。
// - 会话切换（conversation.id 变）→ limit 复位 CHAT_WINDOW。
// jsdom 无真实布局：滚动锚定（prevHeightRef + useLayoutEffect）只验不炸、state 迁移正确，不测像素。

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
import { t } from '@/app/i18n'
import Chat, { CHAT_WINDOW } from '@/ui/screens/chat'

type UiStatePatch = Parameters<typeof useUiStore.setState>[0]

const pad = (n: number) => String(n).padStart(2, '0')
// 本地正午 ISO（无 TZ 后缀 → new Date 按本地解析），避开时区边界的日期漂移。
function localNoon(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`
}
function todayIso(): string {
  return localNoon(new Date())
}
function yesterdayIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localNoon(d)
}

function msg(id: string, createdAt: string): ChatMessage {
  return { id, role: 'user', content: `msg-${id}`, createdAt }
}

// CHAT_WINDOW+10 条：前 30 条昨天、后 30 条今天（跨天验分隔条在窗口截断处仍补界）。
function sixtyMessages(): ChatMessage[] {
  const list: ChatMessage[] = []
  for (let i = 0; i < CHAT_WINDOW + 10; i++) {
    const id = `m${pad(i)}`
    list.push(msg(id, i < 30 ? yesterdayIso() : todayIso()))
  }
  return list
}

function conversationOf(id: string, messages: ChatMessage[]): Conversation {
  return { id, messages, updatedAt: messages[messages.length - 1]?.createdAt ?? todayIso() }
}

describe('chat 屏消息窗口化（D1）', () => {
  let container: HTMLDivElement
  let root: Root

  function render(messages: ChatMessage[], extra?: UiStatePatch) {
    useUiStore.setState({
      online: true,
      conversation: conversationOf('c1', messages),
      chatList: [],
      chatLoading: 'idle',
      entries: [],
      aiByEntry: {},
      memories: [],
      chatVoice: { recording: false, interim: '', finalized: '', micDenied: false },
      ...extra,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }

  async function mount() {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>,
      )
    })
  }

  async function click(el: Element) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  function buttonByText(text: string): HTMLButtonElement {
    const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.trim() === text)
    expect(b, `应存在按钮「${text}」`).toBeTruthy()
    return b!
  }

  function loadEarlierButton(): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.includes('加载更早'))
  }

  // 只发 user 消息的会话：UserBubble 根节点 className 含 justify-end，可结构计数。
  function userBubbleCount(): number {
    return container.querySelectorAll('.justify-end').length
  }

  function separators(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="date-separator"]'))
  }

  beforeEach(() => {
    setCurrentLang('zh') // 文案断言钉死中文（jsdom navigator.language 默认 en-US）
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('CHAT_WINDOW+10 条 → 只渲尾部 CHAT_WINDOW 条 + 顶部按钮显剩余 10', async () => {
    render(sixtyMessages())
    await mount()

    expect(userBubbleCount()).toBe(CHAT_WINDOW)
    // 窗口外的 m00..m09 不渲染；窗口首条 m10 起渲染（id 补零两位，无子串误伤）。
    expect(container.textContent).not.toContain('msg-m00')
    expect(container.textContent).not.toContain('msg-m09')
    expect(container.textContent).toContain('msg-m10')
    expect(container.textContent).toContain('msg-m59')
    // 顶部按钮文案 = 未渲染的更早消息数
    buttonByText(`加载更早的 ${60 - CHAT_WINDOW} 条消息`)
  })

  it('窗口首条 prevDay=null 天然补 DateSeparator（截断的昨日组仍有界）', async () => {
    render(sixtyMessages())
    await mount()

    // 窗口 m10..m59：昨 20 条 + 今 30 条 → 两个界，首个是昨天（截断组也补）。
    const seps = separators()
    expect(seps).toHaveLength(2)
    expect(seps[0]!.textContent).toContain('昨天')
    expect(seps[1]!.textContent).toContain('今天')
  })

  it('点击「加载更早」→ 渲染数增至全量、按钮消失（jsdom 滚动锚定不炸）', async () => {
    render(sixtyMessages())
    await mount()

    await click(buttonByText(`加载更早的 ${60 - CHAT_WINDOW} 条消息`))

    expect(userBubbleCount()).toBe(CHAT_WINDOW + 10)
    expect(container.textContent).toContain('msg-m00')
    expect(loadEarlierButton()).toBeUndefined()
  })

  it('流式消息在全量尾部 → 不被窗口截断', async () => {
    const msgs = sixtyMessages()
    msgs[CHAT_WINDOW + 9] = {
      id: 'm59',
      role: 'assistant',
      content: '流式尾巴',
      createdAt: todayIso(),
      streaming: true,
    }
    render(msgs)
    await mount()

    // 窗口只留尾部 50 条（m00..m09 被截），流式消息在尾部必渲染。
    expect(container.textContent).not.toContain('msg-m00')
    expect(container.textContent).toContain('流式尾巴')
  })

  it('会话切换（conversation.id 变）→ limit 复位 CHAT_WINDOW', async () => {
    render(sixtyMessages())
    await mount()

    // 先扩窗到全量
    await click(buttonByText(`加载更早的 ${60 - CHAT_WINDOW} 条消息`))
    expect(userBubbleCount()).toBe(CHAT_WINDOW + 10)

    // 换会话（新 id 同消息集）→ 窗口复位，按钮重现
    await act(async () => {
      useUiStore.setState({ conversation: conversationOf('c2', sixtyMessages()) })
    })
    expect(userBubbleCount()).toBe(CHAT_WINDOW)
    buttonByText(`加载更早的 ${60 - CHAT_WINDOW} 条消息`)
  })

  it('i18n：chat.loadEarlier / chat.action.delete.bin 双 key zh+en 均存在', () => {
    setCurrentLang('zh')
    expect(t('chat.loadEarlier', { count: 10 })).toBe('加载更早的 10 条消息')
    expect(t('chat.action.delete.bin')).toBe('回收站')
    setCurrentLang('en')
    expect(t('chat.loadEarlier', { count: 10 })).toBe('Load 10 earlier messages')
    expect(t('chat.action.delete.bin')).toBe('Trash')
    setCurrentLang('zh')
  })
})
