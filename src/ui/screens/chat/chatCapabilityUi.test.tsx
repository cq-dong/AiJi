import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { ChatMessage, Conversation } from '@/domain/types'

// 能力大补（2026-09-29）UI 行为测试：
// - 跨天分隔条：按消息本地日键派生，首条也插；label 今天/昨天/M月D日。
// - ActionConfirmBubble：pending/ambiguous 交互 + done/cancelled/notFound 终态。
// - LoadingBubble：weather/search 新相位文案。
// P-F（2026-10-04）：ActionConfirmBubble 扩展三 op——changeCategory（缺省）/ createReminder /
// deleteEntry；resolve 入口从 resolveCategoryAction 迁到 resolveChatAction（契约：
// createReminder 确认传 'confirm'，其余传 {entryId}，取消一律 'cancel'）。

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

function userMsg(id: string, createdAt: string): ChatMessage {
  return { id, role: 'user', content: `问-${id}`, createdAt }
}
function aiMsg(id: string, createdAt: string): ChatMessage {
  return { id, role: 'assistant', content: `答-${id}`, createdAt }
}
function actionMsg(id: string, action: NonNullable<ChatMessage['action']>): ChatMessage {
  return { id, role: 'assistant', content: '', createdAt: todayIso(), kind: 'actionConfirm', action }
}

function conversationOf(messages: ChatMessage[]): Conversation {
  return { id: 'c1', messages, updatedAt: messages[messages.length - 1]?.createdAt ?? todayIso() }
}

describe('chat 屏能力大补 UI', () => {
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

  // ── 跨天分隔条 ──

  it('同日多条消息 → 仅 1 个分隔条，label 为「今天」', async () => {
    render([userMsg('u1', todayIso()), aiMsg('a1', todayIso()), userMsg('u2', todayIso())])
    await mount()
    const seps = separators()
    expect(seps).toHaveLength(1)
    expect(seps[0]!.textContent).toContain('今天')
  })

  it('跨天 2 条消息（昨天+今天）→ 每天界 1 个，共 2 个分隔条', async () => {
    render([userMsg('u1', yesterdayIso()), aiMsg('a1', todayIso())])
    await mount()
    const seps = separators()
    expect(seps).toHaveLength(2)
    expect(seps[0]!.textContent).toContain('昨天')
    expect(seps[1]!.textContent).toContain('今天')
  })

  it('3 条消息 2 天（昨、昨、今）→ 2 个分隔条', async () => {
    render([userMsg('u1', yesterdayIso()), aiMsg('a1', yesterdayIso()), userMsg('u2', todayIso())])
    await mount()
    expect(separators()).toHaveLength(2)
  })

  // ── ActionConfirmBubble ──

  const pendingAction: NonNullable<ChatMessage['action']> = {
    entryHint: '桂花拿铁那条',
    status: 'pending',
    candidates: [{ entryId: 'e1', label: '桂花拿铁', fromCategory: '生活' }],
    toCategorySlug: 'mei-shi',
    toCategoryLabel: '美食',
    isNewCategory: true,
  }

  it('pending：渲染条目名 + 新分类 + 确认/取消按钮；确认回调 {entryId}', async () => {
    const resolveMock = vi.fn().mockResolvedValue(undefined)
    render([userMsg('u1', todayIso()), actionMsg('m-act', pendingAction)], {
      resolveChatAction: resolveMock,
    } as unknown as UiStatePatch)
    await mount()

    expect(container.textContent).toContain('桂花拿铁')
    expect(container.textContent).toContain('美食')
    expect(container.textContent).toContain('新类别')

    await click(buttonByText('确认'))
    expect(resolveMock).toHaveBeenCalledWith('m-act', { entryId: 'e1' })
  })

  it('pending：取消回调 \'cancel\'', async () => {
    const resolveMock = vi.fn().mockResolvedValue(undefined)
    render([actionMsg('m-act', pendingAction)], {
      resolveChatAction: resolveMock,
    } as unknown as UiStatePatch)
    await mount()

    await click(buttonByText('取消'))
    expect(resolveMock).toHaveBeenCalledWith('m-act', 'cancel')
  })

  it('ambiguous：候选列表 + 未选时确认 disabled；选中后确认传选中 entryId', async () => {
    const resolveMock = vi.fn().mockResolvedValue(undefined)
    render(
      [
        actionMsg('m-act', {
          entryHint: '拿铁',
          status: 'ambiguous',
          candidates: [
            { entryId: 'e1', label: '桂花拿铁', fromCategory: '生活' },
            { entryId: 'e2', label: '燕麦拿铁', fromCategory: '想法' },
          ],
          toCategorySlug: 'mei-shi',
          toCategoryLabel: '美食',
        }),
      ],
      { resolveChatAction: resolveMock } as unknown as UiStatePatch,
    )
    await mount()

    expect(container.textContent).toContain('你指的是哪一条？')
    expect(container.textContent).toContain('桂花拿铁')
    expect(container.textContent).toContain('燕麦拿铁')
    expect(container.textContent).toContain('想法')

    const confirmBtn = buttonByText('确认')
    expect(confirmBtn.disabled).toBe(true)

    // 选中第二条候选
    const candidateRow = Array.from(container.querySelectorAll('button')).find((x) =>
      x.textContent?.includes('燕麦拿铁'),
    )!
    await click(candidateRow)
    expect(buttonByText('确认').disabled).toBe(false)

    await click(buttonByText('确认'))
    expect(resolveMock).toHaveBeenCalledWith('m-act', { entryId: 'e2' })
  })

  // Finding 2（2026-09-29 rc9）：resolve 抛错时 busy 不得永真——catch 复位，按钮恢复可点，消息仍 pending。
  it('reject：resolveChatAction 抛错 → 按钮恢复可用，消息仍 pending', async () => {
    const resolveMock = vi.fn().mockRejectedValue(new Error('network down'))
    render([actionMsg('m-act', pendingAction)], {
      resolveChatAction: resolveMock,
    } as unknown as UiStatePatch)
    await mount()

    const confirmBtn = buttonByText('确认')
    expect(confirmBtn.disabled).toBe(false)
    await click(confirmBtn)
    expect(resolveMock).toHaveBeenCalledWith('m-act', { entryId: 'e1' })

    // 抛错已 catch 复位 busy：按钮恢复可用（不卡死至刷新）
    expect(buttonByText('确认').disabled).toBe(false)
    expect(buttonByText('取消').disabled).toBe(false)
    // 消息仍 pending（store 未改动，可重试）
    expect(useUiStore.getState().conversation!.messages.find((m) => m.id === 'm-act')!.action!.status).toBe('pending')
  })

  it('done：静态回执（条目 → 新分类），无按钮', async () => {
    render([
      actionMsg('m-act', {
        ...pendingAction,
        status: 'done',
      }),
    ])
    await mount()
    expect(container.textContent).toContain('桂花拿铁')
    expect(container.textContent).toContain('美食')
    expect(container.querySelector('[data-testid="date-separator"]')).toBeTruthy()
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '确认')).toBe(false)
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '取消')).toBe(false)
  })

  it('cancelled：静态「已取消」文案，无按钮', async () => {
    render([actionMsg('m-act', { ...pendingAction, status: 'cancelled' })])
    await mount()
    expect(container.textContent).toContain('好，没有改动。')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '确认')).toBe(false)
  })

  it('notFound：静态提示含条目线索，无按钮', async () => {
    render([actionMsg('m-act', { ...pendingAction, status: 'notFound', candidates: [] })])
    await mount()
    expect(container.textContent).toContain('桂花拿铁那条')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '确认')).toBe(false)
  })

  // ── P-F createReminder（2026-10-04）：无候选列表；确认传字面量 'confirm' ──

  // 本地时间 ISO（无 Z 后缀 → 本地解析），格式化结果「M/D HH:MM」与时区无关、断言稳定。
  const reminderAction: NonNullable<ChatMessage['action']> = {
    op: 'createReminder',
    entryHint: '交稿',
    status: 'pending',
    candidates: [],
    toCategorySlug: '',
    toCategoryLabel: '',
    reminderLabel: '交稿',
    reminderDueAt: '2026-10-06T15:00:00',
  }

  it('createReminder pending：渲染标题 + label + 本地化时间，无候选列表', async () => {
    render([actionMsg('m-act', reminderAction)], {
      resolveChatAction: vi.fn().mockResolvedValue(undefined),
    } as unknown as UiStatePatch)
    await mount()
    expect(container.textContent).toContain('建提醒')
    expect(container.textContent).toContain('交稿')
    expect(container.textContent).toContain('10/6 15:00')
    expect(container.textContent).not.toContain('你指的是哪一条？')
  })

  it('createReminder pending：确认传字面量 \'confirm\'', async () => {
    const resolveMock = vi.fn().mockResolvedValue(undefined)
    render([actionMsg('m-act', reminderAction)], {
      resolveChatAction: resolveMock,
    } as unknown as UiStatePatch)
    await mount()

    await click(buttonByText('确认'))
    expect(resolveMock).toHaveBeenCalledWith('m-act', 'confirm')
  })

  it('createReminder pending：取消传 \'cancel\'', async () => {
    const resolveMock = vi.fn().mockResolvedValue(undefined)
    render([actionMsg('m-act', reminderAction)], {
      resolveChatAction: resolveMock,
    } as unknown as UiStatePatch)
    await mount()

    await click(buttonByText('取消'))
    expect(resolveMock).toHaveBeenCalledWith('m-act', 'cancel')
  })

  it('createReminder pending：dueAt 缺失 → 防御渲染「时间未定」', async () => {
    render([actionMsg('m-act', { ...reminderAction, reminderDueAt: undefined })], {
      resolveChatAction: vi.fn().mockResolvedValue(undefined),
    } as unknown as UiStatePatch)
    await mount()
    expect(container.textContent).toContain('时间未定')
  })

  it('createReminder done：静态回执「已建提醒：label，time」，无按钮', async () => {
    render([actionMsg('m-act', { ...reminderAction, status: 'done' })])
    await mount()
    expect(container.textContent).toContain('已建提醒：交稿，10/6 15:00')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '确认')).toBe(false)
  })

  // ── P-F deleteEntry（2026-10-04）：警示色 + 回收站副文案；确认传 {entryId} ──

  const deleteAction: NonNullable<ChatMessage['action']> = {
    op: 'deleteEntry',
    entryHint: '桂花拿铁那条',
    status: 'pending',
    candidates: [{ entryId: 'e1', label: '桂花拿铁', fromCategory: '生活' }],
    toCategorySlug: '',
    toCategoryLabel: '',
  }

  it('deleteEntry pending：警示标题 + 条目名 + 回收站副文案；确认传 {entryId}', async () => {
    const resolveMock = vi.fn().mockResolvedValue(undefined)
    render([actionMsg('m-act', deleteAction)], {
      resolveChatAction: resolveMock,
    } as unknown as UiStatePatch)
    await mount()

    expect(container.textContent).toContain('删除条目')
    expect(container.textContent).toContain('桂花拿铁')
    expect(container.textContent).toContain('移到回收站，30 天内可恢复')
    // 警示色：catFail 染在标题行
    expect(container.querySelector('.text-catFail')).not.toBeNull()

    await click(buttonByText('确认'))
    expect(resolveMock).toHaveBeenCalledWith('m-act', { entryId: 'e1' })
  })

  it('deleteEntry ambiguous：候选列表 + 副文案；选中后确认传选中 {entryId}', async () => {
    const resolveMock = vi.fn().mockResolvedValue(undefined)
    render(
      [
        actionMsg('m-act', {
          ...deleteAction,
          status: 'ambiguous',
          candidates: [
            { entryId: 'e1', label: '桂花拿铁', fromCategory: '生活' },
            { entryId: 'e2', label: '燕麦拿铁', fromCategory: '想法' },
          ],
        }),
      ],
      { resolveChatAction: resolveMock } as unknown as UiStatePatch,
    )
    await mount()

    expect(container.textContent).toContain('你指的是哪一条？')
    expect(container.textContent).toContain('移到回收站，30 天内可恢复')
    expect(buttonByText('确认').disabled).toBe(true)

    const candidateRow = Array.from(container.querySelectorAll('button')).find((x) =>
      x.textContent?.includes('燕麦拿铁'),
    )!
    await click(candidateRow)
    await click(buttonByText('确认'))
    expect(resolveMock).toHaveBeenCalledWith('m-act', { entryId: 'e2' })
  })

  it('deleteEntry done：静态回执「已把《label》移到回收站」；notFound：delete 专属提示', async () => {
    render([
      actionMsg('m-done', { ...deleteAction, status: 'done' }),
      actionMsg('m-nf', { ...deleteAction, status: 'notFound', candidates: [] }),
    ])
    await mount()
    expect(container.textContent).toContain('已把《桂花拿铁》移到回收站')
    expect(container.textContent).toContain('可能已经被删过了')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '确认')).toBe(false)
  })

  // ── LoadingBubble 新相位 ──

  it('chatLoading=weather → 「查天气…」', async () => {
    render([userMsg('u1', todayIso())])
    await mount()
    await act(async () => {
      useUiStore.setState({ chatLoading: 'weather' } as unknown as UiStatePatch)
    })
    expect(container.textContent).toContain('查天气…')
  })

  it('chatLoading=search → 「搜网络…」', async () => {
    render([userMsg('u1', todayIso())])
    await mount()
    await act(async () => {
      useUiStore.setState({ chatLoading: 'search' } as unknown as UiStatePatch)
    })
    expect(container.textContent).toContain('搜网络…')
  })
})
