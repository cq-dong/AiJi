// t3（2026-10-05 prd-trust-pack §④）：AI 失败队列自动补跑 + processing 尸体清扫。
// sweep——processing 尸体 → failed + processError + 落库；ready/failed 不动；无尸体零写零 set。
// retry——online 时 failed 条目逐个串行 processEntry(id, false)；autoRetried 会话级去重；
//         retrying 并发守卫；offline no-op。
// hydrate 集成——boot 链 sweep → retry：尸体转 failed 落库后被补跑一次。
//
// 模块级状态重置：store.ts 导出 __resetAiQueueRetryForTests（autoRetried/retrying 清零），
// beforeEach 必调——zustand store 是单例，会话级去重集合跨用例残留会污染后续断言。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Entry, Settings } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  saveEntry: vi.fn(),
  listEntries: vi.fn(),
  processEntry: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      purgeExpired: vi.fn().mockResolvedValue(0),
      listEntries: () => mocks.listEntries(),
      getSettings: vi.fn().mockResolvedValue({ language: 'zh' } as Settings),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      listCategories: vi.fn().mockResolvedValue([]),
      listTags: vi.fn().mockResolvedValue([]),
      listAggregates: vi.fn().mockResolvedValue([]),
      listReminders: vi.fn().mockResolvedValue([]),
      listDrafts: vi.fn().mockResolvedValue([]),
      listTrashed: vi.fn().mockResolvedValue([]),
      listMemories: vi.fn().mockResolvedValue([]),
      listConversations: vi.fn().mockResolvedValue([]),
      getEntryAi: vi.fn().mockResolvedValue(undefined),
      saveEntry: (e: Entry) => mocks.saveEntry(e),
    },
    secrets: { get: vi.fn().mockResolvedValue(undefined) },
    stt: { transcribe: vi.fn().mockResolvedValue('') },
    llm: { classify: vi.fn() },
    localNotifications: {
      schedule: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
      requestPermission: vi.fn().mockResolvedValue(true),
    },
  },
}))

vi.mock('@/app/accountStore', () => ({
  useAccountStore: {
    getState: () => ({ account: null, session: null }),
  },
  // store.ts 模块加载时调用 registerStoreRehydrate 注册回调；mock 必须提供该导出。
  registerStoreRehydrate: () => {},
  registerQuotaReset: () => {},
}))

import { useUiStore, __resetAiQueueRetryForTests } from '@/app/store'

// fire-and-forget 链（sweep → retry → processEntry await 链）排空：宏任务边界保证微任务全清。
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

function mkEntry(id: string, status: Entry['status'], over: Partial<Entry> = {}): Entry {
  return {
    id,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    status,
    parts: [{ type: 'text', content: 'text-' + id }],
    ...over,
  }
}

// 真实 processEntry 备份——retry 相关用例会 setState 替换成 spy，beforeEach 必须还原，
// 否则单例 store 残留 spy 污染 sweep / hydrate 用例。
const realProcessEntry = useUiStore.getState().processEntry

beforeEach(() => {
  vi.clearAllMocks()
  __resetAiQueueRetryForTests()
  mocks.listEntries.mockResolvedValue([])
  mocks.saveEntry.mockResolvedValue(undefined)
  mocks.processEntry.mockReset().mockResolvedValue(undefined)
  useUiStore.setState({
    entries: [],
    online: true,
    hydrated: true,
    processEntry: realProcessEntry,
  })
})

describe('sweepProcessingCorpses 尸体清扫', () => {
  it('processing 条目 → failed + processError + 落库 + 内存态更新；ready 条目不动', async () => {
    const corpse = mkEntry('c1', 'processing')
    const ready = mkEntry('r1', 'ready')
    useUiStore.setState({ entries: [corpse, ready] })

    await useUiStore.getState().sweepProcessingCorpses()

    expect(mocks.saveEntry).toHaveBeenCalledTimes(1)
    const saved = mocks.saveEntry.mock.calls[0][0] as Entry
    expect(saved.id).toBe('c1')
    expect(saved.status).toBe('failed')
    expect(saved.processError).toBe('应用中断，处理未完成，可重试')
    expect(saved.updatedAt).not.toBe(corpse.updatedAt)
    const entries = useUiStore.getState().entries
    expect(entries.find((e) => e.id === 'c1')).toMatchObject({
      status: 'failed',
      processError: '应用中断，处理未完成，可重试',
    })
    expect(entries.find((e) => e.id === 'r1')).toMatchObject({ status: 'ready' })
  })

  it('多条尸体全部清扫（按序落库）', async () => {
    useUiStore.setState({ entries: [mkEntry('c1', 'processing'), mkEntry('c2', 'processing')] })

    await useUiStore.getState().sweepProcessingCorpses()

    expect(mocks.saveEntry).toHaveBeenCalledTimes(2)
    expect(useUiStore.getState().entries.every((e) => e.status === 'failed')).toBe(true)
  })

  it('无尸体 → 零写零 set（saveEntry 不调、entries 引用不变）', async () => {
    const ready = mkEntry('r1', 'ready')
    const failed = mkEntry('f1', 'failed', { processError: 'x' })
    useUiStore.setState({ entries: [ready, failed] })
    const before = useUiStore.getState().entries

    await useUiStore.getState().sweepProcessingCorpses()

    expect(mocks.saveEntry).not.toHaveBeenCalled()
    expect(useUiStore.getState().entries).toBe(before)
  })
})

describe('retryFailedEntries 失败队列自动补跑', () => {
  it('online：failed 条目按序串行补跑（D11 禁并发），isFresh=false；ready/processing 跳过', async () => {
    const order: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    mocks.processEntry.mockImplementation(async (id: string) => {
      order.push(id)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await flush()
      inFlight--
    })
    useUiStore.setState({
      processEntry: mocks.processEntry as (id: string, isFresh?: boolean) => Promise<void>,
      entries: [
        mkEntry('f1', 'failed'),
        mkEntry('r1', 'ready'),
        mkEntry('f2', 'failed'),
        mkEntry('p1', 'processing'),
      ],
    })

    await useUiStore.getState().retryFailedEntries()

    expect(order).toEqual(['f1', 'f2'])
    expect(maxInFlight).toBe(1) // 串行证据：Promise.all 并发实现会冲到 2
    expect(mocks.processEntry.mock.calls[0]).toEqual(['f1', false])
    expect(mocks.processEntry.mock.calls[1]).toEqual(['f2', false])
  })

  it('autoRetried 会话级去重：同条目二次调用不再补跑；新 failed 条目仍会补跑', async () => {
    useUiStore.setState({
      processEntry: mocks.processEntry as (id: string, isFresh?: boolean) => Promise<void>,
      entries: [mkEntry('f1', 'failed')],
    })

    await useUiStore.getState().retryFailedEntries()
    await useUiStore.getState().retryFailedEntries()
    expect(mocks.processEntry).toHaveBeenCalledTimes(1)

    // 新出现的 failed 条目不受去重影响（f1 已在 set，只补 f2）
    useUiStore.setState({ entries: [mkEntry('f1', 'failed'), mkEntry('f2', 'failed')] })
    await useUiStore.getState().retryFailedEntries()
    expect(mocks.processEntry).toHaveBeenCalledTimes(2)
    expect(mocks.processEntry.mock.calls[1][0]).toBe('f2')
  })

  it('retrying 并发守卫：首轮未 resolve 时二次调用不重复进入', async () => {
    const gates: Array<() => void> = []
    mocks.processEntry.mockImplementation(
      () =>
        new Promise<void>((r) => {
          gates.push(r)
        }),
    )
    useUiStore.setState({
      processEntry: mocks.processEntry as (id: string, isFresh?: boolean) => Promise<void>,
      entries: [mkEntry('f1', 'failed'), mkEntry('f2', 'failed')],
    })

    const first = useUiStore.getState().retryFailedEntries()
    // 首轮同步进入 f1 的 await（processEntry 已被调一次）；二次调用应被守卫立即挡回
    expect(mocks.processEntry).toHaveBeenCalledTimes(1)
    await useUiStore.getState().retryFailedEntries()
    expect(mocks.processEntry).toHaveBeenCalledTimes(1) // f2 未被二次进入触发

    gates[0]!() // f1 完成 → 首轮继续 f2
    await flush()
    expect(mocks.processEntry).toHaveBeenCalledTimes(2)
    gates[1]!()
    await first
    expect(mocks.processEntry.mock.calls.map((c) => c[0])).toEqual(['f1', 'f2'])
  })

  it('offline → no-op：processEntry 零调用', async () => {
    useUiStore.setState({
      processEntry: mocks.processEntry as (id: string, isFresh?: boolean) => Promise<void>,
      entries: [mkEntry('f1', 'failed')],
      online: false,
    })

    await useUiStore.getState().retryFailedEntries()

    expect(mocks.processEntry).not.toHaveBeenCalled()
  })
})

describe('hydrate 集成：boot 链 sweep → retry', () => {
  it('processing 尸体 hydrate 后转 failed 落库，并被自动补跑一次（isFresh=false）', async () => {
    const corpse = mkEntry('c1', 'processing')
    mocks.listEntries.mockResolvedValue([corpse])
    useUiStore.setState({
      hydrated: false,
      entries: [],
      online: true,
      processEntry: mocks.processEntry as (id: string, isFresh?: boolean) => Promise<void>,
    })

    await useUiStore.getState().hydrate()
    await flush() // boot 链是 fire-and-forget：sweep 落库 → retry 补跑，等链排空

    // sweep：尸体 → failed + 落库
    expect(useUiStore.getState().entries.find((e) => e.id === 'c1')).toMatchObject({
      status: 'failed',
      processError: '应用中断，处理未完成，可重试',
    })
    expect(mocks.saveEntry).toHaveBeenCalledTimes(1)
    expect((mocks.saveEntry.mock.calls[0][0] as Entry).status).toBe('failed')
    // retry：补跑发生且 isFresh=false（防 boot 弹窗风暴）
    expect(mocks.processEntry).toHaveBeenCalledTimes(1)
    expect(mocks.processEntry.mock.calls[0]).toEqual(['c1', false])
  })

  it('offline boot：sweep 照跑（尸体转 failed），retry 不补跑', async () => {
    const corpse = mkEntry('c1', 'processing')
    mocks.listEntries.mockResolvedValue([corpse])
    useUiStore.setState({
      hydrated: false,
      entries: [],
      online: false,
      processEntry: mocks.processEntry as (id: string, isFresh?: boolean) => Promise<void>,
    })

    await useUiStore.getState().hydrate()
    await flush()

    expect(useUiStore.getState().entries.find((e) => e.id === 'c1')).toMatchObject({ status: 'failed' })
    expect(mocks.processEntry).not.toHaveBeenCalled()
  })
})
