import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MediaThumb } from '@/ui/screens/home/TimelineCard'

// rc10 实锤（2026-10-02）：主页时间线视频条目缩略图显示裂图——MediaThumb 把视频 blob
// 塞进 <img>（img 无法解码视频）。注释原本就写着「视频取首帧（#t=0.1）」但实现漏了。
// 修复：blob.type 判别——video/* → <video preload="metadata" src="…#t=0.1"> 首帧；
// image/*（含 durationSec=0 的 photo part，MIME 仍 image/*）→ <img> 直出；无 blob → 灰块占位。

const { getMediaFn } = vi.hoisted(() => ({ getMediaFn: vi.fn() }))
vi.mock('@/app/di', () => ({ di: { storage: { getMedia: getMediaFn } } }))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

async function renderThumb(mediaRef: string): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<MediaThumb mediaRef={mediaRef} />)
  })
  return { container, root }
}

let urlSeq = 0

beforeEach(() => {
  document.body.innerHTML = ''
  getMediaFn.mockReset()
  urlSeq = 0
  // 每次调用返回唯一 url——压力测试要靠 url 字符串区分被 revoke 的是谁。
  URL.createObjectURL = vi.fn(() => `blob:mock-url-${++urlSeq}`)
  URL.revokeObjectURL = vi.fn()
})

describe('home MediaThumb（视频缩略图修复）', () => {
  it('视频 blob（video/*）→ 渲染 <video> 首帧（src 带 #t=0.1、muted、playsInline），不渲染 <img>', async () => {
    getMediaFn.mockResolvedValue(new Blob(['fake-video'], { type: 'video/mp4' }))
    const { container } = await renderThumb('ref-v1')
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video!.getAttribute('src')).toBe('blob:mock-url-1#t=0.1')
    expect(video!.getAttribute('preload')).toBe('metadata')
    expect((video as HTMLVideoElement).muted).toBe(true) // React 以 property 方式设 muted（非 attribute）
    expect(video!.hasAttribute('playsinline')).toBe(true)
    expect(container.querySelector('img')).toBeNull()
  })

  it('图片 blob（image/*）→ 渲染 <img> 直出（回归：图片路径不变）', async () => {
    getMediaFn.mockResolvedValue(new Blob(['fake-img'], { type: 'image/jpeg' }))
    const { container } = await renderThumb('ref-i1')
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('blob:mock-url-1')
    expect(container.querySelector('video')).toBeNull()
  })

  it('无 blob（seed/未落库）→ 灰块占位，不渲染 img/video', async () => {
    getMediaFn.mockResolvedValue(undefined)
    const { container } = await renderThumb('ref-none')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('div[aria-hidden="true"]')).not.toBeNull()
  })

  it('StrictMode 双效应下在屏缩略图 refs>0（accept-pa F1 回归）：淘汰压力下在屏 url 不被 revoke', async () => {
    // F1 场景实锤：缓存命中时 refs++ 与 cleanup 可在 continuation 前交错，无 settled 守卫
    // 会单次 acquire 双 release → 在屏媒体 refs=0 → LRU 压力下入屏 url 被 revoke（裂图）。
    // 本测试复现该压力：StrictMode 挂载（双效应）后保持挂载，再填满 70 个零引用条目
    // 逼出淘汰，断言在屏 url 存活。
    const { acquireMediaUrl, releaseMediaUrl } = await import('@/app/mediaCache')
    getMediaFn.mockResolvedValue(new Blob(['fake-img'], { type: 'image/png' }))
    // 预热缓存（refs 归 0 的缓存条目）——F1  buggy 路径只在「缓存命中 + StrictMode」
    // 交错下出现：命中时 refs++ 同步执行，随后 cleanup/continuation 交错释放。
    await acquireMediaUrl('ref-sm')
    releaseMediaUrl('ref-sm')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <StrictMode>
          <MediaThumb mediaRef="ref-sm" />
        </StrictMode>,
      )
    })
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    const mountedUrl = img!.getAttribute('src')!
    expect(getMediaFn).toHaveBeenCalledTimes(1)
    // 逼淘汰：70 个一次性条目（acquire 后立即 release，refs=0）
    for (let i = 0; i < 70; i++) {
      await acquireMediaUrl(`ref-pressure-${i}`)
      releaseMediaUrl(`ref-pressure-${i}`)
    }
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(mountedUrl)
    await act(async () => {
      root.unmount()
    })
  })
})
