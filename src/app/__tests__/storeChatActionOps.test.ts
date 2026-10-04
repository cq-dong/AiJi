import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Aggregate, Category, ChatAnswer, ChatMessage, ChatQuery, Conversation, Entry, EntryAi, Reminder } from '@/domain/types'

// ── P-F ③ chat action 扩展（op:createReminder / op:deleteEntry）store 编排测试 ──
// spec: docs/acceptance/pf-companion-pack.md §③。骨架照抄 storeChatCapabilities.test.ts；
// 增量 mock：di.storage.saveReminder/trashEntry + di.localNotifications（建提醒链路）。

const mocks = vi.hoisted(() => ({
  parseChatIntent: vi.fn(),
  answerChat: vi.fn(),
  extractMemory: vi.fn(),
  aggregate: vi.fn(),
  saveConversation: vi.fn(),
  listConversations: vi.fn(),
  getEntry: vi.fn(),
  getEntryAi: vi.fn(),
  saveEntryAi: vi.fn(),
  saveCategory: vi.fn(),
  getAggregate: vi.fn(),
  saveAggregate: vi.fn(),
  saveSettings: vi.fn(),
  saveReminder: vi.fn(),
  trashEntry: vi.fn(),
  localRecall: vi.fn(),
  requestPermission: vi.fn(),
  lnSchedule: vi.fn(),
  lnCancel: vi.fn(),
  lnNotify: vi.fn(),
  conversations: [] as Conversation[],
}))

function upsert(arr: Conversation[], c: Conversation): void {
  const i = arr.findIndex((x) => x.id === c.id)
  if (i >= 0) arr[i] = c
  else arr.unshift(c)
}

vi.mock('@/app/di', () => ({
  di: {
    llm: {
      parseChatIntent: (...a: unknown[]) => mocks.parseChatIntent(...a),
      answerChat: (...a: unknown[]) => mocks.answerChat(...a),
      extractMemory: (t: string) => mocks.extractMemory(t),
      aggregate: (...a: unknown[]) => mocks.aggregate(...a),
    },
    storage: {
      saveConversation: async (c: Conversation) => {
        mocks.saveConversation(c)
        upsert(mocks.conversations, c)
      },
      listConversations: async () => {
        mocks.listConversations()
        return [...mocks.conversations].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
      },
      getEntry: (id: string) => mocks.getEntry(id),
      getEntryAi: (id: string) => mocks.getEntryAi(id),
      saveEntryAi: (ai: EntryAi) => mocks.saveEntryAi(ai),
      saveCategory: (c: Category) => mocks.saveCategory(c),
      getAggregate: (s: string, r: string) => mocks.getAggregate(s, r),
      saveAggregate: async (a: Aggregate) => { mocks.saveAggregate(a) },
      saveSettings: async (s: unknown) => { mocks.saveSettings(s) },
      // 直接 return mock 结果——`async () => { mock() }` 会吞掉 rejection（抛错用例无法触发 catch）。
      saveReminder: (r: Reminder) => mocks.saveReminder(r),
      trashEntry: (id: string) => mocks.trashEntry(id),
      purgeExpired: vi.fn().mockResolvedValue(0),
      listEntries: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({}),
      listCategories: vi.fn().mockResolvedValue([]),
      listTags: vi.fn().mockResolvedValue([]),
      listAggregates: vi.fn().mockResolvedValue([]),
      listReminders: vi.fn().mockResolvedValue([]),
      listDrafts: vi.fn().mockResolvedValue([]),
      listTrashed: vi.fn().mockResolvedValue([]),
      listMemories: vi.fn().mockResolvedValue([]),
      getDraft: vi.fn().mockResolvedValue(undefined),
    },
    localNotifications: {
      requestPermission: () => mocks.requestPermission(),
      schedule: (r: Reminder) => mocks.lnSchedule(r),
      cancel: (id: string) => mocks.lnCancel(id),
      notify: (title: string, body: string, id: string) => mocks.lnNotify(title, body, id),
    },
  },
}))

vi.mock('@/ui/screens/chat/helpers', async (importOriginal) => {
  // 部分 mock：localRecall 受控；dateKey/currentTimeLine/resolveActionCategory 走真实实现。
  const actual = await importOriginal<typeof import('@/ui/screens/chat/helpers')>()
  return { ...actual, localRecall: (...a: unknown[]) => mocks.localRecall(...a) }
})

import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import { t } from '@/app/i18n'

async function flushMicro(ticks = 20): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

function mkEntry(id: string, createdAt = '2026-09-28T10:00:00+08:00'): Entry {
  return { id, createdAt, updatedAt: createdAt, parts: [{ type: 'text', content: `${id} 原文` }], status: 'ready' }
}

function mkAi(entryId: string, patch?: Partial<EntryAi>): EntryAi {
  return { id: `ai-${entryId}`, entryId, version: 1, category: 'idea', tags: [], facets: {}, modelUsed: 'test', createdAt: '2026-09-28T10:00:00+08:00', ...patch }
}

const foodCat: Category = { slug: 'food', label: '美食', aliases: [], usageCount: 2, createdAt: '2026-01-01T00:00:00.000Z' }
const e1Cite = { id: 'e1', createdAt: '2026-09-28', categorySlug: 'idea', tags: [], textExcerpt: '今天喝了桂花拿铁，很好喝' }

// 到期时间短格式（与 store 回执同式：M/D HH:MM，本地时区）——tz 无关断言。
function fmtDue(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.conversations.length = 0
  window.localStorage.clear()
  // 断言中文文案（回执/模板追问），固定 zh（jsdom navigator.language=en-US）。
  setCurrentLang('zh')
  useUiStore.setState({
    online: true,
    conversation: null,
    chatList: [],
    chatLoading: 'idle',
    entries: [mkEntry('e1')],
    aiByEntry: { e1: mkAi('e1', { titleSuggestion: '桂花拿铁测评', category: 'idea' }) },
    categories: [foodCat],
    tags: [],
    aggregates: [],
    reminders: [],
    trashed: [],
    memories: [],
    hydrated: true,
  })
  // 默认：recall 意图 + 一条受控 cite（缓存预热用）；action 用例内各自覆写 parseChatIntent。
  mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: [], categorySlugs: undefined } as ChatQuery)
  mocks.answerChat.mockResolvedValue({ answer: '好的', citedEntryIds: [] } as ChatAnswer)
  mocks.extractMemory.mockResolvedValue(null)
  mocks.localRecall.mockReturnValue([e1Cite])
  mocks.getAggregate.mockResolvedValue(undefined)
  mocks.requestPermission.mockResolvedValue(true)
  mocks.saveReminder.mockResolvedValue(undefined)
  mocks.trashEntry.mockResolvedValue(undefined)
  // scheduleReminders（store.ts:237）对 schedule 返回值链 .catch——裸 vi.fn() 返 undefined 会抛。
  mocks.lnSchedule.mockResolvedValue(undefined)
  mocks.lnCancel.mockResolvedValue(undefined)
  mocks.lnNotify.mockResolvedValue(undefined)
})

// chatAnswerCache 是 store.ts 模块级 Map，跨用例持久。各用例用不同问题串避免缓存命中。

describe('sendMessage · op=createReminder', () => {
  const DUE = '2099-01-01T15:00:00+08:00'

  it('dueAt 齐 → pending 确认卡（无条目解析：localRecall 未调；不调 answerChat/不写缓存）', async () => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: ['交稿'],
      kind: 'action',
      action: { op: 'createReminder', entryHint: '', reminderLabel: '交稿', dueAt: DUE },
    } as ChatQuery)
    await useUiStore.getState().sendMessage('明天下午三点提醒我交稿-cr1')

    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.length).toBe(2)
    const card = msgs.at(-1)!
    expect(card.kind).toBe('actionConfirm')
    expect(card.action).toEqual({
      op: 'createReminder',
      entryHint: '',
      status: 'pending',
      candidates: [],
      toCategorySlug: '',
      toCategoryLabel: '',
      reminderLabel: '交稿',
      reminderDueAt: DUE,
    })
    expect(card.trace?.intent?.kind).toBe('action')
    expect(card.trace?.recalled).toEqual([]) // 无条目解析
    expect(mocks.localRecall).not.toHaveBeenCalled()
    expect(mocks.answerChat).not.toHaveBeenCalled()
    expect(useUiStore.getState().chatLoading).toBe('idle')

    // 不落缓存：同问句第二次走 intent
    await useUiStore.getState().sendMessage('明天下午三点提醒我交稿-cr1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(2)
  })

  it('reminderLabel 缺省 → 回退 entryHint 作 label', async () => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: [],
      kind: 'action',
      action: { op: 'createReminder', entryHint: '给妈妈回电话', dueAt: DUE },
    } as ChatQuery)
    await useUiStore.getState().sendMessage('提醒我-cr2')
    const card = useUiStore.getState().conversation!.messages.at(-1)!
    expect(card.action!.reminderLabel).toBe('给妈妈回电话')
  })

  it('dueAt 缺失 → needTime 模板追问（纯文本消息，无卡、不抛错）', async () => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: [],
      kind: 'action',
      action: { op: 'createReminder', entryHint: '', reminderLabel: '交稿' },
    } as ChatQuery)
    await useUiStore.getState().sendMessage('提醒我交稿-cr3')
    const msg = useUiStore.getState().conversation!.messages.at(-1)!
    expect(msg.kind).toBeUndefined()
    expect(msg.action).toBeUndefined()
    expect(msg.content).toBe(t('chat.action.reminder.needTime', { label: '交稿' }))
    expect(mocks.localRecall).not.toHaveBeenCalled()
    expect(mocks.answerChat).not.toHaveBeenCalled()
  })

  it('dueAt 非法（解析不出日期）→ 同样 needTime 追问', async () => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: [],
      kind: 'action',
      action: { op: 'createReminder', entryHint: '', reminderLabel: '交稿', dueAt: 'not-a-date' },
    } as ChatQuery)
    await useUiStore.getState().sendMessage('提醒我交稿-cr4')
    const msg = useUiStore.getState().conversation!.messages.at(-1)!
    expect(msg.kind).toBeUndefined()
    expect(msg.content).toBe(t('chat.action.reminder.needTime', { label: '交稿' }))
  })
})

describe('sendMessage · op=deleteEntry', () => {
  beforeEach(() => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: ['桂花拿铁'],
      kind: 'action',
      action: { op: 'deleteEntry', entryHint: '桂花拿铁' },
    } as ChatQuery)
  })

  it('单候选 → pending 卡（op=deleteEntry，无类别字段语义：toCategory* 空串）', async () => {
    await useUiStore.getState().sendMessage('把桂花拿铁那条删了-dl1')
    const card = useUiStore.getState().conversation!.messages.at(-1)!
    expect(card.kind).toBe('actionConfirm')
    expect(card.action).toEqual({
      op: 'deleteEntry',
      entryHint: '桂花拿铁',
      status: 'pending',
      candidates: [{ entryId: 'e1', label: '桂花拿铁测评', fromCategory: 'idea' }],
      toCategorySlug: '',
      toCategoryLabel: '',
    })
    expect(mocks.answerChat).not.toHaveBeenCalled()
  })

  it('0 候选 → notFound 模板文案（带 hint），无卡', async () => {
    mocks.localRecall.mockReturnValue([])
    await useUiStore.getState().sendMessage('把桂花拿铁那条删了-dl2')
    const msg = useUiStore.getState().conversation!.messages.at(-1)!
    expect(msg.kind).toBeUndefined()
    expect(msg.content).toBe(t('chat.action.delete.notFound', { hint: '桂花拿铁' }))
  })

  it('多候选 → ambiguous 卡，候选截断 ≤5', async () => {
    mocks.localRecall.mockReturnValue(
      Array.from({ length: 6 }, (_, i) => ({
        id: `e${i + 1}`,
        createdAt: '2026-09-28',
        categorySlug: 'idea',
        tags: [],
        textExcerpt: `候选${i + 1}原文`,
      })),
    )
    await useUiStore.getState().sendMessage('把桂花拿铁那条删了-dl3')
    const card = useUiStore.getState().conversation!.messages.at(-1)!
    expect(card.action!.status).toBe('ambiguous')
    expect(card.action!.candidates.length).toBe(5)
    expect(card.action!.op).toBe('deleteEntry')
  })
})

describe('sendMessage · changeCategory 回归（op 缺省/显式均走原路径）', () => {
  it('op 缺省 → 原确认卡形状（action.op 为 undefined，toCategory* 有值）', async () => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: ['桂花拿铁'],
      kind: 'action',
      action: { entryHint: '桂花拿铁', categorySlug: 'food' },
    } as ChatQuery)
    await useUiStore.getState().sendMessage('把桂花拿铁改成美食-cc1')
    const card = useUiStore.getState().conversation!.messages.at(-1)!
    expect(card.kind).toBe('actionConfirm')
    expect(card.action!.op).toBeUndefined()
    expect(card.action!.status).toBe('pending')
    expect(card.action!.toCategorySlug).toBe('food')
    expect(card.action!.toCategoryLabel).toBe('美食')
    expect(mocks.answerChat).not.toHaveBeenCalled()
  })

  it('op 显式 changeCategory → 与原路径同形状（消息 action 不落 op 字段）', async () => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: ['桂花拿铁'],
      kind: 'action',
      action: { op: 'changeCategory', entryHint: '桂花拿铁', categorySlug: 'food' },
    } as ChatQuery)
    await useUiStore.getState().sendMessage('把桂花拿铁改成美食-cc2')
    const card = useUiStore.getState().conversation!.messages.at(-1)!
    expect(card.action!.op).toBeUndefined()
    expect(card.action!.toCategorySlug).toBe('food')
    expect(card.action!.status).toBe('pending')
  })
})

// ── resolveChatAction ─────────────────────────────────────────────────────

function seedConv(action: NonNullable<ChatMessage['action']>): string {
  const msgId = crypto.randomUUID()
  const conv: Conversation = {
    id: crypto.randomUUID(),
    messages: [
      { id: crypto.randomUUID(), role: 'user', content: '操作请求', createdAt: '2026-09-29T09:00:00+08:00' },
      { id: msgId, role: 'assistant', content: '', createdAt: '2026-09-29T09:00:01+08:00', kind: 'actionConfirm', action },
    ],
    updatedAt: '2026-09-29T09:00:01+08:00',
  }
  useUiStore.setState({ conversation: conv })
  return msgId
}

const reminderAction = (patch?: Partial<NonNullable<ChatMessage['action']>>): NonNullable<ChatMessage['action']> => ({
  op: 'createReminder',
  entryHint: '',
  status: 'pending',
  candidates: [],
  toCategorySlug: '',
  toCategoryLabel: '',
  reminderLabel: '交稿',
  reminderDueAt: '2099-01-01T15:00:00+08:00',
  ...patch,
})

const deleteAction = (patch?: Partial<NonNullable<ChatMessage['action']>>): NonNullable<ChatMessage['action']> => ({
  op: 'deleteEntry',
  entryHint: '桂花拿铁',
  status: 'pending',
  candidates: [{ entryId: 'e1', label: '桂花拿铁测评', fromCategory: 'idea' }],
  toCategorySlug: '',
  toCategoryLabel: '',
  ...patch,
})

const changeCategoryAction = (patch?: Partial<NonNullable<ChatMessage['action']>>): NonNullable<ChatMessage['action']> => ({
  entryHint: '桂花拿铁',
  status: 'pending',
  candidates: [{ entryId: 'e1', label: '桂花拿铁测评', fromCategory: 'idea' }],
  toCategorySlug: 'food',
  toCategoryLabel: '美食',
  ...patch,
})

describe('resolveChatAction · createReminder', () => {
  // 注：permissionRequested 是 store.ts 模块级 flag，跨用例持久（同 chatAnswerCache 先例，
  // 绕开而非重置）。权限用例必须是全文件第一个触发 confirm 路径的用例——保持声明在首位。
  it('首次 confirm 请求通知权限一次（镜像 confirmReminder 序列：权限 → saveReminder → schedule）', async () => {
    const msgId = seedConv(reminderAction())
    await useUiStore.getState().resolveChatAction(msgId, 'confirm')
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1)
    const permOrder = mocks.requestPermission.mock.invocationCallOrder[0]
    const saveOrder = mocks.saveReminder.mock.invocationCallOrder[0]
    expect(permOrder).toBeLessThan(saveOrder)

    // 第二次 confirm 不再请求权限（模块级 permissionRequested flag）
    const msgId2 = seedConv(reminderAction())
    await useUiStore.getState().resolveChatAction(msgId2, 'confirm')
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1)
  })

  it("confirm → saveReminder（entryId undefined）+ 调度 + 消息 done + 回执（本地化时间）", async () => {
    const msgId = seedConv(reminderAction())
    await useUiStore.getState().resolveChatAction(msgId, 'confirm')

    // saveReminder 入参：无源头条目（entryId undefined），dueAt/label 来自卡负载。
    expect(mocks.saveReminder).toHaveBeenCalledTimes(1)
    const saved = mocks.saveReminder.mock.calls[0][0] as Reminder
    expect(saved.entryId).toBeUndefined()
    expect(saved.dueAt).toBe('2099-01-01T15:00:00+08:00')
    expect(saved.label).toBe('交稿')
    expect(saved.status).toBe('pending')
    // 内存态 reminders 已收入 + 系统级通知已预约（未来到点）。
    expect(useUiStore.getState().reminders.some((r) => r.id === saved.id)).toBe(true)
    expect(mocks.lnSchedule).toHaveBeenCalled()

    // 消息 done + 回执
    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.find((m) => m.id === msgId)!.action!.status).toBe('done')
    const receipt = msgs.at(-1)!
    expect(receipt.role).toBe('assistant')
    expect(receipt.content).toBe(
      t('chat.action.reminder.done', { label: '交稿', time: fmtDue('2099-01-01T15:00:00+08:00') }),
    )
    // 落库收口
    const savedConv = mocks.saveConversation.mock.calls.at(-1)![0] as Conversation
    expect(savedConv.messages.find((m) => m.id === msgId)!.action!.status).toBe('done')
  })

  it('{entryId} 不是 createReminder 的有效抉择 → no-op', async () => {
    const msgId = seedConv(reminderAction())
    await useUiStore.getState().resolveChatAction(msgId, { entryId: 'e1' })
    expect(mocks.saveReminder).not.toHaveBeenCalled()
    expect(useUiStore.getState().conversation!.messages.find((m) => m.id === msgId)!.action!.status).toBe('pending')
  })

  it('saveReminder 抛错 → 复位 pending + console.error（不 rethrow，卡可重试）', async () => {
    mocks.saveReminder.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const msgId = seedConv(reminderAction())
    await useUiStore.getState().resolveChatAction(msgId, 'confirm')

    expect(useUiStore.getState().conversation!.messages.find((m) => m.id === msgId)!.action!.status).toBe('pending')
    expect(errSpy).toHaveBeenCalled()
    // 复位同样落库（杀进程恢复后卡仍可操作）
    const savedConv = mocks.saveConversation.mock.calls.at(-1)![0] as Conversation
    expect(savedConv.messages.find((m) => m.id === msgId)!.action!.status).toBe('pending')
    errSpy.mockRestore()
  })
})

describe('resolveChatAction · deleteEntry', () => {
  it('{entryId} → trashEntry 软删 + 缓存清 + 消息 done + 回执', async () => {
    // 缓存预热：同问句两次只走一次 intent（第二次命中缓存）。
    await useUiStore.getState().sendMessage('缓存预热-del1')
    await useUiStore.getState().sendMessage('缓存预热-del1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(1)

    const msgId = seedConv(deleteAction())
    await useUiStore.getState().resolveChatAction(msgId, { entryId: 'e1' })

    // 软删：di.storage.trashEntry 落库 + 内存态 entries → trashed。
    expect(mocks.trashEntry).toHaveBeenCalledTimes(1)
    expect(mocks.trashEntry).toHaveBeenCalledWith('e1')
    expect(useUiStore.getState().entries.some((e) => e.id === 'e1')).toBe(false)
    expect(useUiStore.getState().trashed.some((e) => e.id === 'e1')).toBe(true)

    // 消息 done + 回执
    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.find((m) => m.id === msgId)!.action!.status).toBe('done')
    expect(msgs.at(-1)!.content).toBe(t('chat.action.delete.done', { label: '桂花拿铁测评' }))

    // 缓存已清：同问句重新走 intent。
    // 注：chatCacheKey 的 sig 含 entries.length，trash 后 sig 天然变化——此断言不隔离
    // 「clear 本身」，但锁定「删后同问必重算」的外显行为（clear 是实现手段）。
    await useUiStore.getState().sendMessage('缓存预热-del1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(2)
  })

  it('条目已不在 entries（杀进程恢复/他端已删）→ notFound 终态，不调 trashEntry', async () => {
    useUiStore.setState({ entries: [] })
    const msgId = seedConv(deleteAction())
    await useUiStore.getState().resolveChatAction(msgId, { entryId: 'e1' })

    expect(useUiStore.getState().conversation!.messages.find((m) => m.id === msgId)!.action!.status).toBe('notFound')
    expect(mocks.trashEntry).not.toHaveBeenCalled()
    const savedConv = mocks.saveConversation.mock.calls.at(-1)![0] as Conversation
    expect(savedConv.messages.find((m) => m.id === msgId)!.action!.status).toBe('notFound')
  })

  it('非候选 entryId / 裸 confirm → no-op', async () => {
    const msgId = seedConv(deleteAction())
    await useUiStore.getState().resolveChatAction(msgId, { entryId: '不存在' })
    expect(mocks.trashEntry).not.toHaveBeenCalled()

    const msgId2 = seedConv(deleteAction())
    await useUiStore.getState().resolveChatAction(msgId2, 'confirm')
    expect(mocks.trashEntry).not.toHaveBeenCalled()
    expect(useUiStore.getState().conversation!.messages.find((m) => m.id === msgId2)!.action!.status).toBe('pending')
  })

  it('cancel → cancelled + 回执；不删条目', async () => {
    const msgId = seedConv(deleteAction())
    await useUiStore.getState().resolveChatAction(msgId, 'cancel')

    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.find((m) => m.id === msgId)!.action!.status).toBe('cancelled')
    expect(msgs.at(-1)!.content).toBe('好，没有改动。')
    expect(mocks.trashEntry).not.toHaveBeenCalled()
    expect(useUiStore.getState().entries.some((e) => e.id === 'e1')).toBe(true)
  })
})

describe('resolveChatAction · changeCategory（缺省 op 委托）+ resolveCategoryAction 兼容壳', () => {
  it('resolveChatAction({entryId}) 走 changeCategory 臂：updateEntryAi + done + 回执', async () => {
    const msgId = seedConv(changeCategoryAction())
    await useUiStore.getState().resolveChatAction(msgId, { entryId: 'e1' })

    expect(mocks.saveEntryAi).toHaveBeenCalledTimes(1)
    const savedAi = mocks.saveEntryAi.mock.calls[0][0] as EntryAi
    expect(savedAi.category).toBe('food')
    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.find((m) => m.id === msgId)!.action!.status).toBe('done')
    expect(msgs.at(-1)!.content).toBe('已把《桂花拿铁测评》改成「美食」分类')
  })

  it("resolveChatAction('confirm') 对 changeCategory 非法 → no-op", async () => {
    const msgId = seedConv(changeCategoryAction())
    await useUiStore.getState().resolveChatAction(msgId, 'confirm')
    expect(mocks.saveEntryAi).not.toHaveBeenCalled()
    expect(useUiStore.getState().conversation!.messages.find((m) => m.id === msgId)!.action!.status).toBe('pending')
  })

  it('resolveCategoryAction 兼容壳：{entryId} 与 cancel 行为不变', async () => {
    const msgId = seedConv(changeCategoryAction())
    await useUiStore.getState().resolveCategoryAction(msgId, { entryId: 'e1' })
    expect(mocks.saveEntryAi).toHaveBeenCalledTimes(1)
    expect(useUiStore.getState().conversation!.messages.find((m) => m.id === msgId)!.action!.status).toBe('done')

    const msgId2 = seedConv(changeCategoryAction())
    await useUiStore.getState().resolveCategoryAction(msgId2, 'cancel')
    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.find((m) => m.id === msgId2)!.action!.status).toBe('cancelled')
    expect(msgs.at(-1)!.content).toBe('好，没有改动。')
  })
})
