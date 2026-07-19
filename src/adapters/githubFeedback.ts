// 使用反馈适配器：提交到 GitHub Issue（label `feedback`），图片走 repo 孤儿分支
// `feedback-assets` 的 contents API —— raw.githubusercontent.com 按 .ext 返回 image/*
// content-type，camo 正常渲染（gist raw 返 text/plain，浏览器拒渲，已弃用）。
// 见 docs/superpowers/specs/2026-07-19-feedback-feature-design.md §3。
//
// TODO(pre-release): token 内置在包里，可从 APK 反编译提取。正式版前迁 Cloudflare
// Worker 代理（token 存 worker secret），client POST worker、worker 转发 GitHub。

import type { FeedbackPort } from '@/ports'

// Vite 构建时 inline；.env.local (gitignored) 填真实值，本文件不读 SecretStorePort。
const TOKEN = (import.meta.env.VITE_FEEDBACK_GITHUB_TOKEN as string | undefined)?.trim()
const REPO = (import.meta.env.VITE_FEEDBACK_GITHUB_REPO as string | undefined)?.trim()

const GH_API = 'https://api.github.com'
const BRANCH = 'feedback-assets'
const DIR = 'feedback-assets'

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

async function gh(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
}

// 幂等确保孤儿分支存在（空树根提交，仅存图片，不污染 main 历史）。模块级缓存免每次提交都探。
let branchReady = false
async function ensureAssetsBranch(): Promise<void> {
  if (branchReady) return
  const probe = await gh(`/repos/${REPO}/branches/${BRANCH}`, { method: 'GET' })
  if (probe.ok) {
    branchReady = true
    return
  }
  if (probe.status !== 404) {
    const t = await probe.text().catch(() => '')
    throw new Error(`检查反馈分支失败 (${probe.status}) ${t.slice(0, 200)}`)
  }
  // 建孤儿分支：空树 → 无父根提交 → 建 ref。三步一气呵成。
  const treeRes = await gh(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree: [] }),
  })
  if (!treeRes.ok) {
    const t = await treeRes.text().catch(() => '')
    throw new Error(`建空树失败 (${treeRes.status}) ${t.slice(0, 200)}`)
  }
  const treeSha = (await treeRes.json() as { sha: string }).sha
  const commitRes = await gh(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: 'init feedback-assets orphan', tree: treeSha, parents: [] }),
  })
  if (!commitRes.ok) {
    const t = await commitRes.text().catch(() => '')
    throw new Error(`建根提交失败 (${commitRes.status}) ${t.slice(0, 200)}`)
  }
  const commitSha = (await commitRes.json() as { sha: string }).sha
  const refRes = await gh(`/repos/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commitSha }),
  })
  if (!refRes.ok && refRes.status !== 422) {
    const t = await refRes.text().catch(() => '')
    throw new Error(`建反馈分支失败 (${refRes.status}) ${t.slice(0, 200)}`)
  }
  branchReady = true
}

// 单图上传：PUT contents 到孤儿分支，返回 raw.githubusercontent.com 下载 URL（image/* content-type）。
// 串行执行避免同分支并发提交撞 HEAD（contents API 每提交推进 tip）。
async function uploadImage(blob: Blob, idx: number): Promise<string> {
  const path = `${DIR}/${Date.now()}-${idx}-${randomId()}.${extFor(blob)}`
  const content = await blobToBase64(blob)
  const res = await gh(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `feedback image ${idx}`, branch: BRANCH, content }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`图片上传失败 (${res.status}) ${t.slice(0, 200)}`)
  }
  const json = (await res.json()) as { content: { download_url: string | null } }
  const url = json.content?.download_url
  if (!url) throw new Error('图片上传失败（无下载 URL）')
  return url
}

async function uploadImages(images: Blob[]): Promise<string[]> {
  if (!images.length) return []
  const urls: string[] = []
  for (let i = 0; i < images.length; i++) {
    urls.push(await uploadImage(images[i], i))
  }
  return urls
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
    // 一次提交所有图聚到孤儿分支，按序映回各条。
    const meta: { itemIdx: number }[] = []
    const blobs: Blob[] = []
    items.forEach((it, i) => it.images.forEach((b) => { blobs.push(b); meta.push({ itemIdx: i }) }))
    let allUrls: string[] = []
    if (blobs.length) {
      await ensureAssetsBranch()
      allUrls = await uploadImages(blobs)
    }
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
    const res = await gh(`/repos/${REPO}/issues`, {
      method: 'POST',
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
