import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Q6 采集压缩包（2026-10-05）MediaThumb poster 优先：视频缩略图先取采集时抽帧存的
// `${ref}.poster`（JPEG），命中直出 <img>——列表滚动零视频解码；miss（老条目无 poster）
// 回落主 ref 的 <video #t=0.1>。本文件 mock @/app/mediaCache 精确断言 acquire 调用序列
// 与 release 配对（既有 mediaThumb.test.tsx 走真 mediaCache + di mock，覆盖 rc10/F1 回归）。

const { acquireFn, releaseFn } = vi.hoisted(() => ({ acquireFn: vi.fn(), releaseFn: vi.fn() }))
vi.mock('@/app/mediaCache', () => ({
  acquireMediaUrl: acquireFn,
  releaseMediaUrl: releaseFn,
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { MediaThumb } from '@/ui/screens/home/TimelineCard'

async function renderThumb(thumb: { ref: string; isVideo: boolean }, strict = false): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(strict ? <StrictMode><MediaThumb thumb={thumb} /></StrictMode> : <MediaThumb thumb={thumb} />)
  })
  return { container, root }
}

beforeEach(() => {
  document.body.innerHTML = ''
  acquireFn.mockReset()
  releaseFn.mockReset()
})

describe('MediaThumb poster 优先（Q6）', () => {
  it('isVideo + poster 命中 → 渲染 <img>，主 ref 不被 acquire（列表滚动零视频解码）', async () => {
    acquireFn.mockImplementation(async (key: string) =>
      key === 'v1.poster' ? { url: 'blob:poster-1', mime: 'image/jpeg' } : null,
    )
    const { container, root } = await renderThumb({ ref: 'v1', isVideo: true })
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('blob:poster-1')
    expect(container.querySelector('video')).toBeNull()
    // acquire 调用序列：仅 poster ref——主 ref 未被触碰
    expect(acquireFn.mock.calls.map((c) => c[0])).toEqual(['v1.poster'])
    // release 配对：unmount 后 poster ref release 一次
    await act(async () => {
      root.unmount()
    })
    expect(releaseFn.mock.calls.map((c) => c[0])).toEqual(['v1.poster'])
  })

  it('isVideo + poster miss → 回落 acquire 主 ref，渲染 <video #t=0.1>；cleanup 双 release 配对', async () => {
    acquireFn.mockImplementation(async (key: string) =>
      key === 'v2.poster' ? null : { url: 'blob:main-2', mime: 'video/webm' },
    )
    const { container, root } = await renderThumb({ ref: 'v2', isVideo: true })
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video!.getAttribute('src')).toBe('blob:main-2#t=0.1')
    expect(container.querySelector('img')).toBeNull()
    // acquire 序列：先 poster（miss）后主 ref
    expect(acquireFn.mock.calls.map((c) => c[0])).toEqual(['v2.poster', 'v2'])
    // 两次 acquire 成功（null 命中也算 acquire 成功占用 refs）→ cleanup 必须 release 两次
    await act(async () => {
      root.unmount()
    })
    expect(releaseFn.mock.calls.map((c) => c[0])).toEqual(['v2.poster', 'v2'])
  })

  it('MAJOR-1 回归：poster miss + blob MIME 空串（Chromium OPFS getFile() 不持久化 type 实态）→ 按 isVideo prop 渲染 <video>，不裂图', async () => {
    // 旧实现按 r.mime.startsWith('video/') 判渲染——OPFS 读出 type:"" 恒 false →
    // 有主 blob 无 poster 的视频条目渲 <img src={webm blobURL}> naturalWidth=0 裂图。
    // 修复：渲染判定改用 part 元数据链来的 isVideo prop（IDB 持久可靠）。
    acquireFn.mockImplementation(async (key: string) =>
      key === 'v6.poster' ? null : { url: 'blob:main-6', mime: '' },
    )
    const { container, root } = await renderThumb({ ref: 'v6', isVideo: true })
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video!.getAttribute('src')).toBe('blob:main-6#t=0.1')
    expect(container.querySelector('img')).toBeNull()
    await act(async () => {
      root.unmount()
    })
    expect(releaseFn.mock.calls.map((c) => c[0])).toEqual(['v6.poster', 'v6'])
  })

  it('!isVideo（照片）→ 只 acquire 主 ref 渲染 <img>，不触碰 poster', async () => {
    acquireFn.mockResolvedValue({ url: 'blob:img-3', mime: 'image/jpeg' })
    const { container, root } = await renderThumb({ ref: 'p3', isVideo: false })
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('blob:img-3')
    expect(acquireFn.mock.calls.map((c) => c[0])).toEqual(['p3'])
    await act(async () => {
      root.unmount()
    })
    expect(releaseFn.mock.calls.map((c) => c[0])).toEqual(['p3'])
  })

  it('acquire 抛错 → 灰块占位，不冒 unhandled rejection，无 release 欠计', async () => {
    acquireFn.mockRejectedValue(new Error('IDB boom'))
    const { container, root } = await renderThumb({ ref: 'p4', isVideo: false })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('div[aria-hidden="true"]')).not.toBeNull()
    await act(async () => {
      root.unmount()
    })
    expect(releaseFn).not.toHaveBeenCalled()
  })

  it('StrictMode 双效应：acquire/release 总数逐 ref 平衡（F1 协议的双 acquire 扩展）', async () => {
    acquireFn.mockImplementation(async (key: string) =>
      key === 'v5.poster' ? null : { url: 'blob:main-5', mime: 'video/mp4' },
    )
    const { container, root } = await renderThumb({ ref: 'v5', isVideo: true }, true)
    expect(container.querySelector('video')).not.toBeNull()
    await act(async () => {
      root.unmount()
    })
    // 每个被 acquire 过的 ref，release 次数必须 == acquire 次数（refs 不欠计不溢出）
    const countBy = (calls: unknown[][]) => {
      const m = new Map<string, number>()
      for (const c of calls) m.set(c[0] as string, (m.get(c[0] as string) ?? 0) + 1)
      return m
    }
    const acquired = countBy(acquireFn.mock.calls)
    const released = countBy(releaseFn.mock.calls)
    expect([...released.keys()].sort()).toEqual([...acquired.keys()].sort())
    for (const [key, n] of acquired) {
      expect(released.get(key)).toBe(n)
    }
  })
})
