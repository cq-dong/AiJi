import { describe, it, expect, beforeEach, vi } from 'vitest'

// P-A 性能（2026-10-03）：mediaRef→objectURL 模块级缓存。
// 契约：并发 acquire 只读一次存储；release 计数归零才可淘汰；LRU 淘汰最旧零引用并
// revokeObjectURL；refs>0 永不淘汰（在屏媒体不裂图）；null（无 blob）结果也缓存、不占 CAP。

const { getMediaFn } = vi.hoisted(() => ({ getMediaFn: vi.fn() }))
vi.mock('@/app/di', () => ({ di: { storage: { getMedia: getMediaFn } } }))

type Mod = typeof import('@/app/mediaCache')
let mod: Mod

function blobOf(type: string): Blob {
  return new Blob(['x'], { type })
}

beforeEach(async () => {
  vi.resetModules()
  mod = await import('@/app/mediaCache')
  getMediaFn.mockReset()
  getMediaFn.mockImplementation(async () => blobOf('image/jpeg'))
  URL.createObjectURL = vi.fn((b: Blob) => `blob:url-${b.type}-${Math.random()}`)
  URL.revokeObjectURL = vi.fn()
})

describe('mediaCache：媒体 URL 缓存', () => {
  it('同一 ref 并发 acquire 只读一次存储，返回同一 url', async () => {
    const [a, b] = await Promise.all([mod.acquireMediaUrl('r1'), mod.acquireMediaUrl('r1')])
    expect(getMediaFn).toHaveBeenCalledTimes(1)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.url).toBe(b!.url)
  })

  it('release 后再次 acquire 命中缓存（不再读存储）', async () => {
    const first = await mod.acquireMediaUrl('r1')
    mod.releaseMediaUrl('r1')
    const second = await mod.acquireMediaUrl('r1')
    expect(getMediaFn).toHaveBeenCalledTimes(1)
    expect(second!.url).toBe(first!.url)
  })

  it('无 blob（seed）→ 返回 null 且缓存：二次 acquire 不再读存储', async () => {
    getMediaFn.mockResolvedValue(undefined)
    const a = await mod.acquireMediaUrl('r-seed')
    const b = await mod.acquireMediaUrl('r-seed')
    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(getMediaFn).toHaveBeenCalledTimes(1)
  })

  it('超容时淘汰最旧的零引用条目并 revokeObjectURL', async () => {
    // 注满 CAP=60 个零引用条目（url 在填充时直接记录——事后再 acquire 会把 lastUsed 刷成最新）
    const urls: string[] = []
    for (let i = 0; i < 60; i++) {
      const r = await mod.acquireMediaUrl(`r${i}`)
      mod.releaseMediaUrl(`r${i}`)
      urls.push(r!.url)
    }
    // 第 61 个 → 触发淘汰（r0 最旧）
    const fresh = await mod.acquireMediaUrl('r-new')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urls[0])
    // 防回归（实锤 bug）：新插入条目 refs=0 且 lastUsed 未盖章时会被当成「最旧零引用」
    // 自淘汰——发出去的 url 立刻被 revoke。新条目的 url 绝不可被本次淘汰 revoke。
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(fresh!.url)
    // r0 已被淘汰 → 重新 acquire 重新读存储
    const before = getMediaFn.mock.calls.length
    await mod.acquireMediaUrl('r0')
    expect(getMediaFn.mock.calls.length).toBe(before + 1)
  })

  it('refs>0 的条目永不淘汰（在屏媒体不裂图）', async () => {
    const pinned = await mod.acquireMediaUrl('r-pinned') // refs=1，不 release
    for (let i = 0; i < 70; i++) {
      await mod.acquireMediaUrl(`filler-${i}`)
      mod.releaseMediaUrl(`filler-${i}`)
    }
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(pinned!.url)
    // 仍命中缓存
    const before = getMediaFn.mock.calls.length
    const again = await mod.acquireMediaUrl('r-pinned')
    expect(again!.url).toBe(pinned!.url)
    expect(getMediaFn.mock.calls.length).toBe(before)
  })

  it('mime 随结果返回（MediaThumb 靠它判别 video/*）', async () => {
    getMediaFn.mockResolvedValue(blobOf('video/mp4'))
    const r = await mod.acquireMediaUrl('r-v')
    expect(r!.mime).toBe('video/mp4')
  })
})
