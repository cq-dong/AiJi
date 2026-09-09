import type { DongleDevice, DongleInfo, DongleState, RecordingDonglePort } from '@/ports'

// 录音豆 mock 适配器（Anker 黑客松赛道一）。官方 SDK 09-30 后才向入围队伍发放，
// 本适配器按赛题原文三能力（录音/重点标记/状态信息）顶位：
// - 音频是真的：getAudioStream 直接 getUserMedia 包装——真机演示 STT/落库全链路真实可用；
// - 设备是假的：scan 恒返一台「soundcore Work 3200 (Demo)」，连接 800ms 模拟配对延迟。
// 真 SDK 到手后写 ankerDongle.ts 平行适配器，di 一行切换，其余零改动。
// 计时锚点：端口语义定为「相对 getAudioStream 调用」（≈录音开始——store 每次开录
// 都会先取流）。getAudioStream 成功时重置 connectedAt，连接→开录的间隔不计入
// atSec，标记点与 part.durationSec（相对录音开始）同基准。

const DEVICE: DongleDevice = { id: 'mock-work-3200', name: 'soundcore Work 3200 (Demo)' }

let state: DongleState = 'idle'
let connected: DongleDevice | null = null
let connectedAt = 0
let listeners: Array<(s: DongleState, d?: DongleDevice) => void> = []

function setState(s: DongleState, d?: DongleDevice) {
  state = s
  listeners.forEach((cb) => cb(s, d))
}

/** 当前状态快照（onStateChange 是推送模型；此读接口供调试/断言兜底，防 state 成为只写死变量）。 */
export function getMockDongleState(): DongleState {
  return state
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// 测试隔离：单例模块状态在用例间复位（生产代码不 import 此函数）。
export function __resetMockDongle(): void {
  state = 'idle'
  connected = null
  connectedAt = 0
  listeners = []
}

export const mockDongle: RecordingDonglePort = {
  onStateChange(cb) {
    listeners.push(cb)
    return () => { listeners = listeners.filter((l) => l !== cb) }
  },

  async scan() {
    setState('scanning')
    await sleep(300) // 模拟 BLE 扫描延迟；测试无需 fake timers（300ms 可接受）
    setState('idle')
    return [DEVICE]
  },

  async connect(deviceId) {
    await sleep(800) // 模拟配对延迟
    if (deviceId !== DEVICE.id) throw new Error('dongle-not-found')
    connected = DEVICE
    connectedAt = Date.now()
    setState('connected', DEVICE)
  },

  async disconnect() {
    if (!connected) return
    connected = null
    connectedAt = 0
    setState('idle')
  },

  async getAudioStream() {
    if (!connected) throw new Error('dongle-not-connected')
    // 音频是真的：复用浏览器麦克风。真 SDK 版此处换成 SDK 的音频流对象——
    // 只要产出 MediaStream，下游 MediaRecorder/Paraformer/波形全复用。
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('mic-unavailable')
    // 计时锚点重置：atSec 语义「相对本次取流」（= 录音开始），非相对 connect。
    connectedAt = Date.now()
    return navigator.mediaDevices.getUserMedia({ audio: true })
  },

  async markHighlight(label) {
    if (!connected) throw new Error('dongle-not-connected')
    const atSec = Math.max(0, (Date.now() - connectedAt) / 1000)
    return { atSec, ...(label !== undefined ? { label } : {}) }
  },

  async getDeviceInfo() {
    if (!connected) throw new Error('dongle-not-connected')
    const info: DongleInfo = { name: DEVICE.name, batteryPct: 87, firmware: 'demo-1.0' }
    return info
  },
}
