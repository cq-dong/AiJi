// Q6 ②（2026-10-05）：CameraView onPart 三参透传——摄像 video 路径把 stopVideo 返回的
// posterBlob 作第三参传给 onPart（由 capture 屏 addMediaPart 落 OPFS poster）；
// photo 路径不传第三参（拍照无 poster）。契约：docs/acceptance/q6-capture-compression.md §②。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { EntryPart } from '@/domain/types'

const { startCameraFn, stopCameraFn, capturePhotoFn, startVideoFn, stopVideoFn } = vi.hoisted(() => ({
  startCameraFn: vi.fn(),
  stopCameraFn: vi.fn(),
  capturePhotoFn: vi.fn(),
  startVideoFn: vi.fn(),
  stopVideoFn: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    capture: {
      startCamera: startCameraFn,
      stopCamera: stopCameraFn,
      capturePhoto: capturePhotoFn,
      startVideo: startVideoFn,
      stopVideo: stopVideoFn,
    },
  },
}))
vi.mock('@/adapters/webCapture', () => ({ getMicAnalyser: vi.fn(() => null) }))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { CameraView } from '@/ui/screens/capture/widgets'
import { setCurrentLang } from '@/app/currentLang'

type OnPart = (part: EntryPart, blob: Blob, posterBlob?: Blob) => void

let container: HTMLDivElement
let root: Root | null = null

async function renderCamera(onPart: OnPart): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<CameraView onPart={onPart} onClose={() => {}} />)
  })
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

// 快门钮：随 mode/recording 切换 aria-label（拍照 / 开始录制 / 停止录制）。
function shutter(): HTMLElement {
  const el = container.querySelector(
    'button[aria-label="拍照"], button[aria-label="开始录制"], button[aria-label="停止录制"]',
  )
  expect(el, '快门钮应存在').toBeTruthy()
  return el as HTMLElement
}

beforeEach(() => {
  setCurrentLang('zh')
  document.body.innerHTML = ''
  vi.clearAllMocks()
  startCameraFn.mockResolvedValue(true)
  stopCameraFn.mockResolvedValue(undefined)
  startVideoFn.mockResolvedValue(undefined)
  root = null
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  container.remove()
})

describe('CameraView onPart 三参透传（Q6 ②）', () => {
  it('video 路径：stopVideo 返 posterBlob → onPart(part, blob, posterBlob)', async () => {
    const videoBlob = new Blob(['v'], { type: 'video/webm' })
    const posterBlob = new Blob(['p'], { type: 'image/jpeg' })
    stopVideoFn.mockResolvedValue({
      ref: 'cam-v1', blob: videoBlob, durationSec: 2.4, mime: 'video/webm', posterBlob,
    })
    const onPart = vi.fn() as unknown as OnPart & { mock: { calls: unknown[][] } }
    await renderCamera(onPart)

    // 切到录视频模式（分段切换在顶栏，文案「录视频」）。
    const videoToggle = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('录视频'),
    )
    expect(videoToggle, '录视频切换钮应存在').toBeTruthy()
    await click(videoToggle!)

    await click(shutter()) // 开始录制
    expect(startVideoFn).toHaveBeenCalledTimes(1)
    await click(shutter()) // 停止录制 → stopVideo → onPart

    expect(onPart).toHaveBeenCalledTimes(1)
    const [part, blob, poster] = onPart.mock.calls[0] as [EntryPart, Blob, Blob]
    expect(part).toMatchObject({
      type: 'video', ref: 'cam-v1', mediaType: 'video', durationSec: 2, mime: 'video/webm',
    })
    expect(blob).toBe(videoBlob)
    expect(poster).toBe(posterBlob)
  })

  it('photo 路径：capturePhoto → onPart 仅两参（不传 posterBlob）', async () => {
    const photoBlob = new Blob(['photo'], { type: 'image/jpeg' })
    capturePhotoFn.mockResolvedValue({ ref: 'cam-p1', blob: photoBlob, mime: 'image/jpeg' })
    const onPart = vi.fn() as unknown as OnPart & { mock: { calls: unknown[][] } }
    await renderCamera(onPart)

    await click(shutter()) // 默认 photo 模式，aria-label=拍照

    expect(onPart).toHaveBeenCalledTimes(1)
    expect(onPart.mock.calls[0].length).toBe(2)
    expect(onPart.mock.calls[0][0]).toMatchObject({ ref: 'cam-p1', mediaType: 'image', durationSec: 0 })
    expect(onPart.mock.calls[0][1]).toBe(photoBlob)
    // 照片路径 onPart 后 await 220ms 白闪再 onClose——刷掉挂起定时器防跨例泄漏。
    await act(async () => { await new Promise((r) => setTimeout(r, 260)) })
  })
})
