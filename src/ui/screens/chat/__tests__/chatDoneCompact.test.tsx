import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { ChatMessage, Conversation } from '@/domain/types'

// D1（2026-10-05，P-F MINOR-1）done 卡紧凑化：
// createReminder/deleteEntry 的 done 卡原渲染 chat.action.reminder.done / chat.action.delete.done
// 全句——与 store 追加的独立回执消息同一句文案，屏上出现两遍。对齐 changeCategory done 的
// 紧凑式（✓ 纯数据，与回执句互补）：卡=紧凑数据，全句只由 store 回执消息承载。
// - createReminder done：「✓ {label} · {dueText}」，不再渲全句。
// - deleteEntry done：「✓ 《{label}》→「回收站」」（chat.action.delete.bin），不再渲全句。
// cancelled/notFound/pending/ambiguous 各态零改动（既有 chatCapabilityUi 测试兜底）。

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

type UiStatePatch = Parameters<typeof useUiStore.setState>[0]

const pad = (n: number) => String(n).padStart(2, '0')
function localNoon(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`
}
function todayIso(): string {
  return localNoon(new Date())
}

function actionMsg(id: string, action: NonNullable<ChatMessage['action']>): ChatMessage {
  return { id, role: 'assistant', content: '', createdAt: todayIso(), kind: 'actionConfirm', action }
}

function conversationOf(messages: ChatMessage[]): Conversation {
  return { id: 'c1', messages, updatedAt: messages[messages.length - 1]?.createdAt ?? todayIso() }
}

describe('chat done 卡紧凑化（D1 / P-F MINOR-1）', () => {
  let container: HTMLDivElement
  let root: Root

  function render(messages: ChatMessage[], extra?: UiStatePatch) {
    useUiStore.setState({
      online: true,
      conversation: conversationOf(messages),
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

  beforeEach(() => {
    setCurrentLang('zh') // 文案断言钉死中文（jsdom navigator.language 默认 en-US）
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  // 本地时间 ISO（无 Z 后缀 → 本地解析），格式化结果「M/D HH:MM」与时区无关、断言稳定。
  const reminderDone: NonNullable<ChatMessage['action']> = {
    op: 'createReminder',
    entryHint: '交稿',
    status: 'done',
    candidates: [],
    toCategorySlug: '',
    toCategoryLabel: '',
    reminderLabel: '交稿',
    reminderDueAt: '2026-10-06T15:00:00',
  }

  const deleteDone: NonNullable<ChatMessage['action']> = {
    op: 'deleteEntry',
    entryHint: '桂花拿铁那条',
    status: 'done',
    candidates: [{ entryId: 'e1', label: '桂花拿铁', fromCategory: '生活' }],
    toCategorySlug: '',
    toCategoryLabel: '',
  }

  it('createReminder done：紧凑「label · time」，不含 chat.action.reminder.done 全句', async () => {
    render([actionMsg('m-act', reminderDone)])
    await mount()

    expect(container.textContent).toContain('交稿 · 10/6 15:00')
    expect(container.textContent).not.toContain('已建提醒')
    // 终态静态回执无按钮
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '确认')).toBe(false)
  })

  it('deleteEntry done：紧凑「《label》→「回收站」」，不含 chat.action.delete.done 全句', async () => {
    render([actionMsg('m-act', deleteDone)])
    await mount()

    expect(container.textContent).toContain('《桂花拿铁》')
    expect(container.textContent).toContain('→ 「回收站」')
    expect(container.textContent).not.toContain('已把《桂花拿铁》移到回收站')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '确认')).toBe(false)
  })

  it('deleteEntry done：candidates 空 → 回退 entryHint（防御）', async () => {
    render([actionMsg('m-act', { ...deleteDone, candidates: [] })])
    await mount()

    expect(container.textContent).toContain('《桂花拿铁那条》')
    expect(container.textContent).toContain('→ 「回收站」')
  })
})
