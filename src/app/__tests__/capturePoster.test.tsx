// Q6 ②（2026-10-05）：采集落库视频 poster 帧。图库选视频（pickMedia 带 posterBlob）
// → addMediaPart 除主 blob 外另存 posterRefOf(ref)（`${ref}.poster`），fire-and-forget；
// 照片 part（durationSec=0，即使误带 posterBlob）与无 posterBlob 的视频 → 不存 poster。
// 契约：docs/acceptance/q6-capture-compression.md §②。
// 挂载方式：MemoryRouter initialEntries '?mode=gallery' —— capture 屏挂载即消费 mode 参数
// 自动触发 handleGallery（FAB 长按菜单直达链路），免去找/点工具栏图库钮。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

const { pickMediaFn, saveMediaFn, stopCameraFn } = vi.hoisted(() => ({
  pickMediaFn: vi.fn(),
  saveMediaFn: vi.fn(),
  stopCameraFn: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    capture: {
      pickMedia: pickMediaFn,
      stopCamera: stopCameraFn,
      requestMicPermission: vi.fn(async () => false),
    },
    storage: { saveMedia: saveMediaFn },
    secrets: { get: vi.fn(async () => null) },
  },
}))
vi.mock('@/adapters/webCapture', () => ({ getMicAnalyser: vi.fn(() => null) }))
vi.mock('@/app/syncEngine', () => ({ maybeStartSync: vi.fn(), stopSync: vi.fn(), syncNow: vi.fn() }))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import Capture from '@/ui/screens/capture'
import { useUiStore } from '@/app/store'
import { setCurrentLang } from '@/app/currentLang'
import { posterRefOf } from '@/domain/mediaRef'

async function renderGalleryMode(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/capture?mode=gallery']}>
        <Capture />
      </MemoryRouter>,
    )
  })
  // handleGallery 是 fire-and-forget（mode effect 里 void）——再刷一拍让 pickMedia
  // continuation（addMediaPart → saveMedia）落完再断言。
  await act(async () => {})
  return { container, root }
}

beforeEach(() => {
  setCurrentLang('zh')
  document.body.innerHTML = ''
  pickMediaFn.mockReset()
  saveMediaFn.mockReset()
  saveMediaFn.mockResolvedValue(undefined)
  stopCameraFn.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()
  // store 是同文件内跨用例共享的——清 capture 草稿防 parts 串例累积。
  useUiStore.setState((s) => ({ capture: { ...s.capture, parts: [] } }))
})

describe('capture 图库视频 poster 落库（Q6 ②）', () => {
  it('pickMedia 返视频+posterBlob → saveMedia 主 blob + posterRefOf(ref) 各一次', async () => {
    const videoBlob = new Blob(['fake-video'], { type: 'video/webm' })
    const posterBlob = new Blob(['fake-poster'], { type: 'image/jpeg' })
    pickMediaFn.mockResolvedValue({
      ref: 'gal-v1', blob: videoBlob, kind: 'video', durationSec: 3.2, mime: 'video/webm', posterBlob,
    })
    const { root } = await renderGalleryMode()

    expect(saveMediaFn).toHaveBeenCalledTimes(2)
    expect(saveMediaFn).toHaveBeenCalledWith('gal-v1', videoBlob)
    expect(saveMediaFn).toHaveBeenCalledWith(posterRefOf('gal-v1'), posterBlob)
    // part 落 store：durationSec 取整、mediaType=video。
    expect(useUiStore.getState().capture.parts[0]).toMatchObject({
      ref: 'gal-v1', mediaType: 'video', durationSec: 3, mime: 'video/webm',
    })
    await act(async () => { root.unmount() })
  })

  it('pickMedia 返照片（durationSec=0）即使误带 posterBlob → 不存 poster（守卫在组件侧）', async () => {
    const photoBlob = new Blob(['fake-photo'], { type: 'image/jpeg' })
    const strayPoster = new Blob(['stray-poster'], { type: 'image/jpeg' })
    pickMediaFn.mockResolvedValue({
      ref: 'gal-p1', blob: photoBlob, kind: 'image', durationSec: 0, mime: 'image/jpeg', posterBlob: strayPoster,
    })
    const { root } = await renderGalleryMode()

    expect(saveMediaFn).toHaveBeenCalledTimes(1)
    expect(saveMediaFn).toHaveBeenCalledWith('gal-p1', photoBlob)
    expect(saveMediaFn.mock.calls.some(([k]) => String(k).endsWith('.poster'))).toBe(false)
    await act(async () => { root.unmount() })
  })

  it('pickMedia 返视频但无 posterBlob（抽帧失败缺省）→ 只存主 blob', async () => {
    const videoBlob = new Blob(['fake-video'], { type: 'video/webm' })
    pickMediaFn.mockResolvedValue({
      ref: 'gal-v2', blob: videoBlob, kind: 'video', durationSec: 2, mime: 'video/webm',
    })
    const { root } = await renderGalleryMode()

    expect(saveMediaFn).toHaveBeenCalledTimes(1)
    expect(saveMediaFn).toHaveBeenCalledWith('gal-v2', videoBlob)
    await act(async () => { root.unmount() })
  })
})
