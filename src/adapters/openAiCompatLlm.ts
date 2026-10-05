import type { LlmPort, ChatStreamEvent } from '@/ports'
import type { Aggregate, AggregateScopeType, ChatAnswer, ChatCite, EntryAi } from '@/domain/types'
import { di } from '@/app/di'
import { BUILTIN_VLM_URL, BUILTIN_VLM_MODEL } from '@/adapters/builtinDefaults'
import { iterateSse } from '@/adapters/sseStream'
// 共享 prompt/parse 层（builder/parse/helper）已抽取至 llmShared（2026-10-05 E2）——
// 本文件只保留 BYOK port 对象 + 私有 HTTP/SSE/key 实现，不 re-export（import 方全改指 llmShared）。
import {
  entryText, collectEntryImages, inferMediaType, toLocalIso,
  buildPrompt, loadEnabledMemoryContents, parseJson,
  buildAggregatePrompt, parseAggregateJson,
  buildIntentPrompt, parseIntentJson,
  buildAnswerPrompt, parseAnswerJson, sanitizeInlineCites,
  buildExtractMemoryPrompt, parseMemoryReply,
  buildConversationSummaryPrompt,
  buildMemoryAdjudicationPrompt, parseAdjudicationJson,
  buildProactiveGreetingPrompt, parseProactiveGreetingReply,
} from '@/adapters/llmShared'
import type { ChatMessage, VisionImagePart, VisionTextPart } from '@/adapters/llmShared'

// LlmPort PWA 适配：OpenAI 兼容 chat completions（BYOK）。任意 OpenAI 兼容 endpoint 均可——
// DeepSeek / Kimi / 通义 / Moonshot / OpenAI / Azure / OpenRouter / vLLM / Ollama / Aliyun PI
// compatible-mode。isDeepSeek(url,model) 守门：仅 DeepSeek endpoint 发私有 thinking 参数，严格
// 兼容服务不发（免 400）。key/url/model 从 Settings(llmUrl/llmModel) + SecretStorePort('llm:key')
// 取——永不入源码。key 缺失 → throw，管线 catch 后条目标 failed（AI-only 降级，采集存储不伤）。
// 涌现：LLM 标的新类别/标签在此落库（有 label 信息）。Vision（2026-07-17）：classify 附图/视频帧
// （OpenAI image_url 多模态）；model 不支持 image_url 时静默降级去图纯文本重发，不崩。
// aggregate/answerChat 不附图（控成本，图语义经 classify 进 summary 间接含）。

const SECRET_KEY = 'llm:key'

// thinking:{type:'disabled'} 是 DeepSeek 私有参数；严格 OpenAI 兼容服务（Azure/vLLM/llama.cpp）
// 会返 400。仅在 endpoint/model 指示 DeepSeek 时发送——port 契约称「OpenAI 兼容」才名副其实。
function isDeepSeek(url: string, model: string): boolean {
  return /deepseek/i.test(url) || /deepseek/i.test(model)
}

// 流式 answer 轮（2026-09-28 问 AI 流式输出）：stream:true + iterateSse 逐帧分流——
// reasoning_content → onEvent reasoning（「思考过程」折叠块实时渲染）；content → 累积
// rawAccum + onEvent content（气泡逐字渲染，UI 侧经 extractPartialAnswer 提可见文本）。
// 收口与非流式一致：parseAnswerJson（截断宽容）→ sanitizeInlineCites → validIds 过滤。
// 中途断流：rawAccum 有内容 → 宽容解析返回部分答案（不打断对话）；空 → 抛错走现有 error 路径。
async function answerChatStreaming(
  opts: { question: string; cites: ChatCite[]; conversation: { role: 'user' | 'assistant'; content: string; date?: string }[]; extraSystem?: string },
  onEvent: (ev: ChatStreamEvent) => void,
): Promise<ChatAnswer> {
  const settings = await di.storage.getSettings()
  const apiKey = await di.secrets.get(SECRET_KEY)
  const url = settings.llmUrl
  const model = settings.llmModel || 'deepseek-v4-flash'
  if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
  // AI 记忆注入：与非流式分支一致（prompt 同源 buildAnswerPrompt）。
  const memories = await loadEnabledMemoryContents()
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: buildAnswerPrompt(opts.question, opts.cites, opts.conversation, memories, opts.extraSystem),
      max_tokens: 8192,
      temperature: 0.4,
      // thinking 策略同非流式分支（不禁，见 answerChat 注释）；仅多 stream:true。
      stream: true,
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  if (!res.body) throw new Error('LLM 响应无 body（流式读取失败）')
  let rawAccum = ''
  try {
    for await (const payload of iterateSse(res.body)) {
      let frame: unknown
      try {
        frame = JSON.parse(payload)
      } catch {
        continue // 坏帧跳过（代理噪声/半截帧），不毁整轮
      }
      const delta = (frame as {
        choices?: { delta?: { reasoning_content?: unknown; content?: unknown } }[]
      })?.choices?.[0]?.delta
      if (!delta) continue // finish_reason / usage 帧无 delta
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        onEvent({ type: 'reasoning', delta: delta.reasoning_content })
      }
      if (typeof delta.content === 'string' && delta.content) {
        rawAccum += delta.content
        onEvent({ type: 'content', delta: delta.content })
      }
    }
  } catch (e) {
    // 中途断流：一无所获 → 抛错走 store 现有错误路径；有内容 → 落到下方宽容解析。
    if (!rawAccum.trim()) throw e
  }
  if (!rawAccum.trim()) throw new Error('LLM 响应缺 content')
  const parsed = parseAnswerJson(rawAccum)
  const validIds = new Set(opts.cites.map((c) => c.id))
  const citedEntryIds = parsed.citedEntryIds.filter((id) => validIds.has(id))
  // D29 内联引用清洗：与非流式分支同一 helper，双口径不漂移。
  const answer = sanitizeInlineCites(parsed.answer, validIds)
  return { answer, citedEntryIds }
}

export const openAiCompatLlm: LlmPort = {
  async classify(entryId) {
    const settings = await di.storage.getSettings()
    const entry = await di.storage.getEntry(entryId)
    if (!entry) throw new Error('entry not found: ' + entryId)
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    const content = entryText(entry)
    const hasVideoParts = entry.parts.some((p) => p.type === 'video')
    if (!content.trim() && !hasVideoParts) throw new Error('条目无文本/媒体可分类')
    const categories = await di.storage.listCategories()
    const tags = await di.storage.listTags()
    // AI 记忆注入（2026-07-22 §3）：enabled 记忆 content 数组传入 buildPrompt。
    const memories = await loadEnabledMemoryContents()
    // 地点：entry.location.address（reverse geocoded）喂给 LLM 填 facets.place，
    // 让「类别地图·地点」能聚类。无 address（离线/未反查）时不喂，LLM 仍可从正文提取。
    const locationAddress = entry.location?.address?.trim() || entry.location?.label?.trim() || undefined
    // Vision：附图/视频帧（OpenAI image_url 多模态）。videoVisionEnabled 关 → 纯文本。
    // D21: 先抽图再 buildPrompt，以便把 hasImages 传入 schema（加 mediaDescription 输出字段）。
    let images: string[] = []
    if (settings.videoVisionEnabled && hasVideoParts) {
      images = await collectEntryImages(entry, settings.videoFrameIntervalSec)
    }
    const hasImages = images.length > 0
    const messages = buildPrompt(content, toLocalIso(entry.createdAt), categories, tags, hasImages, locationAddress, memories)
    if (hasImages) {
      const userMsg = messages[messages.length - 1]
      if (typeof userMsg.content === 'string') {
        const imgNote = '\n\n（本条目另附图片/视频帧，请结合图像内容进行分类与摘要，并在 mediaDescription 字段返回图片/视频理解原文。）'
        const textPart: VisionTextPart = { type: 'text', text: userMsg.content + imgNote }
        const imgParts: VisionImagePart[] = images.map((u) => ({ type: 'image_url', image_url: { url: u } }))
        userMsg.content = [textPart, ...imgParts]
      }
    }
    // VLM 路由：含图且独立 VLM 已配（vlmUrl+vlmModel+vlm:key）→ 视觉 fetch 走 VLM 端点（如 qwen3.5-flash
    // on Aliyun PI）；否则回落主 LLM。文本条目始终走主 LLM。降级（§5.2）去图纯文本重发走同一端点。
    // D30: vlmUrl/vlmModel 回落 BUILTIN_VLM_URL/MODEL（env 烘入），用户未手动配 URL/model 但配了
    // vlm:key 时也能用内置默认端点。用户自配值优先。
    const vlmUrl = settings.vlmUrl || BUILTIN_VLM_URL
    const vlmModel = settings.vlmModel || BUILTIN_VLM_MODEL
    let vlmKey: string | undefined
    if (images.length > 0 && vlmUrl && vlmModel) {
      vlmKey = await di.secrets.get('vlm:key')
    }
    const useVlm = images.length > 0 && !!vlmUrl && !!vlmModel && !!vlmKey
    const fUrl = useVlm ? vlmUrl! : url
    const fModel = useVlm ? vlmModel! : model
    const fKey = useVlm ? vlmKey! : apiKey
    // thinking 关闭：v4-flash/pro 默认走 reasoning_content（content 空），关掉后 JSON 直出 content，适配器才读得到。
    // DeepSeek 私有参数——非 DeepSeek endpoint 不发（isDeepSeek 守门），免得严格 OpenAI 兼容服务返 400。
    const bodyOf = (msgs: ChatMessage[], m: string, u: string) => ({ model: m, messages: msgs, max_tokens: 512, temperature: 0.3, ...(isDeepSeek(u, m) ? { thinking: { type: 'disabled' } } : {}) })
    let res = await fetch(fUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyOf(messages, fModel, fUrl)),
    })
    if (!res.ok && images.length > 0) {
      // 降级：model 不支持 image_url（常见 400）→ 去图纯文本重发。
      // 但纯图无文本（content.trim()===''）时不能降级——降级后空 prompt 会让 LLM 幻觉
      // 分类（D14/D17：照片被标 'voice'/'视频' 等虚构标签）。直接 throw，让上层 classify
      // 标 entry failed，比幻觉分类更安全。
      const errText = await res.text().catch(() => '')
      if (!content.trim()) {
        throw new Error(`VLM 不可用且无文本内容可分类（HTTP ${res.status}: ${errText.slice(0, 120)}）`)
      }
      console.warn('[llm] vision failed, falling back to text-only', res.status, errText.slice(0, 200))
      // D21: 降级后无图，buildPrompt hasImages=false → 不请求 mediaDescription（LLM 也看不到图）。
      const textMsgs = buildPrompt(content, toLocalIso(entry.createdAt), categories, tags, false, locationAddress, memories)
      res = await fetch(fUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${fKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyOf(textMsgs, fModel, fUrl)),
      })
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    const parsed = parseJson(raw)
    const now = new Date().toISOString()
    // tags 去重（LLM 偶返重复 slug，审计 minor）
    const dedupTags = [...new Set(parsed.tags ?? [])]

    // 涌现：新标签落库（label=slug，用户后续可策展重命名）
    const tagSlugs = new Set(tags.map((t) => t.slug))
    for (const slug of dedupTags) {
      if (!tagSlugs.has(slug)) {
        await di.storage.saveTag({ slug, label: slug, usageCount: 0, createdAt: now })
        tagSlugs.add(slug)
      }
    }
    // 涌现：新类别落库（accent 留空，UI 兜底默认色；用户可策展）
    const catSlugs = new Set(categories.map((c) => c.slug))
    if (parsed.categorySlug && !catSlugs.has(parsed.categorySlug)) {
      await di.storage.saveCategory({
        slug: parsed.categorySlug,
        label: parsed.categoryLabel ?? parsed.categorySlug,
        aliases: [],
        usageCount: 0,
        createdAt: now,
      })
    }

    // D1: 版本递增——重处理生成更新版本，配合 dexieStorage.getEntryAi 的 createdAt tie-break，
    // detail「重处理」不再返回过期 AI。
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
      // B4: 仅 LLM 建议，不调度——用户在 TodoConfirm(B6) 确认后才建 Reminder
      reminderSuggestion: parsed.reminderSuggestion,
      // D21: VLM 媒体理解原文（仅含图条目且 LLM 返回了该字段）。降级纯文本重发后无此字段。
      mediaDescription: parsed.mediaDescription,
      modelUsed: fModel,
      createdAt: now,
    }
    return ai
  },
  async aggregate(entryIds: string[], scope: AggregateScopeType, range: string, detailLevel?: number, id?: string) {
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    if (entryIds.length === 0) throw new Error('无条目可聚合')

    // Pull entries + their AI summaries to feed the prompt.
    // D28: 同时取 ai?.mediaDescription + 统计 entry.parts 的图片/视频数量，传给 prompt 让
    // 文本模型在摘要末尾综合成「图片内容：…；视频内容：…」备注（而非 raw append）。
    const entries = await Promise.all(
      entryIds.map(async (id) => {
        const entry = await di.storage.getEntry(id)
        if (!entry) return null
        const ai = await di.storage.getEntryAi(id)
        let imageCount = 0
        let videoCount = 0
        for (const p of entry.parts) {
          const mt = inferMediaType(p)
          if (mt === 'image') imageCount++
          else if (mt === 'video') videoCount++
        }
        return { id, text: entryText(entry), aiSummary: ai?.summary, imageCount, videoCount, mediaDescription: ai?.mediaDescription }
      }),
    )
    const valid = entries.flatMap((e) => (e === null ? [] : [e]))
    if (valid.length === 0) throw new Error('条目无文本可聚合')
    // D4: 存前 clamp 到 1-5——否则 detailLevel=99 生成 level-5 prompt 但 Aggregate.detailLevel=99，
    // stale guard 99===99 跳过重算，元数据与内容不一致。clamp 后 prompt 与 stored 一致。
    const clampedLevel = Math.min(5, Math.max(1, detailLevel ?? 3))

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildAggregatePrompt(valid, scope, clampedLevel),
        max_tokens: 768,
        temperature: 0.4,
        ...(isDeepSeek(url, model) ? { thinking: { type: 'disabled' } } : {}),
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    const parsed = parseAggregateJson(raw)
    const now = new Date().toISOString()

    // D28: 文本模型已按 prompt 铁律在 sentences 末尾生成「图片内容：…；视频内容：…」备注。
    // 安全网：若 LLM 漏写（含图片但正文无「图片内容：」/含视频但无「视频内容：」），用 VLM 原文补上同格式备注。
    const baseSummary = parsed.sentences && parsed.sentences.length > 0 ? parsed.sentences.join('') : (parsed.summary ?? '')
    const imagesParts: string[] = []
    const videosParts: string[] = []
    for (const e of valid) {
      const md = e.mediaDescription
      if (!md) continue
      if (md.images && md.images.trim()) imagesParts.push(md.images.trim())
      if (md.videos && md.videos.trim()) videosParts.push(md.videos.trim())
    }
    const hasImages = valid.some((e) => e.imageCount > 0)
    const hasVideos = valid.some((e) => e.videoCount > 0)
    const mediaBlock: string[] = []
    if (hasImages && !baseSummary.includes('图片内容：')) {
      mediaBlock.push(`图片内容：${imagesParts.length > 0 ? imagesParts.join(' | ') : '暂未识别'}`)
    }
    if (hasVideos && !baseSummary.includes('视频内容：')) {
      mediaBlock.push(`视频内容：${videosParts.length > 0 ? videosParts.join(' | ') : '暂未识别'}`)
    }
    const summary = mediaBlock.length > 0 ? `${baseSummary}\n\n${mediaBlock.join('；')}` : baseSummary

    const ag: Aggregate = {
      id: id ?? crypto.randomUUID(),
      scope: { type: scope, range },
      summary,
      highlights: parsed.highlights,
      // D3: 存校验子集（valid），非原始入参——否则 scan 与 getEntry 之间被删的 id 残留成幽灵。
      entryIds: valid.map((v) => v.id),
      modelUsed: model,
      createdAt: now,
      stale: false,
      detailLevel: clampedLevel,
    }
    return ag
  },
  // AI Chat intent 轮：解析问句→{scope,keywords,categorySlugs}。nowIso 为 UTC ISO，
  // 适配器转本地带偏移 ISO 给 LLM（与 classify 一致），LLM 据此解析「上个月/本周」等相对时间。
  async parseChatIntent(question, nowIso, categories) {
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildIntentPrompt(question, toLocalIso(nowIso), categories),
        max_tokens: 256,
        temperature: 0,
        ...(isDeepSeek(url, model) ? { thinking: { type: 'disabled' } } : {}),
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    return parseIntentJson(raw)
  },
  // AI Chat answer 轮：基于本地召回 cites + 先前对话作答。防幻觉后校验——
  // citedEntryIds 必须来自传入 cites.id 集，LLM 臆造的 id 在此剔掉（即使 prompt 已约束，仍兜底）。
  async answerChat({ question, cites, conversation, extraSystem }, onEvent) {
    // 流式分支（2026-09-28）：onEvent 存在时委托流式实现；下方非流式路径逐字节不变
    // （回归安全——intent/extractMemory 等旧调用不传 onEvent）。
    if (onEvent) return answerChatStreaming({ question, cites, conversation, extraSystem }, onEvent)
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    // AI 记忆注入（2026-07-22 §3）：enabled 记忆 content 数组传入 buildAnswerPrompt。
    const memories = await loadEnabledMemoryContents()
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildAnswerPrompt(question, cites, conversation, memories, extraSystem),
        max_tokens: 8192,
        temperature: 0.4,
        // 不禁 thinking：deepseek-v4-flash 是推理模型，禁了 thinking 会把规则 3「无依据」触发得太宽松，
        // 连明确相关的 cite 都拒答（实测「关于跑步的想法」+ e3 cite → 禁 thinking 返「库内未找到依据」，
        // 开 thinking 返「在跑步时想到…（见 e3）」）。intent 轮结构化解析可禁，answer 轮必须留推理。
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    const parsed = parseAnswerJson(raw)
    const validIds = new Set(cites.map((c) => c.id))
    const citedEntryIds = parsed.citedEntryIds.filter((id) => validIds.has(id))
    // D29: 清洗正文内联「（见 <id>）」引用——LLM 常臆造短别名（如 e3）或错配 id，UI 之前
    // 拿这些 id 找不到条目就显「已删除」（实未删）。剔掉非 validIds 的引用段（含前导空白），
    // 合法 id 保留原样交 UI 渲染成可点链接。
    const answer = sanitizeInlineCites(parsed.answer, validIds)
    return { answer, citedEntryIds }
  },
  // AI 记忆自动提取（2026-07-22 §4）：BYOK 路径走主 LLM fetch。consume 由调用方不管
  //（BYOK 无 quota 概念——builtin 路径才扣配额）。失败抛错由 store.sendMessage 静默 catch。
  // knownMemories 透传进提取 prompt 做判重（2026-09-10）。
  async extractMemory(text, knownMemories) {
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildExtractMemoryPrompt(text, knownMemories),
        max_tokens: 128,
        temperature: 0,
        ...(isDeepSeek(url, model) ? { thinking: { type: 'disabled' } } : {}),
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    return parseMemoryReply(raw)
  },
  // 文本向量化（2026-10-03 P-B §1 语义召回，BYOK 唯一 embed 链路）：embeddings URL 由
  // llmUrl 派生（/chat/completions → /embeddings）；llmUrl 非标准结尾（用户配了非标准
  // 端点）→ null 不瞎猜路径。降级语义：缺 key/url → null；HTTP 非 2xx → null（embedding
  // 是增强路径，HTTP 错误降级即可）；响应形状坏 → null；fetch 抛错（网络层异常）→ 抛错
  //（spec：抛错=调用失败）。**任何失败路径都不能影响问答主流程**——调用方
  // di.llm.embed?.() ?? null + try/catch 双层兜底。
  async embed(texts) {
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    if (!apiKey || !url) return null
    const embUrl = url.replace(/\/chat\/completions\s*$/, '/embeddings')
    if (embUrl === url) return null // 非 /chat/completions 结尾 → 不支持派生，静默降级
    const model = settings.embeddingModel || 'text-embedding-3-small'
    const res = await fetch(embUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const arr = (data as { data?: unknown } | null)?.data
    if (!Array.isArray(arr) || arr.length !== texts.length) return null
    const out: number[][] = []
    for (const item of arr) {
      const v = (item as { embedding?: unknown })?.embedding
      if (!Array.isArray(v) || v.some((n) => typeof n !== 'number')) return null
      out.push(v as number[])
    }
    return out
  },
  // 滚动对话摘要（2026-10-03 P-B §2）：现有 chat completions 通道，max_tokens 300 /
  // temperature 0。失败路径与 extractMemory 一致抛错（调用方 store 吞掉，摘要失败不影响问答）。
  async summarizeConversation(prior, chunk) {
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildConversationSummaryPrompt(prior, chunk),
        max_tokens: 300,
        temperature: 0,
        ...(isDeepSeek(url, model) ? { thinking: { type: 'disabled' } } : {}),
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    return raw.trim()
  },
  // 记忆冲突裁决（2026-10-03 P-C §3）：chat completions 通道照 extractMemory 模式，
  // max_tokens 200 / temperature 0。解析白名单 + oldId ∈ similar 校验在 parseAdjudicationJson
  // 内完成（非法统一降级 add）；抛错 = 裁决失败，调用方 store 兜底默认 ADD。
  async adjudicateMemory(newMemory, similar) {
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildMemoryAdjudicationPrompt(newMemory, similar),
        max_tokens: 200,
        temperature: 0,
        ...(isDeepSeek(url, model) ? { thinking: { type: 'disabled' } } : {}),
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    return parseAdjudicationJson(raw, new Set(similar.map((s) => s.id)))
  },
  // P-D 契约桩（2026-10-03）：typecheck 过契约 commit，A 路替换真实实现。
  // P-D 主动触达（2026-10-03 §2）：BYOK chat completions 通道照 extractMemory 模式，
  // max_tokens 80 / temperature 0.7（问候比事实任务要一点温度）。响应 NULL/空 → null
  //（调用方走模板兜底卡）；HTTP 非 2xx / 缺 content → 抛错（调用方同样兜底模板 + warn）。
  // 触发/频控/当日缓存全在调用方（home mount、6h、date+daypart），端口无状态。
  async proactiveGreeting(context) {
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildProactiveGreetingPrompt(context),
        max_tokens: 80,
        temperature: 0.7,
        ...(isDeepSeek(url, model) ? { thinking: { type: 'disabled' } } : {}),
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    return parseProactiveGreetingReply(raw)
  },
  async ping(opts?: { url?: string; model?: string; key?: string }): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const settings = await di.storage.getSettings()
    // opts：设置页连通性测试传表单未保存值（测新填配置）；省略时回落已落库 settings + secrets。
    // key 为空串视为省略——用户只改 url/model、保留旧 key 时，回落已存 secret，不误判 key 缺失。
    const url = opts?.url ?? settings.llmUrl
    const model = (opts?.model ?? settings.llmModel) || 'deepseek-v4-flash'
    const apiKey = opts?.key || await di.secrets.get(SECRET_KEY)
    if (!apiKey || !url) return { ok: false, error: 'url/key 缺失' }
    const started = performance.now()
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, ...(isDeepSeek(url, model) ? { thinking: { type: 'disabled' } } : {}) }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 120)}` }
      }
      return { ok: true, latencyMs: Math.round(performance.now() - started) }
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 120) }
    }
  },
}
