import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronLeft, ExternalLink, ImagePlus, Plus, X } from 'lucide-react'
import { Button, Card, Spinner } from '@/ui/components'
import { di } from '@/app/di'
import type { FeedbackItem } from '@/domain/types'

interface ItemImage {
  blob: Blob
  url: string
}
interface Item {
  key: string
  text: string
  images: ItemImage[]
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// 前端压缩：canvas 降到 ≤1600px、保比例、JPEG 0.8。免 gist 爆 size + 加速上传。
// 任一步失败回落原始 File（不阻断选图）。复用 AccountSection 的 canvas 模式。
async function compressImage(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.onerror = () => rej(fr.error)
    fr.readAsDataURL(file)
  })
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image()
      im.onload = () => res(im)
      im.onerror = () => rej(new Error('图片解析失败'))
      im.src = dataUrl
    })
    const max = 1600
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((res, rej) => {
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error('压缩失败'))),
        'image/jpeg',
        0.8,
      )
    })
  } catch {
    return file
  }
}

export default function Feedback() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Item[]>([{ key: randomId(), text: '', images: [] }])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeKey = useRef<string | null>(null)
  // 镜像最新 items 到 ref，卸载时 revoke 所有 object URL 免内存泄漏。
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(
    () => () => {
      itemsRef.current.forEach((it) => it.images.forEach((im) => URL.revokeObjectURL(im.url)))
    },
    [],
  )

  const updateItem = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))

  const removeImage = (key: string, url: string) => {
    URL.revokeObjectURL(url)
    setItems((prev) =>
      prev.map((it) =>
        it.key === key ? { ...it, images: it.images.filter((im) => im.url !== url) } : it,
      ),
    )
  }

  const addItem = () => setItems((prev) => [...prev, { key: randomId(), text: '', images: [] }])

  const removeItem = (key: string) => {
    setItems((prev) => {
      const target = prev.find((x) => x.key === key)
      target?.images.forEach((im) => URL.revokeObjectURL(im.url))
      return prev.length > 1 ? prev.filter((x) => x.key !== key) : prev
    })
  }

  const pickImages = (key: string) => {
    activeKey.current = key
    fileInputRef.current?.click()
  }

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    const key = activeKey.current
    if (!key || !files.length) return
    setBusyKey(key)
    try {
      const compressed = await Promise.all(files.map(compressImage))
      setItems((prev) =>
        prev.map((it) =>
          it.key === key
            ? {
                ...it,
                images: [
                  ...it.images,
                  ...compressed.map((blob) => ({ blob, url: URL.createObjectURL(blob) })),
                ],
              }
            : it,
        ),
      )
    } catch (err) {
      setError(`图片处理失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyKey(null)
    }
  }

  const canSubmit = items.some((it) => it.text.trim() || it.images.length) && !submitting

  const submit = async () => {
    setError(null)
    const payload: FeedbackItem[] = items
      .filter((it) => it.text.trim() || it.images.length)
      .map((it) => ({ text: it.text.trim(), images: it.images.map((im) => im.blob) }))
    if (!payload.length) return
    setSubmitting(true)
    try {
      const { issueUrl } = await di.feedback.submit(payload)
      setResult(issueUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-priS text-pri">
          <Check size={28} strokeWidth={2.5} />
        </span>
        <div>
          <p className="text-[17px] font-bold text-ink">反馈已提交，谢谢！</p>
          <p className="mt-1 text-[12px] text-t3">建议已发到 GitHub Issue，会尽快处理。</p>
        </div>
        <a
          href={result}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-pri active:opacity-70"
        >
          查看 Issue <ExternalLink size={14} />
        </a>
        <Button variant="secondary" className="mt-2 w-full" onClick={() => navigate(-1)}>
          完成
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-brd px-2 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="返回"
          className="flex size-9 items-center justify-center rounded-full text-ink active:bg-page"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-[17px] font-bold text-ink">使用反馈</h1>
      </div>

      {/* 建议列表 */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {items.map((it, idx) => (
          <Card key={it.key} className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink">建议 {idx + 1}</span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(it.key)}
                  aria-label="删除该建议"
                  className="flex size-7 items-center justify-center rounded-full text-t3 active:bg-page"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <textarea
              value={it.text}
              onChange={(e) => updateItem(it.key, { text: e.target.value })}
              placeholder="说说你的建议、遇到的问题或想法…"
              rows={3}
              className="mt-2 w-full resize-none rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri"
            />
            {it.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {it.images.map((im) => (
                  <div key={im.url} className="relative">
                    <img
                      src={im.url}
                      alt="反馈图片"
                      className="h-20 w-20 rounded-btn border border-brd object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(it.key, im.url)}
                      aria-label="移除图片"
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-brd bg-card text-t3 shadow-sm active:bg-page"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => pickImages(it.key)}
              disabled={busyKey === it.key}
              className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-pri active:opacity-70 disabled:opacity-50"
            >
              <ImagePlus size={16} />
              {busyKey === it.key ? '处理中…' : '添加图片'}
            </button>
          </Card>
        ))}

        <button
          type="button"
          onClick={addItem}
          className="flex w-full items-center justify-center gap-1 rounded-card border border-dashed border-brd py-2.5 text-[13px] font-medium text-t2 active:bg-page"
        >
          <Plus size={16} /> 添加建议
        </button>

        {error && (
          <p className="rounded-btn bg-catFail/10 px-3 py-2 text-[12px] text-catFail">{error}</p>
        )}
      </div>

      {/* 底栏提交 */}
      <div className="shrink-0 border-t border-brd px-4 py-3">
        <Button onClick={submit} disabled={!canSubmit} size="lg" className="w-full">
          {submitting ? (
            <>
              <Spinner size={14} /> 提交中…
            </>
          ) : (
            '提交'
          )}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void onFiles(e)}
      />
    </div>
  )
}
