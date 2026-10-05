// E2（2026-10-05 store 拆分一阶）新模块单测：reminderScheduler 注 fake store 的
// schedule/fire/missed 状态机 + clearScheduledTimeout + 一次性权限请求。
// 模块态（scheduledTimeouts/permissionRequested）跨用例持久——各用例用唯一 reminder id
// 隔离（照 storeChat* 测试 chatAnswerCache 先例：绕开而非重置）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Entry, Reminder } from '@/domain/types'
import type { UiState } from '@/app/store'

const mocks = vi.hoisted(() => ({
  lnSchedule: vi.fn(),
  lnCancel: vi.fn(),
  lnNotify: vi.fn(),
  requestPermission: vi.fn(),
  saveReminder: vi.fn(),
  playReminderBeep: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    localNotifications: {
      schedule: (r: Reminder) => mocks.lnSchedule(r),
      cancel: (id: string) => mocks.lnCancel(id),
      notify: (title: string, body: string, id: string) => mocks.lnNotify(title, body, id),
      requestPermission: () => mocks.requestPermission(),
    },
    storage: {
      saveReminder: (r: Reminder) => mocks.saveReminder(r),
    },
  },
}))

vi.mock('@/adapters/reminderSound', () => ({
  playReminderBeep: () => mocks.playReminderBeep(),
}))

import {
  initReminderScheduler,
  scheduleReminders,
  clearScheduledTimeout,
  requestReminderPermissionOnce,
} from '@/app/reminderScheduler'

// 注入面 = Pick<UiState, 'reminders' | 'trashed' | 'showFiringReminder'>（契约 §范围②）。
const fake: Pick<UiState, 'reminders' | 'trashed' | 'showFiringReminder'> = {
  reminders: [],
  trashed: [],
  showFiringReminder: vi.fn(),
}

initReminderScheduler({
  getState: () => fake,
  setState: (fn) => {
    fake.reminders = fn(fake).reminders
  },
})

function rem(id: string, dueAt: string, status: Reminder['status'] = 'pending', entryId?: string): Reminder {
  return { id, entryId, dueAt, label: `label-${id}`, status, createdAt: '2026-10-05T11:00:00.000Z' }
}

const NOW = new Date('2026-10-05T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  fake.reminders = []
  fake.trashed = []
  vi.mocked(fake.showFiringReminder).mockClear()
  mocks.lnSchedule.mockClear().mockResolvedValue(undefined)
  mocks.lnCancel.mockClear().mockResolvedValue(undefined)
  mocks.lnNotify.mockClear()
  mocks.saveReminder.mockClear().mockResolvedValue(undefined)
  mocks.playReminderBeep.mockClear()
  // requestPermission 不在此清：permissionRequested 模块 flag 跨用例持久，
  // 两个权限用例依赖声明顺序（首个消费 flag，后续断言不再请求）。
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleReminders · 未来到点', () => {
  it('pending → 预约系统通知 + 到点 fire（notify/beep/弹窗/落库/状态 fired）', () => {
    const r = rem('r-future', new Date(NOW.getTime() + 5_000).toISOString(), 'pending', 'e1')
    fake.reminders = [r]
    scheduleReminders()
    expect(mocks.lnSchedule).toHaveBeenCalledTimes(1)
    expect(mocks.lnSchedule).toHaveBeenCalledWith(r)
    expect(mocks.lnNotify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5_000)
    expect(mocks.lnNotify).toHaveBeenCalledWith('AiJi 提醒', r.label, r.id)
    expect(mocks.playReminderBeep).toHaveBeenCalledTimes(1)
    expect(fake.showFiringReminder).toHaveBeenCalledWith({
      reminderId: r.id,
      entryId: r.entryId,
      label: r.label,
      dueAt: r.dueAt,
    })
    expect(fake.reminders[0].status).toBe('fired')
    expect(mocks.saveReminder).toHaveBeenCalledWith(expect.objectContaining({ id: r.id, status: 'fired' }))
  })

  it('去重守卫：timeout 表已有 id → 二次 scheduleReminders 不重复预约', () => {
    const r = rem('r-dupe', new Date(NOW.getTime() + 60_000).toISOString())
    fake.reminders = [r]
    scheduleReminders()
    scheduleReminders()
    expect(mocks.lnSchedule).toHaveBeenCalledTimes(1)
  })

  it('snoozed 与 pending 同法调度/触发', () => {
    const r = rem('r-snoozed', new Date(NOW.getTime() + 10_000).toISOString(), 'snoozed')
    fake.reminders = [r]
    scheduleReminders()
    expect(mocks.lnSchedule).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(fake.reminders[0].status).toBe('fired')
  })

  it('fired/missed 终态不再调度', () => {
    fake.reminders = [
      rem('r-term-f', new Date(NOW.getTime() + 5_000).toISOString(), 'fired'),
      rem('r-term-m', new Date(NOW.getTime() + 5_000).toISOString(), 'missed'),
    ]
    scheduleReminders()
    expect(mocks.lnSchedule).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(mocks.lnNotify).not.toHaveBeenCalled()
  })

  it('条目在回收站 → 不调度（无 entryId 的 chat 提醒不受影响）', () => {
    const linked = rem('r-trashed', new Date(NOW.getTime() + 10_000).toISOString(), 'pending', 'e-trash')
    const orphan = rem('r-orphan', new Date(NOW.getTime() + 10_000).toISOString())
    fake.reminders = [linked, orphan]
    fake.trashed = [{ id: 'e-trash' } as unknown as Entry]
    scheduleReminders()
    expect(mocks.lnSchedule).toHaveBeenCalledTimes(1)
    expect(mocks.lnSchedule).toHaveBeenCalledWith(orphan)
  })

  it('到点 re-check：setTimeout 期间被 dismiss（state 已删）→ 不 fire', () => {
    const r = rem('r-stale', new Date(NOW.getTime() + 5_000).toISOString())
    fake.reminders = [r]
    scheduleReminders()
    fake.reminders = [] // dismissReminder 语义：从 state 删除
    vi.advanceTimersByTime(5_000)
    expect(mocks.lnNotify).not.toHaveBeenCalled()
    expect(fake.showFiringReminder).not.toHaveBeenCalled()
  })
})

describe('scheduleReminders · overdue', () => {
  it('<1h → 立即补 fire（不再预约）', () => {
    const r = rem('r-overdue', new Date(NOW.getTime() - 60_000).toISOString())
    fake.reminders = [r]
    scheduleReminders()
    expect(mocks.lnSchedule).not.toHaveBeenCalled()
    expect(mocks.lnNotify).toHaveBeenCalledWith('AiJi 提醒', r.label, r.id)
    expect(fake.reminders[0].status).toBe('fired')
  })

  it('≥1h → 标 missed 不打扰（无 notify/弹窗/beep）', () => {
    const r = rem('r-missed', new Date(NOW.getTime() - 3_700_000).toISOString())
    fake.reminders = [r]
    scheduleReminders()
    expect(mocks.lnNotify).not.toHaveBeenCalled()
    expect(fake.showFiringReminder).not.toHaveBeenCalled()
    expect(mocks.playReminderBeep).not.toHaveBeenCalled()
    expect(fake.reminders[0].status).toBe('missed')
    expect(mocks.saveReminder).toHaveBeenCalledWith(expect.objectContaining({ id: r.id, status: 'missed' }))
  })
})

describe('clearScheduledTimeout', () => {
  it('清前台 timeout + 取消系统通知预约；到点不再 fire', () => {
    const r = rem('r-clear', new Date(NOW.getTime() + 10_000).toISOString())
    fake.reminders = [r]
    scheduleReminders()
    clearScheduledTimeout(r.id)
    expect(mocks.lnCancel).toHaveBeenCalledWith(r.id)
    vi.advanceTimersByTime(20_000)
    expect(mocks.lnNotify).not.toHaveBeenCalled()
    expect(fake.reminders[0].status).toBe('pending')
  })

  it('未调度 id 也照常 cancel（幂等，原生 cancel pending notification 语义）', () => {
    clearScheduledTimeout('never-scheduled')
    expect(mocks.lnCancel).toHaveBeenCalledWith('never-scheduled')
  })
})

describe('requestReminderPermissionOnce', () => {
  it('首次请求（denied 也只 warn 不阻塞——resolve 不 throw）', async () => {
    mocks.requestPermission.mockClear().mockResolvedValue(false)
    await expect(requestReminderPermissionOnce()).resolves.toBeUndefined()
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('第二次起不再请求（模块级 permissionRequested flag 持久）', async () => {
    mocks.requestPermission.mockClear()
    await requestReminderPermissionOnce()
    expect(mocks.requestPermission).not.toHaveBeenCalled()
  })
})
