// src/adapters/builtinLlm.ts
// Slice B 内置 key 代理 LLM 适配器：实现 LlmPort，所有调用代理到后端 POST /api/llm/chat。
// 后端注入真实 DeepSeek key 并扣配额；前端只持 JWT（network 账号会话）。
// 与 openAiCompatLlm（BYOK）共存——后续 llmProxy(T11) 按 settings.keySource 路由。
//
// 与 openAiCompatLlm 的差异仅 3 点：(1) fetch 端点 /api/llm/chat 或 /api/vlm/chat（含图多模态）；
// (2) auth=JWT（401→refresh 重试一次，前端不持 LLM/VLM key）；(3) 每次 LLM/VLM 调用 bump 配额（consume('llm',1)）。
// Vision（A2，2026-07-21）：含图条目附 image_url 走后端 /api/vlm/chat（DashScope qwen-vl），
// settings.videoVisionEnabled 守门、collectEntryImages 抽图、buildPrompt 传 hasImages+locationAddress、
// 降级镜像 BYOK D14/D17（vlm 非 OK 且有文本→去图重发 /api/llm/chat；纯图无文本→throw）。
// prompt 组装 / JSON 解析 / EntryAi·Aggregate 构造逻辑复用 openAiCompatLlm 的 helper。
import type { LlmPort } from '@/ports'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import type { Aggregate, ChatAnswer, EntryAi } from '@/domain/types'
import { di } from '@/app/di'
import { useAccountStore } from '@/app/accountStore'
import { useQuotaStore } from '@/app/quotaStore'
import { localSession } from '@/app/session'
import {
  entryText, toLocalIso, buildPrompt, parseJson,
  buildAggregatePrompt, parseAggregateJson,
  buildIntentPrompt, parseIntentJson,
  buildAnswerPrompt, parseAnswerJson,
  collectEntryImages, inferMediaType,
  type VisionTextPart, type VisionImagePart,
} from '@/adapters/openAiCompatLlm'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

function assertNetwork(): void {
  const a = useAccountStore.getState().account
  if (!a || a.type !== 'network') throw new NotNetworkError()
}

// 统一 chat 端点：所有 LLM 方法组装成 OpenAI 兼容 messages 发后端。
// path：'/api/llm/chat'（纯文本）或 '/api/vlm/chat'（含图多模态）。后端注入真实 key 并扣配额。
// 401 → refresh 重试一次 → 再 401 抛 SessionExpiredError。
// role 用 string（非字面量联合）：buildIntentPrompt/buildAnswerPrompt 无显式返回类型，
// 推断为 role:string；这里放宽以接受所有 helper 产出，后端负责校验。
async function chatFetch(
  messages: { role: string; content: unknown }[],
  path: '/api/llm/chat' | '/api/vlm/chat',
): Promise<Response> {
  const session = localSession.get()
  if (!session) throw new SessionExpiredError()
  const doFetch = (jwt: string) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, opts: {} }),
    })
  let res = await doFetch(session.jwt)
  if (res.status === 401) {
    let newSession
    try {
      // di.auth.refresh：http 模式走 httpAuth 单飞锁（并发 401 共享一次），mock 模式走 mockAuth。
      newSession = await di.auth.refresh()
      localSession.set(newSession)
    } catch {
      localSession.clear()
      throw new SessionExpiredError()
    }
    res = await doFetch(newSession.jwt)
  }
  return res
}

// 从成功响应抽 reply 字符串。非 OK 抛带状态码错误（降级逻辑在 classify 内单独处理）。
async function extractReply(res: Response): Promise<string> {
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`builtinLlm HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const reply = data?.reply
  if (typeof reply !== 'string') throw new Error('builtinLlm 响应缺 reply')
  return reply
}

// 纯文本路径快捷：fetch /api/llm/chat → 抽 reply。VLM 含图路径在 classify 内走 chatFetch + 降级。
async function chat(messages: { role: string; content: unknown }[]): Promise<string> {
  const res = await chatFetch(messages, '/api/llm/chat')
  return extractReply(res)
}

export const builtinLlm: LlmPort = {
  async classify(entryId) {
    assertNetwork()
    const settings = await di.storage.getSettings()
    const entry = await di.storage.getEntry(entryId)
    if (!entry) throw new Error('entry not found: ' + entryId)
    const content = entryText(entry)
    const hasVideoParts = entry.parts.some((p) => p.type === 'video')
    if (!content.trim() && !hasVideoParts) throw new Error('条目无文本/媒体可分类')
    const categories = await di.storage.listCategories()
    const tags = await di.storage.listTags()
    // 地点：entry.location.address（reverse geocoded）喂给 LLM 填 facets.place，
    // 让「类别地图·地点」能聚类。无 address（离线/未反查）时不喂，LLM 仍可从正文提取。
    const locationAddress = entry.location?.address?.trim() || entry.location?.label?.trim() || undefined
    // Vision：附图/视频帧（OpenAI image_url 多模态）。videoVisionEnabled 关 → 纯文本。
    // 内置 VLM 走后端 /api/vlm/chat（DashScope qwen-vl），前端只持 JWT。
    let images: string[] = []
    if (settings.videoVisionEnabled && hasVideoParts) {
      images = await collectEntryImages(entry, settings.videoFrameIntervalSec)
    }
    const hasImages = images.length > 0
    const messages = buildPrompt(content, toLocalIso(entry.createdAt), categories, tags, hasImages, locationAddress)
    if (hasImages) {
      const userMsg = messages[messages.length - 1]
      if (typeof userMsg.content === 'string') {
        const imgNote = '\n\n（本条目另附图片/视频帧，请结合图像内容进行分类与摘要，并在 mediaDescription 字段返回图片/视频理解原文。）'
        const textPart: VisionTextPart = { type: 'text', text: userMsg.content + imgNote }
        const imgParts: VisionImagePart[] = images.map((u) => ({ type: 'image_url', image_url: { url: u } }))
        userMsg.content = [textPart, ...imgParts]
      }
    }
    let res = await chatFetch(messages, hasImages ? '/api/vlm/chat' : '/api/llm/chat')
    if (!res.ok && hasImages) {
      // 降级（D14/D17 镜像 BYOK）：VLM 端点非 OK（如 model 不支持 image_url、后端 VLM 未配）→
      // 去图纯文本重发走 /api/llm/chat。但纯图无文本（content.trim()===''）不能降级——降级后
      // 空 prompt 会让 LLM 幻觉分类（照片被标 'voice' 等虚构标签）。直接 throw，标 entry failed。
      const errText = await res.text().catch(() => '')
      if (!content.trim()) {
        throw new Error(`VLM 不可用且无文本内容可分类（HTTP ${res.status}: ${errText.slice(0, 120)}）`)
      }
      console.warn('[builtinLlm] vlm failed, falling back to text-only /api/llm/chat', res.status, errText.slice(0, 200))
      // 降级后无图，buildPrompt hasImages=false → 不请求 mediaDescription。
      const textMsgs = buildPrompt(content, toLocalIso(entry.createdAt), categories, tags, false, locationAddress)
      res = await chatFetch(textMsgs, '/api/llm/chat')
    }
    const raw = await extractReply(res)
    useQuotaStore.getState().consume('llm', 1)
    const parsed = parseJson(raw)
    const now = new Date().toISOString()
    const dedupTags = [...new Set(parsed.tags ?? [])]
    // ⚠️ 以下 EntryAi 构造 + tag/category 涌现落库逻辑：逐行对照 openAiCompatLlm.classify 同段
    const tagSlugs = new Set(tags.map((t) => t.slug))
    for (const slug of dedupTags) {
      if (!tagSlugs.has(slug)) {
        await di.storage.saveTag({ slug, label: slug, usageCount: 0, createdAt: now })
        tagSlugs.add(slug)
      }
    }
    const catSlugs = new Set(categories.map((c) => c.slug))
    if (parsed.categorySlug && !catSlugs.has(parsed.categorySlug)) {
      await di.storage.saveCategory({
        slug: parsed.categorySlug,
        label: parsed.categoryLabel ?? parsed.categorySlug,
        aliases: [], usageCount: 0, createdAt: now,
      })
    }
    const priorAi = await di.storage.getEntryAi(entryId)
    const ai: EntryAi = {
      id: crypto.randomUUID(),
      entryId,
      version: (priorAi?.version ?? 0) + 1,
      category: parsed.categorySlug,
      tags: dedupTags,
      facets: parsed.facets ?? {},
      titleSuggestion: parsed.titleSuggestion,
      summary: parsed.summary,
      reminderSuggestion: parsed.reminderSuggestion,
      // D21 镜像 BYOK：VLM 媒体理解原文（仅含图条目且 LLM 返回了该字段）。降级纯文本重发后无此字段。
      mediaDescription: parsed.mediaDescription,
      modelUsed: 'builtin-llm',
      createdAt: now,
    }
    return ai
  },

  async aggregate(entryIds, scope, range, detailLevel, id) {
    assertNetwork()
    if (entryIds.length === 0) throw new Error('无条目可聚合')
    const entries = await Promise.all(
      entryIds.map(async (eid) => {
        const entry = await di.storage.getEntry(eid)
        if (!entry) return null
        const ai = await di.storage.getEntryAi(eid)
        // D28 镜像 BYOK：按 entry.parts 真实统计图片/视频数量 + 透传 ai?.mediaDescription，
        // 让文本模型在聚合摘要末尾综合成「图片内容：…；视频内容：…」备注。
        let imageCount = 0
        let videoCount = 0
        for (const p of entry.parts) {
          const mt = inferMediaType(p)
          if (mt === 'image') imageCount++
          else if (mt === 'video') videoCount++
        }
        return {
          id: eid,
          text: entryText(entry),
          aiSummary: ai?.summary,
          imageCount,
          videoCount,
          mediaDescription: ai?.mediaDescription,
        }
      }),
    )
    const valid = entries.flatMap((e) => (e === null ? [] : [e]))
    if (valid.length === 0) throw new Error('条目无文本可聚合')
    const clampedLevel = Math.min(5, Math.max(1, detailLevel ?? 3))
    const messages = buildAggregatePrompt(valid, scope, clampedLevel)
    const raw = await chat(messages)
    useQuotaStore.getState().consume('llm', 1)
    useQuotaStore.getState().consume('agg', 1)
    const parsed = parseAggregateJson(raw)
    // ⚠️ Aggregate 构造：逐行对照 openAiCompatLlm.aggregate 同段（scope/summary/highlights 字段）
    const now = new Date().toISOString()
    const ag: Aggregate = {
      id: id ?? crypto.randomUUID(),
      scope: { type: scope, range },
      summary: parsed.sentences && parsed.sentences.length > 0 ? parsed.sentences.join('') : (parsed.summary ?? ''),
      highlights: parsed.highlights,
      entryIds: valid.map((v) => v.id),
      modelUsed: 'builtin-llm',
      createdAt: now,
      stale: false,
      detailLevel: clampedLevel,
    }
    return ag
  },

  async parseChatIntent(question, nowIso) {
    assertNetwork()
    const messages = buildIntentPrompt(question, toLocalIso(nowIso))
    const raw = await chat(messages)
    useQuotaStore.getState().consume('llm', 1)
    return parseIntentJson(raw)
  },

  async answerChat({ question, cites, conversation }) {
    assertNetwork()
    const messages = buildAnswerPrompt(question, cites, conversation)
    const raw = await chat(messages)
    useQuotaStore.getState().consume('llm', 1)
    const parsed = parseAnswerJson(raw)
    const validIds = new Set(cites.map((c) => c.id))
    const citedEntryIds = parsed.citedEntryIds.filter((cid) => validIds.has(cid))
    return { answer: parsed.answer, citedEntryIds } satisfies ChatAnswer
  },

  // ping 签名必须接受可选 opts（LlmPort.ping(opts?)），即使 builtin 忽略 opts。
  async ping(_opts?: { url?: string; model?: string; key?: string }) {
    try {
      assertNetwork()
      const started = performance.now()
      await chat([{ role: 'user', content: 'ping' }])
      return { ok: true, latencyMs: Math.round(performance.now() - started) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) }
    }
  },
}
