# Anker 录音豆（soundcore Work 3200）集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `anker` 分支落地 `RecordingDonglePort` 端口 + mock 适配器 + 采集页音频源切换 + 重点标记全链路，使录音豆音频可无缝进入现有 STT/落库管线，为 9.27 预赛材料与决赛真 SDK 集成（只换适配器）做好准备。

**Architecture:** 沿用端口/适配器分层——新端口 `RecordingDonglePort` 独立于 `CapturePort`（连接生命周期+硬件元数据+重点标记是独立概念）；mock 适配器产出**真实 MediaStream**（getUserMedia 包装），下游 MediaRecorder/Paraformer STT/OPFS 管线零改动复用。重点标记落在 `AudioPart.marks`（可选字段，向后兼容），详情页回放器渲染标记点。

**Tech Stack:** React 19 + TS strict + Zustand + Vitest（jsdom）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-09-10-anker-hackathon-dongle-design.md`

## Global Constraints

- TS strict：`verbatimModuleSyntax`（类型 import 必须 `import type`）、`erasableSyntaxOnly`（禁 enum/namespace/参数属性）、`noUnusedLocals/Parameters`。
- 子智能体自检用 `npx tsc -p tsconfig.app.json`（**不是** `npm run typecheck`，避免 tsbuildinfo 竞态）。
- 单测 Vitest：`npx vitest run <file>`。测试文件放 `src/adapters/__tests__/`。
- 类别/产品铁律不涉及本计划；勿碰 `components/`、`router.tsx`、`AppShell.tsx`、`domain/` 以外的他人文件（`domain/types.ts` 只加可选字段）。
- 注释风格：中文、解释「为什么」、引用实锤日期/缺陷号（参照 webCapture.ts 现有注释密度）。
- 每个 Task 结束 commit（由 lead 统一执行时除外——subagent 只回报完成）。
- i18n：新增文案 zh+en 双语都要加（`src/app/i18n/zh/capture.ts` + `en/capture.ts` 等）。

---

### Task 1: Domain 类型 + `RecordingDonglePort` 端口定义

**Files:**
- Modify: `src/domain/types.ts:18-29`（AudioPart 加 `marks`）
- Modify: `src/ports/index.ts`（文件尾追加端口）
- Test: `src/adapters/__tests__/mockDongle.test.ts`（Task 2 会用；本 Task 先建骨架文件占位不建——测试随 Task 2 一起写）

**Interfaces:**
- Produces: `DongleState` / `DongleDevice` / `DongleInfo` / `RecordingDonglePort` / `AudioMark` 类型（Task 2-5 全部依赖，签名见步骤代码）

- [ ] **Step 1: AudioPart 加可选 `marks` 字段**

`src/domain/types.ts` 的 `AudioPart` 接口，在 `mediaType?: MediaType` 之前插入：

```ts
  // 录音豆重点标记（Anker 赛道一）。录音中设备按键/UI 按钮打的时间点；
  // 可选——普通麦克风录音、旧条目均无此字段。详情页回放器渲染可点击跳转。
  marks?: AudioMark[]
```

并在 `PartType` 定义之前（文件顶部类型区）加：

```ts
// 录音豆重点标记：atSec = 相对音频开始的秒数（音频 part 的时长基准）。
export interface AudioMark {
  atSec: number
  label?: string
}
```

- [ ] **Step 2: 端口定义追加到 `src/ports/index.ts` 文件尾**

```ts
// ── Anker 录音豆（soundcore Work 3200）端口 ──────────────────────
// 赛道一「智能录音」：官方移动端 SDK 能力 = 录音 / 重点标记 / 状态信息。
// 预赛前（SDK 未发放）以 mockDongle 适配器顶位；真 SDK 到手只换适配器，
// UI/Domain/STT 管线零改动（端口/适配器分层第三次验证：PWA→Capacitor→录音豆）。
// 设计决策：独立端口不并入 CapturePort——连接生命周期 + 硬件元数据 + 标记
// 是硬件概念，CapturePort 已有 9 个 camera/gallery 方法，再塞会失控。
export type DongleState = 'idle' | 'scanning' | 'connected' | 'recording'

export interface DongleDevice {
  id: string
  name: string
}

export interface DongleInfo {
  name: string
  batteryPct?: number
  firmware?: string
}

export interface RecordingDonglePort {
  /** 状态机：idle → scanning → connected → recording（回退沿同路径）。cb 返回 unsubscribe。 */
  onStateChange(cb: (s: DongleState, device?: DongleDevice) => void): () => void
  /** 扫描附近设备。空数组 = 无设备（UI 引导重扫）。 */
  scan(): Promise<DongleDevice[]>
  /** 连接指定设备。未扫描直接连接 → 适配器自行 throw（UI catch 显错误）。 */
  connect(deviceId: string): Promise<void>
  /** 断开。未连接时安全 no-op。 */
  disconnect(): Promise<void>
  /**
   * 已连接设备的音频流。形态对齐 getUserMedia 返回值——下游 MediaRecorder /
   * Paraformer WS / 波形抽头零改动复用，这是「mock 可无缝换真 SDK」的铰链。
   * 未连接 → throw 'dongle-not-connected'。
   */
  getAudioStream(): Promise<MediaStream>
  /** SDK 已知能力：重点标记。返回相对录音开始的秒数（由适配器计时）。 */
  markHighlight(label?: string): Promise<{ atSec: number }>
  /** 设备元数据（电量/固件）。未连接 → throw 'dongle-not-connected'。 */
  getDeviceInfo(): Promise<DongleInfo>
}
```

- [ ] **Step 3: typecheck**

Run: `npx tsc -p tsconfig.app.json`
Expected: 零错误（纯类型追加，无消费方）

- [ ] **Step 4: Commit**

```bash
git add src/domain/types.ts src/ports/index.ts
git commit -m "feat(dongle): RecordingDonglePort 端口 + AudioPart.marks 域类型"
```

---

### Task 2: `mockDongle` 适配器（状态机 + 标记计时）

**Files:**
- Create: `src/adapters/mockDongle.ts`
- Test: `src/adapters/__tests__/mockDongle.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `RecordingDonglePort` / `DongleState` / `DongleDevice` / `DongleInfo`
- Produces: `export const mockDongle: RecordingDonglePort`（Task 3 di 注册、Task 5 store 调用）；`export function __resetMockDongle(): void`（测试隔离用）

- [ ] **Step 1: 写失败测试**

`src/adapters/__tests__/mockDongle.test.ts`：

```ts
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
    expect(states).toEqual(['scanning'])
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/adapters/__tests__/mockDongle.test.ts`
Expected: FAIL — `Cannot find module '@/adapters/mockDongle'`

- [ ] **Step 3: 实现 mockDongle**

`src/adapters/mockDongle.ts`：

```ts
import type { DongleDevice, DongleInfo, DongleState, RecordingDonglePort } from '@/ports'

// 录音豆 mock 适配器（Anker 黑客松赛道一）。官方 SDK 09-30 后才向入围队伍发放，
// 本适配器按赛题原文三能力（录音/重点标记/状态信息）顶位：
// - 音频是真的：getAudioStream 直接 getUserMedia 包装——真机演示 STT/落库全链路真实可用；
// - 设备是假的：scan 恒返一台「soundcore Work 3200 (Demo)」，连接 800ms 模拟配对延迟。
// 真 SDK 到手后写 ankerDongle.ts 平行适配器，di 一行切换，其余零改动。
// 连接时起计时器：markHighlight 的 atSec = 相对 connect 的秒数（对齐「录音开始」的
// 朴素假设——采集页先连接后开录，误差 ≤ 连接→开录间隔）。

const DEVICE: DongleDevice = { id: 'mock-work-3200', name: 'soundcore Work 3200 (Demo)' }

let state: DongleState = 'idle'
let connected: DongleDevice | null = null
let connectedAt = 0
let listeners: Array<(s: DongleState, d?: DongleDevice) => void> = []

function setState(s: DongleState, d?: DongleDevice) {
  state = s
  listeners.forEach((cb) => cb(s, d))
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
```

注意：`state` 变量当前只写不读（onStateChange 是推送模型）——若 `noUnusedLocals` 报错，`state` 赋值改 `void state` 或删局部变量直接广播（实现时以 tsc 通过为准，保留推送语义）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/adapters/__tests__/mockDongle.test.ts`
Expected: 6 PASS

- [ ] **Step 5: typecheck + commit**

```bash
npx tsc -p tsconfig.app.json
git add src/adapters/mockDongle.ts src/adapters/__tests__/mockDongle.test.ts
git commit -m "feat(dongle): mockDongle 适配器——扫描/连接/音频流/重点标记，音频真实设备模拟"
```

---

### Task 3: di 注册 + store dongle 状态切片

**Files:**
- Modify: `src/app/di.ts`（import + Di 接口 + di 对象）
- Modify: `src/app/store.ts`（dongle 切片 + 动作）

**Interfaces:**
- Consumes: Task 2 `mockDongle`、Task 1 端口类型
- Produces: `di.dongle: RecordingDonglePort`；store：`useUiStore` 上 `dongle: { state: DongleState; device?: DongleDevice; info?: DongleInfo; scanning: boolean }` 与动作 `scanDongle()` / `connectDongle(deviceId)` / `disconnectDongle()` / `markHighlight()` / `subscribeDongle()`（Task 4 UI、Task 5 标记消费）

- [ ] **Step 1: di.ts 注册**

在 `src/app/di.ts`：import 区加 `import { mockDongle } from '@/adapters/mockDongle'`；type import 加 `RecordingDonglePort`；`Di` 接口与 `di` 对象各加一行：

```ts
  // Anker 录音豆——mock 顶位，真 SDK 到手换 ankerDongle 适配器（只改此行）。
  dongle: RecordingDonglePort
```

```ts
  dongle: mockDongle,
```

- [ ] **Step 2: store.ts dongle 切片**

`src/app/store.ts`——先看现有 `CaptureDraft`/`chatVoice` 的写法位置（约 120/273 行），在同区追加：

状态（interface 内，`chatVoice` 旁）：

```ts
  dongle: { state: DongleState; device?: DongleDevice; info?: DongleInfo; scanning: boolean }
```

初始值（约 273 行 chatVoice 初值旁）：

```ts
  dongle: { state: 'idle' as DongleState, scanning: false },
```

动作（interface actions 区 + 实现区；订阅放 AppShell 太重，UI 挂载时自调 `subscribeDongle()`）：

```ts
  // ── Anker 录音豆状态切片 ── mockDongle 状态机镜像 + 扫描/连接动作。
  // subscribeDongle：端口状态推送 → store 镜像（UI 只读 store，不直碰 di.dongle 回调）。
  // AppShell/capture 挂载时调一次；幂等（重复调不叠加 listener——用模块级 flag 守卫）。
  scanDongle: () => Promise<DongleDevice[]>
  connectDongle: (deviceId: string) => Promise<void>
  disconnectDongle: () => Promise<void>
```

实现（沿用 store 现有 `set`/`get` 模式）：

```ts
  let dongleSubscribed = false
  subscribeDongle: () => {
    if (dongleSubscribed) return
    dongleSubscribed = true
    di.dongle.onStateChange((s, device) =>
      set((st) => ({ dongle: { ...st.dongle, state: s, ...(device ? { device } : {}) } })),
    )
  },
  scanDongle: async () => {
    set((s) => ({ dongle: { ...s.dongle, scanning: true } }))
    try {
      return await di.dongle.scan()
    } finally {
      set((s) => ({ dongle: { ...s.dongle, scanning: false } }))
    }
  },
  connectDongle: async (deviceId) => {
    await di.dongle.connect(deviceId)
    const info = await di.dongle.getDeviceInfo().catch(() => undefined)
    set((s) => ({ dongle: { ...s.dongle, info } }))
  },
  disconnectDongle: async () => {
    await di.dongle.disconnect()
    set((s) => ({ dongle: { state: 'idle', device: undefined, info: undefined, scanning: false } }))
  },
```

`import type { DongleDevice, DongleInfo, DongleState } from '@/ports'` 加到 store.ts 头部（store 已 import di，模式照旧）。

- [ ] **Step 3: typecheck**

Run: `npx tsc -p tsconfig.app.json`
Expected: 零错误

- [ ] **Step 4: Commit**

```bash
git add src/app/di.ts src/app/store.ts
git commit -m "feat(dongle): di 注册 mockDongle + store dongle 状态切片与扫描/连接动作"
```

---

### Task 4: 采集页音频源切换 + 录音豆扫描/连接 UI

**Files:**
- Modify: `src/ui/screens/capture/widgets.tsx`（新增 `DongleSourceChip` / `DongleSheet`）
- Modify: `src/ui/screens/capture/index.tsx`（源切换接入 handleVoice、挂载订阅、DongleSheet 状态）
- Modify: `src/app/i18n/zh/capture.ts` + `en/capture.ts`（文案）
- Test: 手动 e2e 验证（本 Task 无单测——UI 组件薄、状态全在已测的 store/适配器层；验收走浏览器）

**Interfaces:**
- Consumes: Task 3 store 动作与 `dongle` 状态、Task 2 `di.dongle.getAudioStream()`
- Produces: `DongleSourceChip`（导出）、`DongleSheet`（导出）；capture 屏新增行为——**录音豆已连接时 `startRecording` 用 `di.dongle.getAudioStream()` 替代麦克风直采**（改动点在 store.ts `startRecording`，见 Step 2）

**设计说明——音频源切换的落点**：不在 CapturePort 加参数（会让所有适配器签名爆炸），而是 store.startRecording 内分流：`dongle.state === 'connected'` → `webCapture.startAudioFromStream(await di.dongle.getAudioStream())`。给 `webCapture` 加一个导出函数：

- [ ] **Step 1: webCapture 加 `startAudioFromStream`**

`src/adapters/webCapture.ts`——把现 `startAudio` 的「取流之后」逻辑抽出复用：

```ts
// 录音豆入口：外部 MediaStream（di.dongle.getAudioStream()）替代 getUserMedia，
// 其余（MediaRecorder/波形抽头/WebSpeech live 预览）与麦克风路径完全一致。
// WebSpeech 仍走系统麦克风（它无法吃外部流）——录音豆场景 live 预览可能串味，
// 但 final 转写走 Paraformer（吃录到的 blob），正确性不受影响；live 预览在
// 录音豆场景关闭（传 onInterim/onFinal 的调用方决定，见 store.startRecording）。
export async function startAudioFromStream(
  external: MediaStream,
  opts: { onInterim?: (text: string) => void; onFinal?: (text: string) => void } = {},
): Promise<void> {
  stream = external
  chunks = []
  if (typeof MediaRecorder !== 'undefined') {
    try {
      recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.start(1000) // 同 startAudio：timeslice 防长录音容器损坏
    } catch (e) {
      console.error('[webCapture] MediaRecorder construction failed (dongle)', e)
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      recorder = null
    }
  }
  startedAt = Date.now()
  try {
    if (stream) {
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      micAnalyser = audioCtx.createAnalyser()
      micAnalyser.fftSize = 256
      micAnalyser.smoothingTimeConstant = 0.75
      source.connect(micAnalyser)
    }
  } catch {
    audioCtx = null
    micAnalyser = null
  }
  const Ctor = getSpeechRecognitionCtor()
  if (Ctor && opts.onInterim) { // 录音豆路径不传 → 跳过 WebSpeech（见上方注释）
    recognition = new Ctor()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (ev) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        if (r.isFinal) opts.onFinal?.(Chinese.t2s(r[0].transcript))
        else interim += r[0].transcript
      }
      if (interim) opts.onInterim?.(Chinese.t2s(interim))
    }
    recognition.onerror = () => { /* swallow */ }
    try { recognition.start() } catch { /* already running */ }
  }
}
```

（实现时优先把 `startAudio` 中段重构为共享私有函数以消重——两处 timeslice/波形抽头逻辑必须保持一致；若重构风险大，允许先复制后标 TODO 由 lead 决定是否合并。）

- [ ] **Step 2: store.startRecording 分流**

`src/app/store.ts` `startRecording` 改为：

```ts
  startRecording: async () => {
    set((s) => ({ capture: { ...s.capture, finalized: '', interim: '' } }))
    get().primeLocation()
    try {
      const onInterim = (t: string) => set((s) => ({ capture: { ...s.capture, interim: t } }))
      const onFinal = (t: string) => set((s) => ({ capture: { ...s.capture, finalized: s.capture.finalized + t, interim: '' } }))
      // 录音豆已连接 → 外部流直采（Anker 赛道一）。WebSpeech live 预览关闭
      //（它吃不到外部流，只会串系统麦克风音）；final 转写由 Paraformer blob 管线兜底。
      if (get().dongle.state === 'connected') {
        const ext = await di.dongle.getAudioStream()
        await startAudioFromStream(ext) // 不传 opts → 无 live 预览
      } else {
        await di.capture.startAudio({ onInterim, onFinal })
      }
      set((s) => ({ capture: { ...s.capture, recording: true } }))
    } catch (e) {
      console.error('[store] startAudio failed', e)
      set((s) => ({ capture: { ...s.capture, recording: false, micDenied: true } }))
    }
  },
```

（`startAudioFromStream` 从 `@/adapters/webCapture` import。）

- [ ] **Step 3: i18n 文案**

`src/app/i18n/zh/capture.ts` 追加：

```ts
  'capture.dongle.source': '录音豆',
  'capture.dongle.mic': '麦克风',
  'capture.dongle.scanTitle': '连接录音豆',
  'capture.dongle.scanDesc': '扫描附近的 soundcore Work 3200',
  'capture.dongle.scanning': '正在扫描…',
  'capture.dongle.rescan': '重新扫描',
  'capture.dongle.connect': '连接',
  'capture.dongle.connected': '已连接',
  'capture.dongle.disconnect': '断开',
  'capture.dongle.battery': '电量',
  'capture.dongle.mark': '标记重点',
  'capture.dongle.marked': '已标记',
```

`en/capture.ts` 对应英文（`'Recording Dongle'` / `'Microphone'` / `'Connect Recording Dongle'` / `'Scan nearby soundcore Work 3200'` / `'Scanning…'` / `'Rescan'` / `'Connect'` / `'Connected'` / `'Disconnect'` / `'Battery'` / `'Mark highlight'` / `'Marked'`）。

- [ ] **Step 4: DongleSourceChip + DongleSheet 组件**

`src/ui/screens/capture/widgets.tsx` 追加（复用 Chip/Button 等原语，lucide 图标 `Bluetooth` / `Bookmark`，样式类沿用 VoiceBar/工具栏现有 token）：

```tsx
// ── Anker 录音豆：音频源切换 chip ──
// 采音默认麦克风；chip 切到「录音豆」态 = startRecording 分流到 dongle 外部流。
// 已连接时显示设备名+电量徽标；未连接时点击弹 DongleSheet 扫描连接。
export function DongleSourceChip({
  active, connected, batteryPct, onClick,
}: {
  active: boolean
  connected: boolean
  batteryPct?: number
  onClick: () => void
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-chip px-2.5 py-1.5 text-[11px] font-medium transition duration-base ease-out cursor-pointer focus-visible:ring-2 focus-visible:ring-pri/40 outline-none ${
        active ? 'bg-priS text-pri border border-pri/30' : 'bg-card text-t2 border border-brd'
      }`}
    >
      <Bluetooth size={13} strokeWidth={2} />
      {t('capture.dongle.source')}
      {connected && batteryPct !== undefined && (
        <span className="text-t3">{batteryPct}%</span>
      )}
    </button>
  )
}

// ── 录音豆扫描/连接 sheet ── 列表 + 连接/断开。mock 恒一台设备。
export function DongleSheet({
  open, onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const dongle = useUiStore((s) => s.dongle)
  const scanDongle = useUiStore((s) => s.scanDongle)
  const connectDongle = useUiStore((s) => s.connectDongle)
  const disconnectDongle = useUiStore((s) => s.disconnectDongle)
  const [devices, setDevices] = useState<DongleDevice[]>([])
  const [connecting, setConnecting] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void scanDongle().then(setDevices).catch(() => setDevices([]))
  }, [open, scanDongle])

  if (!open) return null
  const isConnected = dongle.state === 'connected'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="w-full max-w-[420px] rounded-t-[32px] bg-card p-5 pb-8 shadow-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[17px] font-bold text-ink">{t('capture.dongle.scanTitle')}</p>
        <p className="mt-1 text-[12px] text-t2">{t('capture.dongle.scanDesc')}</p>
        <div className="mt-4 space-y-2">
          {isConnected && dongle.device ? (
            <div className="flex items-center justify-between rounded-card border border-pri/30 bg-priS/50 px-3 py-2.5">
              <span className="text-[13px] font-medium text-ink">{dongle.device.name}</span>
              <div className="flex items-center gap-2">
                {dongle.info?.batteryPct !== undefined && (
                  <span className="text-[11px] text-t2">{t('capture.dongle.battery')} {dongle.info.batteryPct}%</span>
                )}
                <button type="button" onClick={() => void disconnectDongle()} className="text-[12px] font-medium text-catFail cursor-pointer">
                  {t('capture.dongle.disconnect')}
                </button>
              </div>
            </div>
          ) : dongle.scanning ? (
            <p className="py-6 text-center text-[13px] text-t3">{t('capture.dongle.scanning')}</p>
          ) : devices.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-[13px] text-t3">—</p>
              <button type="button" onClick={() => void scanDongle().then(setDevices)} className="mt-2 text-[12px] font-medium text-pri cursor-pointer">
                {t('capture.dongle.rescan')}
              </button>
            </div>
          ) : (
            devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-card border border-brd px-3 py-2.5">
                <span className="text-[13px] font-medium text-ink">{d.name}</span>
                <button
                  type="button"
                  disabled={connecting !== null}
                  onClick={async () => {
                    setConnecting(d.id)
                    try { await connectDongle(d.id) } finally { setConnecting(null) }
                  }}
                  className="rounded-btn bg-pri px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 cursor-pointer"
                >
                  {connecting === d.id ? '…' : t('capture.dongle.connect')}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

（import 补齐：`useEffect`/`useState` from react、`Bluetooth` from lucide-react、`useUiStore`、`useT`、`import type { DongleDevice } from '@/ports'`——照 widgets.tsx 现有 import 风格。）

- [ ] **Step 5: capture/index.tsx 接线**

- 挂载时 `useEffect(() => { subscribeDongle() }, [subscribeDongle])`
- 采集工具栏（现有语音按钮旁）放 `<DongleSourceChip active={dongleMode} connected={dongle.state==='connected'} batteryPct={dongle.info?.batteryPct} onClick={() => dongle.state==='connected' ? setDongleSheetOpen(false) || void disconnectDongle() : setDongleSheetOpen(true)} />`——本组件 chip 表达「音频源偏好」：`active` 为本地 state `dongleMode`，点击已连接时断开并回落麦克风；未连接时开 sheet
- `handleVoice` 开头加守卫：`if (dongleMode && dongle.state !== 'connected') { setDongleSheetOpen(true); return }`（源选了录音豆但没连接 → 引导连接，不静默落回麦克风）
- 渲染 `<DongleSheet open={dongleSheetOpen} onClose={() => setDongleSheetOpen(false)} />`
- **录音中且 dongleMode**：在 VoiceBar 上方渲染「标记重点」按钮（`di.dongle.markHighlight()` 的结果由 Task 5 接管进 capture.draftMarks；本 Task 先 `console.log` 占位并 commit，Task 5 替换）——本 Task 按钮先用 toast 反馈 `t('capture.dongle.marked')`

- [ ] **Step 6: 手动 e2e 验证（dev server）**

Run: `npm run dev` → 浏览器 390×844 → capture 页
Verify: ① 点 chip → sheet 弹出 → 扫描出 Work 3200 (Demo) → 连接 → chip 显电量；② 录音豆源下点语音 → 录音条出现、波形动（getUserMedia 真流）；③ 停止 → part 落列表；④ 麦克风源回归原路径不受影响；⑤ console 无 error。

- [ ] **Step 7: typecheck + commit**

```bash
npx tsc -p tsconfig.app.json
git add src/adapters/webCapture.ts src/app/store.ts src/ui/screens/capture/ src/app/i18n/
git commit -m "feat(dongle): 采集页音频源切换+扫描连接 sheet，录音豆外流直采 startAudioFromStream"
```

---

### Task 5: 重点标记全链路（capture 落 part → detail 回放跳转）

**Files:**
- Modify: `src/app/store.ts`（`capture.draftMarks` + `markHighlight` 动作 + `stopRecording` 落 marks）
- Modify: `src/ui/screens/detail/PartView.tsx`（AudioPlayer 渲染标记点、点击 seek）
- Modify: `src/ui/screens/capture/index.tsx`（VoiceBar 区标记按钮接 store 动作）
- Test: `src/adapters/__tests__/dongleMarks.test.ts`

**Interfaces:**
- Consumes: Task 1 `AudioMark`/`AudioPart.marks`、Task 4 VoiceBar 区标记按钮占位
- Produces: store `markHighlight()` 动作（录音中调用 → `capture.draftMarks` 追加）；`stopRecording` 在 dongle 源录音的 audio part 上写 `marks`

- [ ] **Step 1: 写失败测试**

`src/adapters/__tests__/dongleMarks.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/store'

// 纯 store 逻辑测试：markHighlight 累积 → stopRecording 把 draftMarks 写进 audio part。
// di.dongle.markHighlight 用假实现（atSec 由调用序号推算）。
vi.mock('@/app/di', async () => {
  const actual = await vi.importActual<typeof import('@/app/di')>('@/app/di')
  let n = 0
  return {
    ...actual,
    di: {
      ...actual.di,
      dongle: {
        ...actual.di.dongle,
        markHighlight: async () => ({ atSec: ++n }),
      },
    },
  }
})

beforeEach(() => {
  useUiStore.setState({
    capture: { ...useUiStore.getState().capture, draftMarks: [], recording: true },
    dongle: { state: 'connected', scanning: false },
  })
})

describe('录音豆重点标记 store 链路', () => {
  it('markHighlight 累积进 capture.draftMarks（含 label）', async () => {
    await useUiStore.getState().markHighlight('关键结论')
    await useUiStore.getState().markHighlight()
    const marks = useUiStore.getState().capture.draftMarks
    expect(marks).toHaveLength(2)
    expect(marks[0]).toEqual({ atSec: 1, label: '关键结论' })
    expect(marks[1]?.label).toBeUndefined()
  })

  it('dongle 源录音 stopRecording → audio part 带 marks；麦克风源不带', async () => {
    await useUiStore.getState().markHighlight()
    // dongle.state==='connected'（beforeEach 设定）→ part 应带 marks
    // stopAudio mock：返回极小 blob-less 结果（blob undefined → 不走 saveMedia）
    // （di.capture.stopAudio 未 mock 也能跑：webCapture 无 recorder 时返回空结果——
    //  jsdom 下 MediaRecorder undefined，走 transcript-only 路径。）
    await useUiStore.getState().stopRecording()
    const part = useUiStore.getState().capture.parts.at(-1)
    expect(part?.type).toBe('audio')
    if (part?.type === 'audio') expect(part.marks).toHaveLength(1)

    // 回落麦克风源：dongle.state='idle' → 新 part 无 marks 字段
    useUiStore.setState({ capture: { ...useUiStore.getState().capture, recording: true }, dongle: { state: 'idle', scanning: false } })
    await useUiStore.getState().stopRecording()
    const part2 = useUiStore.getState().capture.parts.at(-1)
    if (part2?.type === 'audio') expect(part2.marks).toBeUndefined()
  })
})
```

（`capture.draftMarks` 若不在 CaptureDraft 类型上需一并加：`draftMarks: AudioMark[]`，`emptyDraft` 初始 `[]`，`clearDraft`/`finishSave` 复位 `[]`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/adapters/__tests__/dongleMarks.test.ts`
Expected: FAIL — `markHighlight is not a function`

- [ ] **Step 3: store 实现**

`src/app/store.ts`：

- `CaptureDraft` 加 `draftMarks: AudioMark[]`（import type AudioMark from '@/domain/types'）；`emptyDraft` 加 `draftMarks: []`
- 动作声明加 `markHighlight: (label?: string) => Promise<void>`，实现：

```ts
  markHighlight: async (label) => {
    if (!get().capture.recording) return
    try {
      const { atSec } = await di.dongle.markHighlight(label)
      set((s) => ({
        capture: {
          ...s.capture,
          draftMarks: [...s.capture.draftMarks, { atSec, ...(label !== undefined ? { label } : {}) }],
        },
      }))
    } catch (e) {
      console.error('[store] markHighlight failed', e) // 标记失败不伤录音主链路
    }
  },
```

- `stopRecording` 的 part 构造改为（dongle 源才写 marks；麦克风源无字段保持向后兼容）：

```ts
    const fromDongle = get().dongle.state === 'connected'
    const marks = get().capture.draftMarks
    const part: EntryPart = {
      type: 'audio', ref: result.ref,
      durationSec: Math.max(1, Math.round(result.durationSec)),
      transcript, mime: result.mime, mediaType: 'audio',
      ...(fromDongle && marks.length > 0 ? { marks } : {}),
    }
    // draftMarks 消费完即清（同 finalized/interim 复位）
```

`set` 里 `capture: { ..., draftMarks: [] }` 复位。`clearDraft`（set capture: emptyDraft 已覆盖）与 `finishSave`（emptyDraft 同）自动复位。

**标记时序注意**：mock 适配器 `atSec` 是「相对 connect」的秒数，而 part 的 `durationSec` 是「相对录音开始」。连接→开录间隔若 >0，标记点整体偏早。修正：store 在 `startRecording` 成功后记 `recordStartedAt = Date.now()`，`markHighlight` 的 `atSec` 改用 `markHighlight()` 返回值 **减去** `(recordStartedAt - dongleConnectedAt)/1000`——但这要求适配器暴露 connectedAt，污染端口。**更简方案**：mock 适配器的 `markHighlight` 改为「首次调用时锚定」——内部 `markEpoch` 初始 null，首调置 `Date.now()`，后续 atSec 相对 markEpoch。仍不完美（首标记前的标记全为 0）。**最终方案**（采用）：端口语义定为「相对 getAudioStream 调用」，mock 内部在 `getAudioStream` 成功时重置 `connectedAt`；store 每次开录都会调 getAudioStream → 锚点即录音开始。Task 2 的 mockDongle 同步改：`getAudioStream` 成功路径 `connectedAt = Date.now()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/adapters/__tests__/dongleMarks.test.ts`
Expected: 2 PASS

- [ ] **Step 5: detail 回放器渲染标记点**

`src/ui/screens/detail/PartView.tsx` `AudioPlayer`——签名加 `marks?: AudioMark[]`；`toggle` 旁加 seek；渲染进度条上叠加标记圆点（绝对定位百分比 = atSec/durationSec）：

```tsx
export function AudioPlayer({ mediaRef, durationSec, marks }: { mediaRef: string; durationSec: number; marks?: AudioMark[] }) {
  // …既有状态不变…
  const seekTo = (sec: number) => {
    const a = audioRef.current
    if (!a || status !== 'ready') return
    a.currentTime = sec
    void a.play(); setPlaying(true)
  }
  // 在播放按钮 + 时长行下方追加：
  {marks && marks.length > 0 && (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {marks.map((m, i) => (
        <button
          key={i}
          type="button"
          onClick={() => seekTo(m.atSec)}
          className="flex items-center gap-1 rounded-chip bg-priS px-2 py-1 text-[11px] font-medium text-pri cursor-pointer"
        >
          <Bookmark size={11} strokeWidth={2.2} />
          {m.label ?? `重点 ${i + 1}`}
          <span className="text-t3">{fmtDur(m.atSec)}</span>
        </button>
      ))}
    </div>
  )}
}
```

（`fmtDur` 已有（capture/widgets 或 detail/helpers——按现有 import 链取）；`Bookmark` from lucide-react。调用点 `detail/index.tsx:196` 与 `PartView.tsx:352` 的 `<AudioPlayer>` 都传 `marks={part.marks}`。）

- [ ] **Step 6: capture 标记按钮接 store**

`src/ui/screens/capture/index.tsx`——Task 4 的占位按钮换成 `void markHighlight()`（store 动作）+ toast `t('capture.dongle.marked')`；只在 `capture.recording && dongleMode` 时显示。

- [ ] **Step 7: 全量验证**

```bash
npx tsc -p tsconfig.app.json
npx vitest run src/adapters/__tests__/mockDongle.test.ts src/adapters/__tests__/dongleMarks.test.ts
npm run dev  # 手动：录音豆源录音中打 2 个标记（一个带 label 试弹窗输入？——v1 简化：无 label，纯按钮）→ 保存 → detail 见标记 chip → 点击跳转播放
```

- [ ] **Step 8: Commit**

```bash
git add src/app/store.ts src/ui/screens/detail/ src/ui/screens/capture/ src/adapters/mockDongle.ts src/adapters/__tests__/dongleMarks.test.ts
git commit -m "feat(dongle): 重点标记全链路——录音中标记→audio part marks→detail 回放跳转"
```

---

### Task 6: 收尾——README/anker 文档更新 + e2e 全量验收

**Files:**
- Modify: `docs/anker-hackathon/README.md`（待确认事项更新：SDK 官方 09-30 后发放；集成现状）
- Modify: `README.md`（§6 分支更新日志追加 `anker` 段）
- Modify: `docs/roadmap.md`（Anker 赛道一节）

**Interfaces:** Consumes: Task 1-5 全部成果（文档如实描述）

- [ ] **Step 1: 更新 `docs/anker-hackathon/README.md`**

- 「待确认事项」五条 checkbox 逐条更新：SDK 形态=官方移动端 SDK（09-30 后发放，来源：官网 FAQ 评审与入围篇）；预赛前无 SDK 是全局事实（非我们独有）
- 「集成方案」段落替换为实际落地架构（RecordingDonglePort + mockDongle + startAudioFromStream 分流 + AudioPart.marks）
- 新增「预赛材料进度」小节跟踪文档/视频状态

- [ ] **Step 2: README.md §6 追加 anker 分支段**

```markdown
### anker（基于 v2.5，2026-09-10）

**主要更新**——Anker 黑客松赛道一「智能录音」：录音豆（soundcore Work 3200）Port 先行集成

- **RecordingDonglePort 端口**：连接生命周期/音频流/重点标记/设备信息，独立于 CapturePort（<commit>）
- **mockDongle 适配器**：模拟扫描/连接/电量，音频走真实 getUserMedia——真 SDK（09-30 后发放）到手只换适配器
- **采集页音频源切换**：麦克风 ↔ 录音豆 chip + 扫描连接 sheet；录音豆源外流直采（startAudioFromStream）
- **重点标记全链路**：录音中标记重点 → AudioPart.marks → 详情页回放器标记点点击跳转

**后续 / 待办**

- 09-27 预赛材料（作品说明文档+演示视频）
- 出线后（09-30）真 SDK 适配器 ankerDongle.ts 替换 mock
```

（commit 短码由执行者回填真实值。）

- [ ] **Step 3: roadmap.md 加 Anker 赛道节**

在「后置/不做」前插入进行中节：目标、时间线（09-27/09-30/10.16-17）、已完成任务引用。

- [ ] **Step 4: e2e 全量验收（prod build）**

```bash
npm run build && npm run preview -- --port 4173
```

Playwright/chrome-devtools-mcp，390×844，用例前清 SW+localStorage+IndexedDB，截图存 `.e2e_shots/`：
1. capture → chip → sheet → 扫描 → 连接 → 电量显示（截图）
2. 录音豆源录音 8s + 中途 2 次标记重点 → 停止 → 保存
3. detail：标记 chip 渲染 → 点击跳转播放位置（截图）
4. 麦克风源回归：录音→保存→detail 正常、无 marks 字段
5. 全程 console 无 error

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md
git commit -m "docs: anker 分支更新——录音豆集成现状+赛事情报修正+预赛材料跟踪"
```

---

## Self-Review 结果

- **Spec 覆盖**：§2.1 Port→Task 1；§2.2 mock（含场景剧本）→Task 2（剧本模式**降级为后置**——预赛视频可直接真流录屏，不阻塞主线，写进 Task 6 文档待办）；§2.3 UI→Task 3/4；§2.4 标记链路→Task 5；§2.5 材料、§3 时间线→Task 6 文档（材料本身是独立后续工作，不在本计划）。
- **占位符**：Task 4 Step 5 的 console.log 占位有明确替换点（Task 5 Step 6）；Task 6 commit 短码标注「执行者回填」——均非 TBD。
- **类型一致性**：`AudioMark.atSec/label`、`RecordingDonglePort` 六方法签名、`dongle` store 切片字段、`draftMarks` 在 Task 2/3/5 间已交叉核对一致；Task 5 发现的 atSec 锚点问题已在计划内解决（getAudioStream 重置计时锚）。
