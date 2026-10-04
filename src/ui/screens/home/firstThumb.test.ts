import { describe, it, expect } from 'vitest'
import type { EntryPart } from '@/domain/types'
import { firstThumb } from './helpers'

// Q6 采集压缩包（2026-10-05）：firstThumbRef → firstThumb。除 ref 外还判 isVideo——
// MediaThumb 需要知道「是不是真视频」决定先取 poster 帧还是直接 <img>。
// isVideo 判定链（钉死顺序）：mediaType==='video' → mime video/* → durationSec>0 → false。
// 照片 = type:'video' + durationSec:0（mediaType='image' / mime image/*）→ false。
// seed 老数据（如 e5.webm）无 mime 无 mediaType → 靠 durationSec>0 判真视频。

describe('firstThumb（Q6：ref + isVideo 判定表）', () => {
  it('mediaType==="video" → isVideo true（最优先，无需再看 mime/durationSec）', () => {
    const parts: EntryPart[] = [{ type: 'video', ref: 'r1', durationSec: 0, mediaType: 'video' }]
    expect(firstThumb(parts)).toEqual({ ref: 'r1', isVideo: true })
  })

  it('无 mediaType、mime="video/webm" → isVideo true', () => {
    const parts: EntryPart[] = [{ type: 'video', ref: 'r2', durationSec: 0, mime: 'video/webm' }]
    expect(firstThumb(parts)).toEqual({ ref: 'r2', isVideo: true })
  })

  it('seed 老数据：无 mime 无 mediaType、durationSec>0 → isVideo true（e5.webm 形态）', () => {
    const parts: EntryPart[] = [{ type: 'video', ref: 'e5.webm', durationSec: 22, transcript: '…' }]
    expect(firstThumb(parts)).toEqual({ ref: 'e5.webm', isVideo: true })
  })

  it('照片：mediaType="image" + mime image/* + durationSec=0 → isVideo false', () => {
    const parts: EntryPart[] = [
      { type: 'video', ref: 'r4', durationSec: 0, mime: 'image/jpeg', mediaType: 'image' },
    ]
    expect(firstThumb(parts)).toEqual({ ref: 'r4', isVideo: false })
  })

  it('照片（无 mediaType 老数据）：mime image/* + durationSec=0 → isVideo false', () => {
    const parts: EntryPart[] = [{ type: 'video', ref: 'r5', durationSec: 0, mime: 'image/jpeg' }]
    expect(firstThumb(parts)).toEqual({ ref: 'r5', isVideo: false })
  })

  it('空 parts → undefined', () => {
    expect(firstThumb([])).toBeUndefined()
  })

  it('无 video part（text/audio）→ undefined', () => {
    const parts: EntryPart[] = [
      { type: 'text', content: 'hello' },
      { type: 'audio', ref: 'a1', durationSec: 3 },
    ]
    expect(firstThumb(parts)).toBeUndefined()
  })

  it('跳过前面非 video part，取首个 type==="video" 的 part（与旧 firstThumbRef 遍历语义一致）', () => {
    const parts: EntryPart[] = [
      { type: 'text', content: 'hello' },
      { type: 'audio', ref: 'a1', durationSec: 3 },
      { type: 'video', ref: 'v1', durationSec: 0, mediaType: 'image' },
      { type: 'video', ref: 'v2', durationSec: 9, mediaType: 'video' },
    ]
    expect(firstThumb(parts)).toEqual({ ref: 'v1', isVideo: false })
  })
})
