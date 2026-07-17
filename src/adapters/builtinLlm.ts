// src/adapters/builtinLlm.ts
// Slice B 内置 key 代理 LLM 适配器：实现 LlmPort，所有调用代理到后端 POST /api/llm/chat。
// 后端注入真实 DeepSeek key 并扣配额；前端只持 JWT（network 账号会话）。
// 与 openAiCompatLlm（BYOK）共存——后续 llmProxy(T11) 按 settings.keySource 路由。
//
// 与 openAiCompatLlm 的差异仅 4 点：(1) fetch 端点 /api/llm/chat；(2) auth=JWT（401→refresh 重试一次）；
// (3) 每次 LLM 调用 bump 配额（mockQuotaInternal）；(4) VLM 剥离——不读 vlmKeyRef、不附 image_url、
// 不读 videoVisionEnabled，含图条目走纯文本分类（spec §4.7 已知退化）。
// prompt 组装 / JSON 解析 / EntryAi·Aggregate 构造逻辑复用 openAiCompatLlm 的 10 个 helper（export 零行为改动）。
import type { LlmPort } from '@/ports'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import type { Aggregate, ChatAnswer, EntryAi } from '@/domain/types'
import { di } from '@/app/di'
import { useAccountStore } from '@/app/accountStore'
import { localSession } from '@/app/session'
import { mockAuth } from '@/adapters/mockAuth'
import { mockQuotaInternal } from '@/adapters/mockQuota'
import {
  entryText, toLocalIso, buildPrompt, parseJson,
  buildAggregatePrompt, parseAggregateJson,
  buildIntentPrompt, parseIntentJson,
  buildAnswerPrompt, parseAnswerJson,
} from '@/adapters/openAiCompatLlm'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

function assertNetwork(): void {
  const a = useAccountStore.getState().account
  if (!a || a.type !== 'network') throw new NotNetworkError()
}

// 统一 chat 端点：所有 LLM 方法组装成 OpenAI 兼容 messages 发 /api/llm/chat。
// 401 → refresh 重试一次 → 再 401 抛 SessionExpiredError。
// role 用 string（非字面量联合）：buildIntentPrompt/buildAnswerPrompt 无显式返回类型，
// 推断为 role:string；这里放宽以接受所有 helper 产出，后端负责校验。
async function chat(messages: { role: string; content: unknown }[]): Promise<string> {
  const session = localSession.get()
  if (!session) throw new SessionExpiredError()
  const doFetch = (jwt: string) =>
    fetch(`${BASE}/api/llm/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, opts: {} }),
    })
  let res = await doFetch(session.jwt)
  if (res.status === 401) {
    let newSession
    try {
      newSession = await mockAuth.refresh()
      localSession.set(newSession)
    } catch {
      localSession.clear()
      throw new SessionExpiredError()
    }
    res = await doFetch(newSession.jwt)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`builtinLlm HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const reply = data?.reply
  if (typeof reply !== 'string') throw new Error('builtinLlm 响应缺 reply')
  return reply
}

export const builtinLlm: LlmPort = {
  async classify(entryId) {
    assertNetwork()
    const entry = await di.storage.getEntry(entryId)
    if (!entry) throw new Error('entry not found: ' + entryId)
    const content = entryText(entry)
    const hasVideoParts = entry.parts.some((p) => p.type === 'video')
    if (!content.trim() && !hasVideoParts) throw new Error('条目无文本/媒体可分类')
    // VLM 退化（§4.7）：builtin 路径不读 vlmKeyRef、不附 image_url。buildPrompt 只产文本 content。
    const categories = await di.storage.listCategories()
    const tags = await di.storage.listTags()
    const messages = buildPrompt(content, toLocalIso(entry.createdAt), categories, tags)
    mockQuotaInternal.bumpLlm()
    const raw = await chat(messages)
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
        return { id: eid, text: entryText(entry), aiSummary: ai?.summary }
      }),
    )
    const valid = entries.flatMap((e) => (e === null ? [] : [e]))
    if (valid.length === 0) throw new Error('条目无文本可聚合')
    const clampedLevel = Math.min(5, Math.max(1, detailLevel ?? 3))
    const messages = buildAggregatePrompt(valid, scope, clampedLevel)
    mockQuotaInternal.bumpLlm()
    mockQuotaInternal.bumpAgg()
    const raw = await chat(messages)
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
    mockQuotaInternal.bumpLlm()
    const raw = await chat(messages)
    return parseIntentJson(raw)
  },

  async answerChat({ question, cites, conversation }) {
    assertNetwork()
    const messages = buildAnswerPrompt(question, cites, conversation)
    mockQuotaInternal.bumpLlm()
    const raw = await chat(messages)
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
