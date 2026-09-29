import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Aggregate, Category, ChatAnswer, ChatMessage, ChatQuery, Conversation, Entry, EntryAi } from '@/domain/types'

// ── 能力大补（2026-09-29）store 编排测试 ─────────────────────────────────
// 骨架照抄 storeChatStream.test.ts；额外 mock di.secrets/di.capture +
// @/adapters/weather|webSearch|geocoding（A 组适配器，本文件一律 mock 不打网络）。

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
  secretsGet: vi.fn(),
  secretsSet: vi.fn(),
  secretsDelete: vi.fn(),
  getLocation: vi.fn(),
  getWeatherLive: vi.fn(),
  webSearch: vi.fn(),
  reverseGeocodeCity: vi.fn(),
  localRecall: vi.fn(),
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
    secrets: {
      get: (k: string) => mocks.secretsGet(k),
      set: async (k: string, v: string) => { mocks.secretsSet(k, v) },
      delete: async (k: string) => { mocks.secretsDelete(k) },
    },
    capture: {
      getLocation: () => mocks.getLocation(),
    },
  },
}))

vi.mock('@/adapters/weather', () => ({
  getWeatherLive: (...a: unknown[]) => mocks.getWeatherLive(...a),
}))
vi.mock('@/adapters/webSearch', () => ({
  webSearch: (...a: unknown[]) => mocks.webSearch(...a),
}))
vi.mock('@/adapters/geocoding', () => ({
  // store.ts 同时 import enrichLocation（processEntry 用，本文件不触发）与 reverseGeocodeCity。
  enrichLocation: async (loc: unknown) => loc,
  reverseGeocodeCity: (...a: unknown[]) => mocks.reverseGeocodeCity(...a),
}))

vi.mock('@/ui/screens/chat/helpers', async (importOriginal) => {
  // 部分 mock：localRecall 受控；dateKey/currentTimeLine/resolveActionCategory 走真实实现。
  const actual = await importOriginal<typeof import('@/ui/screens/chat/helpers')>()
  return { ...actual, localRecall: (...a: unknown[]) => mocks.localRecall(...a) }
})

import { useUiStore } from '@/app/store'
import { dateKey } from '@/ui/screens/chat/helpers'
import { setCurrentLang } from '@/app/currentLang'

async function flushMicro(ticks = 20): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

function mkEntry(id: string, createdAt = '2026-09-28T10:00:00+08:00'): Entry {
  return { id, createdAt, updatedAt: createdAt, parts: [{ type: 'text', content: `${id} 原文` }], status: 'ready' }
}

function mkAi(entryId: string, patch?: Partial<EntryAi>): EntryAi {
  return { id: `ai-${entryId}`, entryId, version: 1, category: 'idea', tags: [], facets: {}, modelUsed: 'test', createdAt: '2026-09-28T10:00:00+08:00', ...patch }
}

const weatherFixture = {
  city: '北京',
  weather: '晴',
  temperature: '26',
  winddirection: '东',
  windpower: '3',
  humidity: '40',
  reporttime: '2026-09-29 10:00',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.conversations.length = 0
  // 断言中文文案（降级块/回执/时间行），固定 zh（jsdom navigator.language=en-US）。
  setCurrentLang('zh')
  useUiStore.setState({
    online: true,
    conversation: null,
    chatList: [],
    chatLoading: 'idle',
    entries: [],
    aiByEntry: {},
    categories: [],
    tags: [],
    aggregates: [],
    memories: [],
    hydrated: true,
  })
  // 默认：recall 意图 + 一条受控 cite（走流式 answerChat 路径）。
  mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: [], categorySlugs: undefined } as ChatQuery)
  mocks.answerChat.mockResolvedValue({ answer: '好的', citedEntryIds: [] } as ChatAnswer)
  mocks.extractMemory.mockResolvedValue(null)
  mocks.localRecall.mockReturnValue([
    { id: 'e1', createdAt: '2026-09-28', categorySlug: 'idea', tags: [], textExcerpt: '原文' },
  ])
  mocks.secretsGet.mockResolvedValue(undefined)
  mocks.getLocation.mockResolvedValue(null)
  mocks.getAggregate.mockResolvedValue(undefined)
})

// chatAnswerCache 是 store.ts 模块级 Map，跨用例持久。各用例用不同问题串避免缓存命中。

describe('weather 分支', () => {
  it('有 key + 问句带城市 → 相位 weather → answerChat 收天气数据块；cites 空；localRecall/定位未调；不写缓存', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['天气'], kind: 'weather', city: '北京' } as ChatQuery)
    mocks.secretsGet.mockImplementation(async (k: string) => (k === 'geocoding:key' ? 'gaode-key' : undefined))
    let resolveWeather!: (w: typeof weatherFixture) => void
    mocks.getWeatherLive.mockImplementation(
      () => new Promise<typeof weatherFixture>((res) => { resolveWeather = res }),
    )

    const p = useUiStore.getState().sendMessage('天气问题-w1')
    await flushMicro()
    // 相位：weather 数据获取中（getWeatherLive 挂起期间）
    expect(mocks.getWeatherLive).toHaveBeenCalledWith('北京', 'gaode-key')
    expect(useUiStore.getState().chatLoading).toBe('weather')

    resolveWeather(weatherFixture)
    await flushMicro()
    expect(mocks.answerChat).toHaveBeenCalledTimes(1)
    const opts = mocks.answerChat.mock.calls[0][0] as { question: string; cites: unknown[]; extraSystem?: string }
    expect(opts.cites).toEqual([])
    expect(opts.extraSystem).toContain('天气数据（高德，2026-09-29 10:00 发布）：北京 晴，气温 26°C，东风 3 级，湿度 40%')
    expect(mocks.getWeatherLive).toHaveBeenCalledWith('北京', 'gaode-key')
    expect(mocks.localRecall).not.toHaveBeenCalled() // 跳过本地召回
    expect(mocks.getLocation).not.toHaveBeenCalled() // query.city 优先于定位
    await p
    expect(useUiStore.getState().chatLoading).toBe('idle')

    // 不写缓存：同问句第二次 sendMessage 重新走 intent+answer
    mocks.getWeatherLive.mockResolvedValue(weatherFixture) // 一次性挂起 mock 换成立即 resolve
    await useUiStore.getState().sendMessage('天气问题-w1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(2)
    expect(mocks.answerChat).toHaveBeenCalledTimes(2)
  })

  it('query.city 缺 → 有 key 时定位 + reverseGeocodeCity 补城市', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['天气'], kind: 'weather' } as ChatQuery)
    mocks.secretsGet.mockImplementation(async (k: string) => (k === 'geocoding:key' ? 'gaode-key' : undefined))
    mocks.getLocation.mockResolvedValue({ lat: 31.2, lng: 121.5 })
    mocks.reverseGeocodeCity.mockResolvedValue({ city: '上海', adcode: '310000' })
    mocks.getWeatherLive.mockResolvedValue({ ...weatherFixture, city: '上海' })

    await useUiStore.getState().sendMessage('天气问题-w2')
    expect(mocks.reverseGeocodeCity).toHaveBeenCalledWith(31.2, 121.5, 'gaode-key')
    expect(mocks.getWeatherLive).toHaveBeenCalledWith('上海', 'gaode-key')
    const opts = mocks.answerChat.mock.calls[0][0] as { extraSystem?: string }
    expect(opts.extraSystem).toContain('上海 晴')
  })

  it('无 key → noKey 降级块；不取定位不调天气；answerChat 仍调用', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['天气'], kind: 'weather', city: '北京' } as ChatQuery)
    await useUiStore.getState().sendMessage('天气问题-w3')
    const opts = mocks.answerChat.mock.calls[0][0] as { extraSystem?: string }
    expect(opts.extraSystem).toContain('未配置高德 Key')
    expect(mocks.getWeatherLive).not.toHaveBeenCalled()
    expect(mocks.getLocation).not.toHaveBeenCalled()
  })

  it('有 key 无 city 定位不可用 → noCity 降级块', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['天气'], kind: 'weather' } as ChatQuery)
    mocks.secretsGet.mockImplementation(async (k: string) => (k === 'geocoding:key' ? 'gaode-key' : undefined))
    mocks.getLocation.mockResolvedValue(null)
    await useUiStore.getState().sendMessage('天气问题-w4')
    const opts = mocks.answerChat.mock.calls[0][0] as { extraSystem?: string }
    expect(opts.extraSystem).toContain('未能确定城市')
    expect(mocks.getWeatherLive).not.toHaveBeenCalled()
  })

  it('getWeatherLive 返 null → failed 降级块', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['天气'], kind: 'weather', city: '北京' } as ChatQuery)
    mocks.secretsGet.mockImplementation(async (k: string) => (k === 'geocoding:key' ? 'gaode-key' : undefined))
    mocks.getWeatherLive.mockResolvedValue(null)
    await useUiStore.getState().sendMessage('天气问题-w5')
    const opts = mocks.answerChat.mock.calls[0][0] as { extraSystem?: string }
    expect(opts.extraSystem).toContain('天气查询失败')
  })
})

describe('search 分支', () => {
  it('有 key 有结果 → 结果块含标注指令与结果行；cites 空；相位 search；不写缓存', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['SpaceX'], kind: 'search' } as ChatQuery)
    mocks.secretsGet.mockImplementation(async (k: string) => (k === 'search:key' ? 'tvly-key' : undefined))
    let resolveSearch!: (r: { title: string; snippet: string; url: string }[]) => void
    mocks.webSearch.mockImplementation(
      () => new Promise((res) => { resolveSearch = res }),
    )

    const p = useUiStore.getState().sendMessage('搜索问题-s1')
    await flushMicro()
    expect(useUiStore.getState().chatLoading).toBe('search')
    resolveSearch([{ title: 'SpaceX 发射', snippet: '星舰第九飞', url: 'https://example.com/1' }])
    await p

    const opts = mocks.answerChat.mock.calls[0][0] as { cites: unknown[]; extraSystem?: string; question: string }
    expect(opts.cites).toEqual([])
    expect(opts.extraSystem).toContain('网络搜索结果（回答时用 [标题](URL) 标注来源）')
    expect(opts.extraSystem).toContain('1. SpaceX 发射 — 星舰第九飞（https://example.com/1）')
    expect(mocks.webSearch).toHaveBeenCalledWith('搜索问题-s1', 'tvly-key')
    expect(mocks.localRecall).not.toHaveBeenCalled()

    mocks.webSearch.mockResolvedValue([{ title: 'SpaceX 发射', snippet: '星舰第九飞', url: 'https://example.com/1' }])
    await useUiStore.getState().sendMessage('搜索问题-s1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(2) // 不写缓存
  })

  it('无 key → noKey 降级块；webSearch 未调', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['x'], kind: 'search' } as ChatQuery)
    await useUiStore.getState().sendMessage('搜索问题-s2')
    const opts = mocks.answerChat.mock.calls[0][0] as { extraSystem?: string }
    expect(opts.extraSystem).toContain('未配置网络搜索 Key')
    expect(mocks.webSearch).not.toHaveBeenCalled()
  })

  it('webSearch 返 null / 空数组 → failed 降级块', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: ['x'], kind: 'search' } as ChatQuery)
    mocks.secretsGet.mockImplementation(async (k: string) => (k === 'search:key' ? 'tvly-key' : undefined))
    mocks.webSearch.mockResolvedValue(null)
    await useUiStore.getState().sendMessage('搜索问题-s3')
    expect((mocks.answerChat.mock.calls[0][0] as { extraSystem?: string }).extraSystem).toContain('网络搜索失败')

    mocks.webSearch.mockResolvedValue([])
    await useUiStore.getState().sendMessage('搜索问题-s4')
    expect((mocks.answerChat.mock.calls[1][0] as { extraSystem?: string }).extraSystem).toContain('网络搜索失败')
  })
})

describe('action 分支（确认卡）', () => {
  const foodCat: Category = { slug: 'food', label: '美食', aliases: [], usageCount: 2, createdAt: '2026-01-01T00:00:00.000Z' }

  beforeEach(() => {
    useUiStore.setState({
      entries: [mkEntry('e1')],
      aiByEntry: { e1: mkAi('e1', { titleSuggestion: '桂花拿铁测评', category: 'idea' }) },
      categories: [foodCat],
    })
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: ['桂花拿铁'],
      kind: 'action',
      action: { entryHint: '桂花拿铁', categorySlug: 'food' },
    } as ChatQuery)
    mocks.localRecall.mockReturnValue([
      { id: 'e1', createdAt: '2026-09-28', categorySlug: 'idea', tags: [], textExcerpt: '今天喝了桂花拿铁，很好喝' },
    ])
  })

  it('单候选 → pending 确认卡（结构完整）；不调 answerChat/不写缓存/不提取记忆', async () => {
    await useUiStore.getState().sendMessage('把桂花拿铁改成美食-a1')
    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.length).toBe(2)
    const card = msgs.at(-1)!
    expect(card.kind).toBe('actionConfirm')
    expect(card.action).toEqual({
      entryHint: '桂花拿铁',
      status: 'pending',
      candidates: [{ entryId: 'e1', label: '桂花拿铁测评', fromCategory: 'idea' }],
      toCategorySlug: 'food',
      toCategoryLabel: '美食',
      isNewCategory: false,
    })
    expect(card.trace?.intent?.kind).toBe('action')
    expect(card.trace?.intent?.actionHint).toBe('桂花拿铁')
    expect(mocks.answerChat).not.toHaveBeenCalled()
    expect(useUiStore.getState().chatLoading).toBe('idle')

    // 不落缓存：同问句再次走 intent
    await useUiStore.getState().sendMessage('把桂花拿铁改成美食-a1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(2)
    // 记忆提取不跑（动作类问题无可记）
    await flushMicro()
    expect(mocks.extractMemory).not.toHaveBeenCalled()
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
    await useUiStore.getState().sendMessage('把桂花拿铁改成美食-a2')
    const card = useUiStore.getState().conversation!.messages.at(-1)!
    expect(card.kind).toBe('actionConfirm')
    expect(card.action!.status).toBe('ambiguous')
    expect(card.action!.candidates.length).toBe(5)
    expect(mocks.answerChat).not.toHaveBeenCalled()
  })

  it('0 候选 → notFound 模板文案（带 hint），无 actionConfirm 卡', async () => {
    mocks.localRecall.mockReturnValue([])
    await useUiStore.getState().sendMessage('把桂花拿铁改成美食-a3')
    const msg = useUiStore.getState().conversation!.messages.at(-1)!
    expect(msg.kind).toBeUndefined()
    expect(msg.action).toBeUndefined()
    expect(msg.content).toContain('桂花拿铁')
    expect(msg.content).toContain('没找到')
    expect(mocks.answerChat).not.toHaveBeenCalled()
  })

  it('slug/label 都不中 → 新涌现类别（slug 化 + isNewCategory）', async () => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: [],
      kind: 'action',
      action: { entryHint: '桂花拿铁', categoryLabel: '旅行 游记' },
    } as ChatQuery)
    await useUiStore.getState().sendMessage('把桂花拿铁改成旅行游记-a4')
    const card = useUiStore.getState().conversation!.messages.at(-1)!
    expect(card.action!.toCategorySlug).toBe('旅行-游记')
    expect(card.action!.toCategoryLabel).toBe('旅行 游记')
    expect(card.action!.isNewCategory).toBe(true)
  })

  it('categorySlug 未命中但 label 命中现有类别 → 用现有 slug', async () => {
    mocks.parseChatIntent.mockResolvedValue({
      scope: null,
      keywords: [],
      kind: 'action',
      action: { entryHint: '桂花拿铁', categorySlug: 'meishi', categoryLabel: '美食' },
    } as ChatQuery)
    await useUiStore.getState().sendMessage('把桂花拿铁改成美食-a5')
    const card = useUiStore.getState().conversation!.messages.at(-1)!
    expect(card.action!.toCategorySlug).toBe('food') // label 匹配回落
    expect(card.action!.isNewCategory).toBe(false)
  })
})

describe('resolveCategoryAction', () => {
  const foodCat: Category = { slug: 'food', label: '美食', aliases: [], usageCount: 2, createdAt: '2026-01-01T00:00:00.000Z' }

  function seedActionConv(patch?: Partial<NonNullable<ChatMessage['action']>>): { convId: string; msgId: string } {
    const msgId = crypto.randomUUID()
    const conv: Conversation = {
      id: crypto.randomUUID(),
      messages: [
        { id: crypto.randomUUID(), role: 'user', content: '把桂花拿铁改成美食', createdAt: '2026-09-29T09:00:00+08:00' },
        {
          id: msgId,
          role: 'assistant',
          content: '',
          createdAt: '2026-09-29T09:00:01+08:00',
          kind: 'actionConfirm',
          action: {
            entryHint: '桂花拿铁',
            status: 'pending',
            candidates: [{ entryId: 'e1', label: '桂花拿铁测评', fromCategory: 'idea' }],
            toCategorySlug: 'food',
            toCategoryLabel: '美食',
            ...patch,
          },
        },
      ],
      updatedAt: '2026-09-29T09:00:01+08:00',
    }
    useUiStore.setState({ conversation: conv })
    return { convId: conv.id, msgId }
  }

  beforeEach(() => {
    useUiStore.setState({
      entries: [mkEntry('e1')],
      aiByEntry: { e1: mkAi('e1', { titleSuggestion: '桂花拿铁测评', category: 'idea' }) },
      categories: [foodCat],
      aggregates: [],
    })
  })

  it('confirm 现有类别 → updateEntryAi/聚合 stale/缓存清/消息 done/回执；不调 saveCategory', async () => {
    // 先跑一轮 recall 问答预热缓存
    await useUiStore.getState().sendMessage('缓存预热-r1')
    await useUiStore.getState().sendMessage('缓存预热-r1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(1) // 第二次命中缓存

    const dayAg: Aggregate = {
      id: 'ag-day',
      scope: { type: 'day', range: '2026-09-28' },
      summary: '当日摘要',
      entryIds: ['e1'],
      modelUsed: 'test',
      createdAt: '2026-09-28T23:00:00+08:00',
      stale: false,
      detailLevel: 3,
    }
    mocks.getAggregate.mockResolvedValue(dayAg)
    useUiStore.setState({ aggregates: [dayAg] })

    const { msgId } = seedActionConv()
    await useUiStore.getState().resolveCategoryAction(msgId, { entryId: 'e1' })

    // updateEntryAi：category patch + version bump（store 真 action，落 saveEntryAi）
    expect(mocks.saveEntryAi).toHaveBeenCalledTimes(1)
    const savedAi = mocks.saveEntryAi.mock.calls[0][0] as EntryAi
    expect(savedAi.entryId).toBe('e1')
    expect(savedAi.category).toBe('food')
    expect(savedAi.version).toBe(2)
    expect(mocks.saveCategory).not.toHaveBeenCalled() // 现有类别不新建

    // 日聚合置 stale（range 取条目 createdAt 当日）
    expect(mocks.getAggregate).toHaveBeenCalledWith('day', '2026-09-28')
    expect(mocks.saveAggregate).toHaveBeenCalledWith(expect.objectContaining({ id: 'ag-day', stale: true }))

    // 消息 done + 回执（i18n zh 默认）
    const msgs = useUiStore.getState().conversation!.messages
    const card = msgs.find((m) => m.id === msgId)!
    expect(card.action!.status).toBe('done')
    const receipt = msgs.at(-1)!
    expect(receipt.role).toBe('assistant')
    expect(receipt.content).toBe('已把《桂花拿铁测评》改成「美食」分类')

    // 落库收口
    const saved = mocks.saveConversation.mock.calls.at(-1)![0] as Conversation
    expect(saved.messages.at(-1)!.content).toContain('已把')

    // 缓存已清：同问句重新走 intent
    await useUiStore.getState().sendMessage('缓存预热-r1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(2)
  })

  it('confirm 新类别 → 先 saveCategory 再 updateEntryAi（串行）', async () => {
    const { msgId } = seedActionConv({ isNewCategory: true, toCategorySlug: 'travel', toCategoryLabel: '旅行' })
    await useUiStore.getState().resolveCategoryAction(msgId, { entryId: 'e1' })

    expect(mocks.saveCategory).toHaveBeenCalledTimes(1)
    expect(mocks.saveCategory).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'travel', label: '旅行', aliases: [], usageCount: 0 }),
    )
    expect(mocks.saveEntryAi).toHaveBeenCalledTimes(1)
    // 串行顺序：saveCategory 先于 saveEntryAi
    const catOrder = mocks.saveCategory.mock.invocationCallOrder[0]
    const aiOrder = mocks.saveEntryAi.mock.invocationCallOrder[0]
    expect(catOrder).toBeLessThan(aiOrder)
    // 回执用新类别 label
    expect(useUiStore.getState().conversation!.messages.at(-1)!.content).toBe('已把《桂花拿铁测评》改成「旅行」分类')
  })

  it('cancel → 消息 cancelled + 回执「好，没有改动。」；不动条目/类别', async () => {
    const { msgId } = seedActionConv()
    await useUiStore.getState().resolveCategoryAction(msgId, 'cancel')

    const msgs = useUiStore.getState().conversation!.messages
    expect(msgs.find((m) => m.id === msgId)!.action!.status).toBe('cancelled')
    expect(msgs.at(-1)!.content).toBe('好，没有改动。')
    expect(mocks.saveEntryAi).not.toHaveBeenCalled()
    expect(mocks.saveCategory).not.toHaveBeenCalled()
    expect(mocks.saveAggregate).not.toHaveBeenCalled()
    expect(mocks.saveConversation).toHaveBeenCalled()
  })

  it('条目已删 → notFound 终态；不执行任何改动', async () => {
    useUiStore.setState({ entries: [] })
    mocks.getEntry.mockResolvedValue(undefined)
    const { msgId } = seedActionConv()
    await useUiStore.getState().resolveCategoryAction(msgId, { entryId: 'e1' })

    expect(useUiStore.getState().conversation!.messages.find((m) => m.id === msgId)!.action!.status).toBe('notFound')
    expect(mocks.saveEntryAi).not.toHaveBeenCalled()
    expect(mocks.saveCategory).not.toHaveBeenCalled()
    // notFound 也落库（杀进程恢复后卡状态正确）
    const saved = mocks.saveConversation.mock.calls.at(-1)![0] as Conversation
    expect(saved.messages.find((m) => m.id === msgId)!.action!.status).toBe('notFound')
  })

  it('终态/非候选 → no-op', async () => {
    const { msgId } = seedActionConv({ status: 'done' })
    await useUiStore.getState().resolveCategoryAction(msgId, { entryId: 'e1' })
    expect(mocks.saveConversation).not.toHaveBeenCalled()
    expect(mocks.saveEntryAi).not.toHaveBeenCalled()

    const p2 = seedActionConv({ status: 'ambiguous' })
    await useUiStore.getState().resolveCategoryAction(p2.msgId, { entryId: '不存在' })
    expect(mocks.saveEntryAi).not.toHaveBeenCalled()
  })
})

describe('缓存门与 timeIntent', () => {
  it('timeIntent recall：extraSystem 第一行当前时间；不写缓存', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: [], timeIntent: true } as ChatQuery)
    await useUiStore.getState().sendMessage('今天几号-t1')
    const opts = mocks.answerChat.mock.calls[0][0] as { extraSystem?: string }
    expect(opts.extraSystem).toMatch(/^当前时间：\d{4}-\d{2}-\d{2} 周. \d{2}:\d{2}$/)

    await useUiStore.getState().sendMessage('今天几号-t1')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(2) // 时间答案不缓存
    expect(mocks.answerChat).toHaveBeenCalledTimes(2)
  })

  it('timeIntent 与 weather 叠加：时间行在前，天气块在后', async () => {
    mocks.parseChatIntent.mockResolvedValue({ scope: null, keywords: [], kind: 'weather', city: '北京', timeIntent: true } as ChatQuery)
    mocks.secretsGet.mockImplementation(async (k: string) => (k === 'geocoding:key' ? 'gaode-key' : undefined))
    mocks.getWeatherLive.mockResolvedValue(weatherFixture)
    await useUiStore.getState().sendMessage('今天北京天气-t2')
    const extra = (mocks.answerChat.mock.calls[0][0] as { extraSystem?: string }).extraSystem!
    const lines = extra.split('\n')
    expect(lines[0]).toMatch(/^当前时间：/)
    expect(lines[1]).toContain('天气数据（高德')
  })

  it('recall 无 timeIntent 照写缓存（回归）', async () => {
    await useUiStore.getState().sendMessage('普通回忆-t3')
    await useUiStore.getState().sendMessage('普通回忆-t3')
    expect(mocks.parseChatIntent).toHaveBeenCalledTimes(1)
    expect(mocks.answerChat).toHaveBeenCalledTimes(1)
  })
})

describe('chatHistory 日期', () => {
  it('conversation[] 带本地日键；error 过滤；window=6', async () => {
    const base = Date.parse('2026-09-20T10:00:00+08:00')
    const msgs: ChatMessage[] = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `第${i}条`,
      createdAt: new Date(base + i * 86_400_000).toISOString(),
      error: i === 5 ? true : undefined,
    }))
    useUiStore.setState({
      conversation: { id: 'conv-hist', messages: msgs, updatedAt: msgs.at(-1)!.createdAt },
    })

    await useUiStore.getState().sendMessage('历史日期-h1')
    const opts = mocks.answerChat.mock.calls[0][0] as {
      conversation: { role: string; content: string; date?: string }[]
    }
    // error 的 m5 被过滤 → 7 条非 error，window=6 → 取 m2..m7 去掉 m5：m2,m3,m4,m6,m7 + …
    expect(opts.conversation.length).toBe(6)
    expect(opts.conversation.some((h) => h.content === '第5条')).toBe(false) // error 过滤
    expect(opts.conversation.some((h) => h.content === '第0条')).toBe(false) // 窗口外
    for (const h of opts.conversation) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    // date = 对应消息 createdAt 的本地日键（与真实 dateKey 一致）
    const src = msgs.filter((m) => !m.error).slice(-6)
    expect(opts.conversation.map((h) => h.date)).toEqual(src.map((m) => dateKey(m.createdAt)))
    expect(opts.conversation.map((h) => h.content)).toEqual(src.map((m) => m.content))
  })
})

describe('setSearchConfig', () => {
  it('写入：settings.searchKeyRef + secrets.set；清空：ref undefined + secrets.delete', () => {
    useUiStore.getState().setSearchConfig('tvly-key')
    expect(useUiStore.getState().settings.searchKeyRef).toBe('search:key')
    expect(mocks.secretsSet).toHaveBeenCalledWith('search:key', 'tvly-key')
    expect(mocks.saveSettings).toHaveBeenCalled()

    useUiStore.getState().setSearchConfig('')
    expect(useUiStore.getState().settings.searchKeyRef).toBeUndefined()
    expect(mocks.secretsDelete).toHaveBeenCalledWith('search:key')
  })
})
