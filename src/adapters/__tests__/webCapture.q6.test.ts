import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// visionMedia 走模块级 mock——本文件测 webCapture 的 Q6 接线（seam 决策表 / pickMedia
// 图片归一化 / 视频 posterBlob 透传 / capturePhoto / stopVideo），不测压缩本身。
vi.mock('@/adapters/visionMedia', () => ({
  compressImageBlob: vi.fn(),
  extractFrame: vi.fn(),
}))

import { webCapture, normalizeImageBlob } from '@/adapters/webCapture'
import { compressImageBlob, extractFrame } from '@/adapters/visionMedia'

const compressImageBlobMock = vi.mocked(compressImageBlob)
const extractFrameMock = vi.mocked(extractFrame)

// jsdom 无 URL.createObjectURL / 视频 metadata 加载 / MediaRecorder / getUserMedia ——
// 全部 mock 边界。document.createElement('video') 换成自动触发 onloadedmetadata 的假元素
//（pickMedia 时长探测用）；其余 tag 直通真实 jsdom 元素。
let videoDuration = 2

function makeFakeVideo(): HTMLVideoElement {
  const handlers: { onloadedmetadata: (() => void) | null; onerror: (() => void) | null } = {
    onloadedmetadata: null,
    onerror: null,
  }
  const v = {
    preload: '',
    duration: videoDuration,
    get onloadedmetadata() { return handlers.onloadedmetadata },
    set onloadedmetadata(fn: (() => void) | null) { handlers.onloadedmetadata = fn },
    get onerror() { return handlers.onerror },
    set onerror(fn: (() => void) | null) { handlers.onerror = fn },
    set src(_val: string) { queueMicrotask(() => handlers.onloadedmetadata?.()) },
    get src() { return '' },
  }
  return v as unknown as HTMLVideoElement
}

const origCreateElement = document.createElement.bind(document)

beforeEach(() => {
  compressImageBlobMock.mockReset()
  extractFrameMock.mockReset()
  videoDuration = 2
  vi.spyOn(document, 'createElement').mockImplementation(((
    tagName: string,
  ) => (tagName === 'video' ? makeFakeVideo() : origCreateElement(tagName))) as unknown as typeof document.createElement)
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
})

afterEach(async () => {
  await webCapture.stopCamera()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// pickMedia 建隐藏 <input type=file> 挂 onchange——注入 files 后 dispatch change 即 settle
//（onchange 先于 30s 硬超时触发，真实定时器即可）。
async function pickWithFile(file: File) {
  const p = webCapture.pickMedia()
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  expect(input).not.toBeNull()
  Object.defineProperty(input!, 'files', { value: [file], configurable: true })
  input!.dispatchEvent(new Event('change'))
  return p
}

describe('normalizeImageBlob seam 决策表', () => {
  it('压缩成功且更小 → 压缩 blob + image/jpeg', async () => {
    const raw = new Blob(['x'.repeat(1000)], { type: 'image/png' })
    const compressed = new Blob(['y'.repeat(100)], { type: 'image/jpeg' })
    compressImageBlobMock.mockResolvedValue(compressed)
    const r = await normalizeImageBlob(raw, 'image/png')
    expect(r.blob).toBe(compressed)
    expect(r.mime).toBe('image/jpeg')
  })

  it('压缩成功但不更小 → 原始直通（mime 保持）', async () => {
    const raw = new Blob(['x'.repeat(100)], { type: 'image/jpeg' })
    const compressed = new Blob(['y'.repeat(500)], { type: 'image/jpeg' })
    compressImageBlobMock.mockResolvedValue(compressed)
    const r = await normalizeImageBlob(raw, 'image/jpeg')
    expect(r.blob).toBe(raw)
    expect(r.mime).toBe('image/jpeg')
  })

  it('压缩失败（null）→ 原始直通（压缩永不丢媒体）', async () => {
    const raw = new Blob(['x'.repeat(1000)], { type: 'image/png' })
    compressImageBlobMock.mockResolvedValue(null)
    const r = await normalizeImageBlob(raw, 'image/png')
    expect(r.blob).toBe(raw)
    expect(r.mime).toBe('image/png')
  })
})

describe('pickMedia 图片分支（压缩归一化）', () => {
  it('压缩更小 → blob=压缩 JPEG，mime=image/jpeg，kind=image', async () => {
    const file = new File(['x'.repeat(2000)], 'a.png', { type: 'image/png' })
    const compressed = new Blob(['y'.repeat(200)], { type: 'image/jpeg' })
    compressImageBlobMock.mockResolvedValue(compressed)
    const r = await pickWithFile(file)
    expect(r?.kind).toBe('image')
    expect(r?.blob).toBe(compressed)
    expect(r?.mime).toBe('image/jpeg')
    expect(r?.durationSec).toBe(0)
    expect(r?.ref.startsWith('photo-')).toBe(true)
    expect(r?.posterBlob).toBeUndefined()
  })

  it('压缩失败 → 原 file 直通，mime 保持原 type', async () => {
    const file = new File(['x'.repeat(2000)], 'a.png', { type: 'image/png' })
    compressImageBlobMock.mockResolvedValue(null)
    const r = await pickWithFile(file)
    expect(r?.blob).toBe(file)
    expect(r?.mime).toBe('image/png')
  })
})

describe('pickMedia 视频分支（poster 抽帧）', () => {
  it('抽帧成功 → posterBlob 透传（extractFrame 0.1s）', async () => {
    const file = new File(['v'.repeat(100)], 'v.webm', { type: 'video/webm' })
    const poster = new Blob(['p'], { type: 'image/jpeg' })
    extractFrameMock.mockResolvedValue(poster)
    const r = await pickWithFile(file)
    expect(r?.kind).toBe('video')
    expect(r?.durationSec).toBe(2)
    expect(r?.blob).toBe(file)
    expect(r?.mime).toBe('video/webm')
    expect(extractFrameMock).toHaveBeenCalledWith(file, 0.1)
    expect(r?.posterBlob).toBe(poster)
    expect(r?.ref.startsWith('video-')).toBe(true)
  })

  it('抽帧失败（null）→ posterBlob 缺省，主媒体不丢', async () => {
    const file = new File(['v'.repeat(100)], 'v.webm', { type: 'video/webm' })
    extractFrameMock.mockResolvedValue(null)
    const r = await pickWithFile(file)
    expect(r?.kind).toBe('video')
    expect(r?.blob).toBe(file)
    expect(r?.posterBlob).toBeUndefined()
  })
})

// 摄像头用例公共 setup：getUserMedia 假流 + canvas 2d/toBlob mock + live preview 假元素。
const canvasBlob = new Blob(['z'.repeat(5000)], { type: 'image/jpeg' })

async function startFakeCamera(): Promise<void> {
  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream) },
    configurable: true,
  })
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(canvasBlob))
  const preview = {
    videoWidth: 1280,
    videoHeight: 720,
    srcObject: null,
    muted: false,
    play: vi.fn(async () => {}),
  } as unknown as HTMLVideoElement
  await webCapture.startCamera({ preview })
}

describe('capturePhoto（同一归一化 seam）', () => {
  beforeEach(startFakeCamera)

  it('压缩更小 → 返回压缩 JPEG', async () => {
    const compressed = new Blob(['y'.repeat(500)], { type: 'image/jpeg' })
    compressImageBlobMock.mockResolvedValue(compressed)
    const r = await webCapture.capturePhoto()
    expect(r?.blob).toBe(compressed)
    expect(r?.mime).toBe('image/jpeg')
    expect(r?.ref.startsWith('photo-')).toBe(true)
  })

  it('压缩失败 → 原帧直通', async () => {
    compressImageBlobMock.mockResolvedValue(null)
    const r = await webCapture.capturePhoto()
    expect(r?.blob).toBe(canvasBlob)
    expect(r?.mime).toBe('image/jpeg')
  })
})

const recorderInstances: FakeMediaRecorder[] = []
class FakeMediaRecorder {
  static isTypeSupported() { return true }
  state = 'inactive'
  mimeType = 'video/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor() {
    recorderInstances.push(this)
  }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => this.onstop?.())
  }
}

describe('stopVideo（poster 抽帧）', () => {
  beforeEach(async () => {
    recorderInstances.length = 0
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    await startFakeCamera()
    await webCapture.startVideo()
    recorderInstances[0].ondataavailable?.({ data: new Blob(['v'.repeat(100)], { type: 'video/webm' }) })
  })

  it('抽帧成功 → 返回带 posterBlob', async () => {
    const poster = new Blob(['p'], { type: 'image/jpeg' })
    extractFrameMock.mockResolvedValue(poster)
    const r = await webCapture.stopVideo()
    expect(r).not.toBeNull()
    expect(r?.mime).toBe('video/webm')
    expect(r?.durationSec).toBeGreaterThan(0)
    expect(r?.blob.size).toBeGreaterThan(0)
    expect(r?.posterBlob).toBe(poster)
    expect(r?.ref.startsWith('video-')).toBe(true)
  })

  it('抽帧失败（null）→ posterBlob 缺省，主 blob 仍在', async () => {
    extractFrameMock.mockResolvedValue(null)
    const r = await webCapture.stopVideo()
    expect(r).not.toBeNull()
    expect(r?.blob.size).toBeGreaterThan(0)
    expect(r?.posterBlob).toBeUndefined()
  })
})
