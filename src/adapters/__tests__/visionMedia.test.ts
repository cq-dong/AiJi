import { describe, it, expect, vi, afterEach } from 'vitest'
import { compressImage, compressImageBlob } from '@/adapters/visionMedia'

// visionMedia 的浏览器边界（createImageBitmap / canvas 2d / toBlob / toDataURL）在 jsdom
// 全部缺席——mock 边界测纯逻辑：等比缩放（长边 ≤1024 不放大）、白底填充（修 alpha PNG
// → JPEG 透明区变黑）、JPEG 0.8 参数、失败 null（压缩永不抛）。

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubCreateImageBitmap(impl: () => Promise<unknown>): void {
  vi.stubGlobal('createImageBitmap', vi.fn(impl))
}

function stubBitmapOk(width: number, height: number) {
  const close = vi.fn()
  stubCreateImageBitmap(async () => ({ width, height, close }))
  return close
}

function stubCanvas(opts: { dataUrl?: string } = {}) {
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  )
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((cb: BlobCallback) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })))
  const toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValue(opts.dataUrl ?? 'data:image/jpeg;base64,AAAA')
  return { ctx, toBlob, toDataURL }
}

describe('compressImageBlob', () => {
  it('createImageBitmap 失败（reject）→ null，不抛', async () => {
    stubCreateImageBitmap(() => Promise.reject(new Error('decode failed')))
    stubCanvas()
    expect(await compressImageBlob(new Blob(['x'], { type: 'image/png' }))).toBeNull()
  })

  it('canvas 2d 上下文不可用 → null', async () => {
    stubBitmapOk(800, 600)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(await compressImageBlob(new Blob(['x'], { type: 'image/png' }))).toBeNull()
  })

  it('成功 → JPEG blob（toBlob image/jpeg, 0.8），bitmap close 释放', async () => {
    const close = stubBitmapOk(800, 600)
    const { toBlob } = stubCanvas()
    const out = await compressImageBlob(new Blob(['x'], { type: 'image/png' }))
    expect(out).toBeInstanceOf(Blob)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('长边 >1024 等比降采样（4000×2000 → 1024×512）', async () => {
    stubBitmapOk(4000, 2000)
    const { ctx } = stubCanvas()
    await compressImageBlob(new Blob(['x'], { type: 'image/png' }))
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512)
  })

  it('白底填充：fillStyle #ffffff + fillRect 先于 drawImage（alpha PNG 透明区不变黑）', async () => {
    stubBitmapOk(4000, 2000)
    const { ctx } = stubCanvas()
    await compressImageBlob(new Blob(['x'], { type: 'image/png' }))
    expect(ctx.fillStyle).toBe('#ffffff')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1024, 512)
    expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.drawImage.mock.invocationCallOrder[0],
    )
  })

  it('小图不放大（200×100 → 200×100）', async () => {
    stubBitmapOk(200, 100)
    const { ctx } = stubCanvas()
    await compressImageBlob(new Blob(['x'], { type: 'image/png' }))
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 100)
  })
})

describe('compressImage（VLM dataURL 路径，签名语义不变）', () => {
  it('成功 → dataURL（toDataURL image/jpeg, 0.8）', async () => {
    stubBitmapOk(800, 600)
    const { toDataURL } = stubCanvas()
    const out = await compressImage(new Blob(['x'], { type: 'image/png' }))
    expect(out).toBe('data:image/jpeg;base64,AAAA')
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8)
  })

  it('createImageBitmap 失败 → null', async () => {
    stubCreateImageBitmap(() => Promise.reject(new Error('decode failed')))
    stubCanvas()
    expect(await compressImage(new Blob(['x']))).toBeNull()
  })
})
