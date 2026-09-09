import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetMockDongle, mockDongle } from '@/adapters/mockDongle'
import type { DongleState } from '@/ports'

// mock 音频流：jsdom 无真实 getUserMedia，按需 stub（getAudioStream 用例）。
function stubGetUserMedia() {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const gum = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia: gum }, configurable: true,
  })
  return { gum, stream }
}

afterEach(() => __resetMockDongle())

describe('mockDongle 状态机', () => {
  it('scan 返回一台模拟 Work 3200，状态走 idle→scanning→idle', async () => {
    const states: DongleState[] = []
    const unsub = mockDongle.onStateChange((s) => states.push(s))
    const devices = await mockDongle.scan()
    expect(devices).toHaveLength(1)
    expect(devices[0].name).toContain('Work 3200')
    // scan 结束回到 idle（用例标题「idle→scanning→idle」）；brief 原断言只写
    // ['scanning'] 与其自带实现的 setState('idle') 矛盾，按实现语义修正。
    expect(states).toEqual(['scanning', 'idle'])
    unsub()
  })

  it('connect 后 getDeviceInfo 返回电量；未 connect 调 getDeviceInfo throw', async () => {
    const [d] = await mockDongle.scan()
    await expect(mockDongle.getDeviceInfo()).rejects.toThrow('dongle-not-connected')
    await mockDongle.connect(d.id)
    const info = await mockDongle.getDeviceInfo()
    expect(info.batteryPct).toBeGreaterThanOrEqual(0)
    expect(info.name).toContain('Work 3200')
  })

  it('disconnect 是 no-op 安全的；connect 状态回调带 device', async () => {
    await mockDongle.disconnect() // 未连接，不 throw
    const events: Array<{ s: DongleState; name?: string }> = []
    mockDongle.onStateChange((s, d) => events.push({ s, name: d?.name }))
    const [d] = await mockDongle.scan()
    await mockDongle.connect(d.id)
    expect(events.some((e) => e.s === 'connected' && e.name?.includes('Work 3200'))).toBe(true)
  })

  it('connect 未知 deviceId throw', async () => {
    await mockDongle.scan()
    await expect(mockDongle.connect('nope')).rejects.toThrow()
  })
})

describe('mockDongle 音频流与标记', () => {
  it('getAudioStream 未连接 throw；连接后返回 getUserMedia 包装流', async () => {
    const { stream } = stubGetUserMedia()
    await expect(mockDongle.getAudioStream()).rejects.toThrow('dongle-not-connected')
    const [d] = await mockDongle.scan()
    await mockDongle.connect(d.id)
    await expect(mockDongle.getAudioStream()).resolves.toBe(stream)
  })

  it('markHighlight 返回单调递增 atSec，label 可选透传', async () => {
    const [d] = await mockDongle.scan()
    await mockDongle.connect(d.id)
    const m1 = await mockDongle.markHighlight()
    expect(m1.atSec).toBeGreaterThanOrEqual(0)
    const m2 = await mockDongle.markHighlight('关键结论')
    expect(m2.atSec).toBeGreaterThanOrEqual(m1.atSec)
  })
})
