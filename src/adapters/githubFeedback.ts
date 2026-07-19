// 使用反馈适配器：提交到 GitHub Issue（label `feedback`），图片走 gist raw URL。
// 见 docs/superpowers/specs/2026-07-19-feedback-feature-design.md。
//
// TODO(pre-release): token 内置在包里，可从 APK 反编译提取。正式版前迁 Cloudflare
// Worker 代理（token 存 worker secret），client POST worker、worker 转发 GitHub。

import type { FeedbackPort } from '@/ports'

// Vite 构建时 inline；.env.local (gitignored) 填真实值，本文件不读 SecretStorePort。
const TOKEN = (import.meta.env.VITE_FEEDBACK_GITHUB_TOKEN as string | undefined)?.trim()
const REPO = (import.meta.env.VITE_FEEDBACK_GITHUB_REPO as string | undefined)?.trim()

const GH_API = 'https://api.github.com'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const dataUrl = fr.result as string
      const comma = dataUrl.indexOf(',')
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
    }
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function extFor(blob: Blob): string {
  const sub = (blob.type.split('/')[1] || 'jpeg').split(';')[0].toLowerCase()
  if (sub === 'jpeg' || sub === 'jpg') return 'jpg'
  if (sub === 'png') return 'png'
  if (sub === 'webp') return 'webp'
  if (sub === 'gif') return 'gif'
  return 'jpg'
}

// 所有图片一次 gist（public=false），每文件一个 raw_url。gist raw 经 camo 在
// Issue markdown 内渲染为图片。若验证不渲染，回退 repo 孤儿分支 + raw.githubusercontent.com。
async function uploadImages(images: Blob[]): Promise<string[]> {
  if (!images.length) return []
  const files: Record<string, { content: string }> = {}
  const order: string[] = []
  for (let i = 0; i < images.length; i++) {
    const key = `img-${i}-${randomId()}.${extFor(images[i])}`
    files[key] = { content: await blobToBase64(images[i]) }
    order.push(key)
  }
  const res = await fetch(`${GH_API}/gists`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ description: 'AiJi 反馈图片', public: false, files }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`图片上传失败 (${res.status}) ${t.slice(0, 200)}`)
  }
  const json = (await res.json()) as { files: Record<string, { raw_url: string }> }
  return order.map((k) => json.files[k]?.raw_url).filter((u): u is string => !!u)
}

function buildBody(items: { text: string; images: string[] }[]): string {
  const ts = new Date().toLocaleString('zh-CN')
  const lines: string[] = []
  lines.push(`> 来自 AiJi App 使用反馈 · ${ts}`)
  lines.push('')
  items.forEach((it, i) => {
    lines.push(`## 建议 ${i + 1}`)
    lines.push('')
    lines.push(it.text.trim() || '（无文字）')
    lines.push('')
    for (const url of it.images) lines.push(`![反馈图片](${url})`)
    lines.push('')
  })
  return lines.join('\n')
}

export const githubFeedback: FeedbackPort = {
  async submit(items) {
    if (!TOKEN || !REPO) {
      throw new Error('反馈未配置（缺少 VITE_FEEDBACK_GITHUB_TOKEN / VITE_FEEDBACK_GITHUB_REPO）')
    }
    // spec §3：一次提交所有图片聚到单个 gist（一个 API 调用 + N 个 raw_url），再按序映回各条。
    const meta: { itemIdx: number }[] = []
    const blobs: Blob[] = []
    items.forEach((it, i) => it.images.forEach((b) => { blobs.push(b); meta.push({ itemIdx: i }) }))
    const allUrls = await uploadImages(blobs)
    const perItem: string[][] = items.map(() => [])
    meta.forEach((m, k) => {
      const url = allUrls[k]
      if (url) perItem[m.itemIdx].push(url)
    })
    const enriched = items.map((it, i) => ({ text: it.text, images: perItem[i] }))
    const body = buildBody(enriched)
    const firstText = items[0]?.text?.trim() || '反馈'
    // Array.from 按 Unicode 码点切片，免得在 emoji 代理对中间截断出乱码。
    const title = Array.from(firstText).length > 40 ? Array.from(firstText).slice(0, 40).join('') + '…' : firstText
    const res = await fetch(`${GH_API}/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, labels: ['feedback'] }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`创建反馈失败 (${res.status}) ${t.slice(0, 200)}`)
    }
    const json = (await res.json()) as { html_url: string }
    return { issueUrl: json.html_url }
  },
}
