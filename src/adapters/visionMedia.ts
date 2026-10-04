// Vision media helpers — image compression + video frame extraction for
// openAiCompatLlm.classify. All browser-side (canvas / <video>), no I/O.
// OPFS blobs are same-origin → canvas not tainted → toBlob/toDataURL usable.

const MAX_LONG_EDGE = 1024
const JPEG_QUALITY = 0.8

// 模块内共享核（不导出）：blob → createImageBitmap → 等比缩放长边 ≤1024（小图不放大）
// → canvas 2d → 先白底填充再 drawImage → 返回画好的 canvas。null on any failure。
// 白底填充：alpha PNG → JPEG 时透明区默认变黑，先铺白底保持观感（Q6 修——VLM
// compressImage 路径与采集 compressImageBlob 路径同修）。调用方负责 toDataURL/toBlob。
async function drawCompressed(blob: Blob): Promise<HTMLCanvasElement | null> {
  const bmp = await createImageBitmap(blob).catch(() => null)
  if (!bmp) return null
  try {
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    return canvas
  } finally {
    bmp.close()
  }
}

// photo blob (or extracted frame blob) → JPEG base64 data URL, long edge ≤1024.
// null on any failure (caller skips that image).
export async function compressImage(blob: Blob): Promise<string | null> {
  const canvas = await drawCompressed(blob)
  if (!canvas) return null
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

// Q6 采集压缩包：同参数压缩但出口为 Blob（采集落 OPFS 用——AI 看到的与库存的一致）。
// null on any failure（调用方直通原 blob——压缩永不丢媒体）。
export async function compressImageBlob(blob: Blob): Promise<Blob | null> {
  const canvas = await drawCompressed(blob)
  if (!canvas) return null
  return await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY))
}

// pick seek times for a video: first + last + every intervalSec, capped via
// uniform sampling (keeps first & last). 0 or negative duration → [] (photo).
export function pickFrameTimes(durationSec: number, intervalSec = 10, cap = 8): number[] {
  if (durationSec <= 0) return []
  const times = new Set<number>([0, durationSec])
  for (let t = intervalSec; t < durationSec; t += intervalSec) times.add(t)
  let arr = [...times].sort((a, b) => a - b)
  arr = arr.filter((t, i) => i === 0 || t - arr[i - 1] > 0.5)
  if (arr.length > cap) {
    const kept: number[] = []
    const step = (arr.length - 1) / (cap - 1)
    for (let i = 0; i < cap; i++) kept.push(arr[Math.round(i * step)])
    arr = [...new Set(kept)].sort((a, b) => a - b)
  }
  return arr
}

// seek video blob to timeSec → draw to canvas → jpeg blob. null on any failure
// (load error, no duration, seek timeout). 3s seek timeout guards mobile
// onseeked flakiness.
export async function extractFrame(blob: Blob, timeSec: number): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('video metadata load error'))
    })
    if (!Number.isFinite(video.duration) || video.duration <= 0) return null
    const t = Math.min(Math.max(0, timeSec), video.duration - 0.05)
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, 3000)
      video.onseeked = finish
      video.onerror = finish
      try {
        video.currentTime = t
      } catch {
        finish()
      }
    })
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY))
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
