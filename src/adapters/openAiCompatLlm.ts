import type { LlmPort } from '@/ports'
import type { Aggregate, AggregateScopeType, Category, ChatCite, ChatQuery, Entry, EntryAi, Facets, MediaType, Tag } from '@/domain/types'
import { di } from '@/app/di'
import { compressImage, extractFrame, pickFrameTimes } from '@/adapters/visionMedia'
import { BUILTIN_VLM_URL, BUILTIN_VLM_MODEL } from '@/adapters/builtinDefaults'

// LlmPort PWA 适配：OpenAI 兼容 chat completions（BYOK）。任意 OpenAI 兼容 endpoint 均可——
// DeepSeek / Kimi / 通义 / Moonshot / OpenAI / Azure / OpenRouter / vLLM / Ollama / Aliyun PI
// compatible-mode。isDeepSeek(url,model) 守门：仅 DeepSeek endpoint 发私有 thinking 参数，严格
// 兼容服务不发（免 400）。key/url/model 从 Settings(llmUrl/llmModel) + SecretStorePort('llm:key')
// 取——永不入源码。key 缺失 → throw，管线 catch 后条目标 failed（AI-only 降级，采集存储不伤）。
// 涌现：LLM 标的新类别/标签在此落库（有 label 信息）。Vision（2026-07-17）：classify 附图/视频帧
// （OpenAI image_url 多模态）；model 不支持 image_url 时静默降级去图纯文本重发，不崩。
// aggregate/answerChat 不附图（控成本，图语义经 classify 进 summary 间接含）。

const SECRET_KEY = 'llm:key'

// OpenAI 兼容 message：content 可为纯文本或 image_url 多模态数组。buildPrompt 默认返纯文本
// content；classify 在有图时把 user message 的 content 升级为多模态数组（image_url base64）。
type VisionTextPart = { type: 'text'; text: string }
type VisionImagePart = { type: 'image_url'; image_url: { url: string } }
type MessageContent = string | Array<VisionTextPart | VisionImagePart>
interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: MessageContent
}

interface ClassifyResult {
  categorySlug: string
  categoryLabel?: string
  tags?: string[]
  facets?: Facets
  titleSuggestion?: string
  summary?: string
  // B4: LLM-detected time-based reminder intent. dueAt is absolute ISO 8601
  // (LLM resolves relative time using entry.createdAt as anchor). label is a
  // short user-editable summary. Absent when no reminder intent is detected.
  reminderSuggestion?: { dueAt: string; label: string }
  // D21: 当条目附图/视频帧时，VLM 在同一次调用里返回的媒体理解文本。images=照片理解、
  // videos=视频理解。仅当 prompt 含 image_url 时 LLM 才会填；纯文本条目省略。
  mediaDescription?: { images?: string; videos?: string }
}

// D7: 按 mediaType 分块标注媒体来源，LLM 能区分文本/图片/语音/视频内容，回答更鲁棒。
// mediaType 缺失时按 part.type 推断 fallback：text→文本, audio→语音, video 按 durationSec
// 区分（<=0 照片→image, >0 真视频→video）。空内容 part 跳过。多段同类型用换行连接。
// 被 classify 与 aggregate 共用 → 单条摘要与聚合摘要都带媒体类型上下文。
const MEDIA_ORDER: readonly MediaType[] = ['text', 'image', 'audio', 'video']
const MEDIA_LABELS: Record<MediaType, string> = {
  text: '【文本】',
  image: '【图片】',
  audio: '【语音转文字】',
  video: '【视频】',
}
function inferMediaType(p: Entry['parts'][number]): MediaType {
  if (p.mediaType) return p.mediaType
  if (p.type === 'text') return 'text'
  if (p.type === 'audio') return 'audio'
  // VideoPart: durationSec<=0 是拍照（image），>0 是真视频（video）
  return p.durationSec <= 0 ? 'image' : 'video'
}
export function entryText(entry: Entry): string {
  const groups: Record<MediaType, string[]> = { text: [], image: [], audio: [], video: [] }
  for (const p of entry.parts) {
    const text = p.type === 'text' ? p.content : p.transcript ?? ''
    if (!text) continue
    groups[inferMediaType(p)].push(text)
  }
  const blocks: string[] = []
  for (const mt of MEDIA_ORDER) {
    const items = groups[mt]
    if (items.length === 0) continue
    blocks.push(`${MEDIA_LABELS[mt]}\n${items.join('\n')}`)
  }
  return blocks.join('\n\n')
}

// Vision：收集 entry 的 video parts 的图像 data URL。照片（durationSec<=0）整张压缩；
// 视频抽帧（pickFrameTimes + extractFrame）后压缩。任一步失败跳过该帧，不崩。
async function collectEntryImages(entry: Entry, intervalSec: number): Promise<string[]> {
  const out: string[] = []
  for (const p of entry.parts) {
    if (p.type !== 'video') continue
    const blob = await di.storage.getMedia(p.ref)
    if (!blob) continue
    if (p.durationSec <= 0) {
      const url = await compressImage(blob)
      if (url) out.push(url)
    } else {
      for (const t of pickFrameTimes(p.durationSec, intervalSec, 8)) {
        const frame = await extractFrame(blob, t)
        if (!frame) continue
        const url = await compressImage(frame)
        if (url) out.push(url)
      }
    }
  }
  return out
}

// createdAt 落库是 UTC（Z）；LLM 解析「明天下午3点」需用户本地时区信号——转成本地带偏移
// ISO（如 2026-07-16T09:30:00+08:00），与 prompt 示例格式一致，LLM 才输出对的偏移。
export function toLocalIso(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const offStr = `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}${offStr}`
}

export function buildPrompt(content: string, createdAt: string, categories: Category[], tags: Tag[], hasImages: boolean, locationAddress?: string): ChatMessage[] {
  const catList = categories.map((c) => `${c.slug}:${c.label}`).join(', ') || '（暂无）'
  const tagList = tags.map((t) => t.slug).join(', ') || '（暂无）'
  const mediaRule = hasImages
    ? `\n6. mediaDescription：本条目附有图片/视频帧（image_url），你需在分类/摘要之外，用 1-3 句中文描述图像内容。照片填 mediaDescription.images（描述画面主体/场景/可见物体）；视频帧填 mediaDescription.videos（描述视频内容/动作/场景）。若只附照片则 videos 省略；若只附视频帧则 images 省略；若图像内容无法辨识则整个 mediaDescription 省略。此字段是用户可见的「图片/视频理解」原文，会附在聚合摘要末尾，务必写完整的中文描述句，以「。」结尾。`
    : ''
  const mediaSchema = hasImages
    ? ',"mediaDescription"?:{"images"?:string,"videos"?:string}'
    : ''
  const placeRule = locationAddress
    ? `\n${hasImages ? '7' : '6'}. 地点：条目附有记录地点「${locationAddress}」（来自定位反查，非用户手输）。填入 facets.place（用该地址，可精简到区/街道级，但保留可辨识性），用于「类别地图·地点」聚类。`
    : ''
  const system = `你是「AiJi」(AI 记) 的笔记分类助手。给定一条用户的「记」条目内容 + 条目创建时间 + 现有类别库 + 现有标签库，输出严格 JSON。

铁律：
1. 类别由内容涌现——优先复用现有类别 slug；若都不贴切，创造一个新 slug（kebab-case，英文或拼音小写连字符）+ 中文 label。绝不硬编码固定类别集。
2. 标签同理，复用或新建，2-5 个，去重。
3. 情绪只是可选侧面——若内容明显带情绪，填 facets.mood（一个词）；绝不把情绪当主轴或必填。
4. titleSuggestion 一句话 ≤16 字；summary 一句话概述。
5. 时间型提醒意图：若正文含明确的提醒/待办时间意图（如「明天下午3点提醒我给设计稿反馈」「周五记得啃 STT」「下周一早上9点交周报」），解析出绝对时间并填 reminderSuggestion：dueAt 为绝对 ISO 8601 时间戳（含时区偏移），以条目创建时间为基准解析相对表达（"明天"=createdAt 次日、"下周一"=下一个周一等）；label 为 ≤12 字短摘要，用户后续可改。仅建议不调度——不创建任何 Reminder。无明确时间提醒意图时此字段必须省略，绝不臆造时间。${mediaRule}${placeRule}

输出 JSON schema：
{"categorySlug":string,"categoryLabel"?:string,"tags":string[],"facets":{"mood"?:string,"person"?:string[],"place"?:string,"project"?:string,"event"?:string},"titleSuggestion"?:string,"summary"?:string,"reminderSuggestion"?:{"dueAt":string,"label":string}${mediaSchema}}

只输出 JSON，不要 markdown 围栏、不要解释。`
  const example = `示例1（无提醒意图，reminderSuggestion 省略）：
内容："把 CapturePort 抽成接口，PWA 和 Capacitor 各实现一个，UI 层不动。"
现有类别：idea:想法, project:项目进展, life:生活片段
输出：{"categorySlug":"project","tags":["aiji","design"],"facets":{"project":"AiJi"},"titleSuggestion":"CapturePort 接口化","summary":"抽 CapturePort 为接口，PWA/Capacitor 各实现"}

示例2（含提醒意图，相对时间解析为绝对 ISO）：
内容："明天下午3点提醒我给设计稿反馈。"
条目创建时间：2026-07-16T09:30:00+08:00
现有类别：idea:想法, project:项目进展, life:生活片段
输出：{"categorySlug":"project","tags":["design","reminder"],"facets":{"project":"设计稿"},"titleSuggestion":"给设计稿反馈","summary":"明天下午3点给设计稿反馈","reminderSuggestion":{"dueAt":"2026-07-17T15:00:00+08:00","label":"给设计稿反馈"}}`
  const user = `条目创建时间：${createdAt}
现有类别：${catList}
现有标签：${tagList}
条目内容：
${content}

输出 JSON。`
  return [
    { role: 'system', content: system + '\n\n' + example },
    { role: 'user', content: user },
  ]
}

// thinking:{type:'disabled'} 是 DeepSeek 私有参数；严格 OpenAI 兼容服务（Azure/vLLM/llama.cpp）
// 会返 400。仅在 endpoint/model 指示 DeepSeek 时发送——port 契约称「OpenAI 兼容」才名副其实。
function isDeepSeek(url: string, model: string): boolean {
  return /deepseek/i.test(url) || /deepseek/i.test(model)
}

function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : undefined
}

function asStringRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

// 轻校验：LLM 响应是外部边界，畸形 JSON 不应静默流入 EntryAi.facets（审计 minor / S3）。
// 不做完整 schema 校验，只把字段类型守到契约内，畸形部分降级为 undefined 而非 as 强转。
export function parseJson(raw: string): ClassifyResult {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('LLM 未返回 JSON')
  const parsed = JSON.parse(s.slice(start, end + 1))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LLM 未返回 JSON 对象')
  }
  const p = parsed as Record<string, unknown>
  const reminder = asStringRecord(p.reminderSuggestion)
  const md = asStringRecord(p.mediaDescription)
  const mdImages = md && typeof md.images === 'string' && md.images.trim() ? md.images : undefined
  const mdVideos = md && typeof md.videos === 'string' && md.videos.trim() ? md.videos : undefined
  const mediaDescription: ClassifyResult['mediaDescription'] =
    mdImages || mdVideos
      ? { images: mdImages, videos: mdVideos }
      : undefined
  const result: ClassifyResult = {
    categorySlug: typeof p.categorySlug === 'string' ? p.categorySlug : '',
    categoryLabel: typeof p.categoryLabel === 'string' ? p.categoryLabel : undefined,
    tags: asStringArray(p.tags),
    facets: asStringRecord(p.facets) as ClassifyResult['facets'],
    titleSuggestion: typeof p.titleSuggestion === 'string' ? p.titleSuggestion : undefined,
    summary: typeof p.summary === 'string' ? p.summary : undefined,
    reminderSuggestion:
      reminder && typeof reminder.dueAt === 'string' && typeof reminder.label === 'string'
        ? { dueAt: reminder.dueAt, label: reminder.label }
        : undefined,
    // D21: 仅在至少一个子字段非空时保留；全空则 undefined（不落库空对象）。
    mediaDescription,
  }
  // D14/D17: 空 categorySlug 说明 LLM 无分类依据（典型：纯图条目 VLM 失败后空 prompt 降级
  // 触发 LLM 幻觉，曾返 categorySlug='voice' 等虚构标签）。拒绝而非落库幻觉分类——
  // 让 classify 抛错 → 管线标 entry failed，比错误分类更安全。
  if (!result.categorySlug.trim()) {
    throw new Error('LLM 返回空 categorySlug（无分类依据，可能因空 prompt 幻觉）')
  }
  return result
}

interface AggregateResult {
  sentences?: string[]
  summary?: string
  highlights?: string[]
}

// Build the aggregate prompt: given N entries (text + their AI summaries), ask
// the LLM to produce a period-level digest. few-shot one example.
// D28: 同时传入每条的图片/视频数量与 VLM 媒体理解原文，让文本模型在 sentences 末尾综合成
// 「图片内容：…；视频内容：…」备注（而非 raw append，也非单纯计数）。
export function buildAggregatePrompt(
  entries: { id: string; text: string; aiSummary?: string; imageCount: number; videoCount: number; mediaDescription?: { images?: string; videos?: string } }[],
  scope: AggregateScopeType,
  detailLevel: number,
) {
  const scopeLabel = scope === 'day' ? '日' : scope === 'week' ? '周' : '月'
  // Wave 3: verbosity levels 1-5 (idx 0 = L1). Default 3 (standard).
  // summary 以结构化 sentences 数组强约束句数（LLM 对"恰好 N 个数组元素"服从度远高于"N 句话"软指令）。
  const LEVELS = [
    { count: 1, highlights: '0 条（输出空数组 []）', tone: '极简：1 句，≤30 字' },
    { count: 2, highlights: '1-2 条', tone: '简洁：2 句' },
    { count: 3, highlights: '2-3 条', tone: '标准：3 句' },
    { count: 5, highlights: '3-5 条', tone: '详细：5 句' },
    { count: 7, highlights: '5-7 条', tone: '详尽：7 句，含跨条目脉络与时间线索' },
  ] as const
  const lvl = LEVELS[Math.min(4, Math.max(0, (detailLevel ?? 3) - 1))]
  const n = lvl.count
  // D28: 统计本时段是否含图片/视频，决定是否启用媒体备注铁律。
  const hasImages = entries.some((e) => e.imageCount > 0)
  const hasVideos = entries.some((e) => e.videoCount > 0)
  const mediaRule = (hasImages || hasVideos)
    ? `\n6. 媒体备注：本时段条目含图片/视频（见每条的「图片 N 张」「视频 M 段」及「图片理解」「视频理解」原文）。sentences 最后一个元素必须是媒体备注句，格式严格为「图片内容：<把各条目图片理解综合成连贯中文描述>；视频内容：<把各条目视频理解综合成连贯中文描述>」——综合而非罗列，可适当提炼但保留关键画面信息。${hasImages ? '本时段有图片 → 必须含「图片内容：」段。' : '本时段无图片 → 不要写「图片内容：」段。'}${hasVideos ? '本时段有视频 → 必须含「视频内容：」段。' : '本时段无视频 → 不要写「视频内容：」段。'}该媒体备注句计入上述 ${n} 句总数（即其余提炼句为 ${n - 1} 句）。`
    : ''
  const system = `你是「AiJi」(AI 记) 的聚合摘要助手。给定一个${scopeLabel}内用户的若干条「记」条目（每条含原文与 AI 单条摘要），输出该${scopeLabel}的聚合摘要。

铁律：
1. 输出 JSON：{"sentences":string[], "highlights":string[]}。
2. sentences 数组**必须恰好包含 ${n} 个元素**（${lvl.tone}）。每个元素是一句完整中文，以「。」结尾，不得合并、不得拆分、不得多一句或少一句。
3. highlights 为 ${lvl.highlights} 该时段关键亮点（每条 ≤16 字），反映最重要的内容/想法/进展。
4. 不要罗列每条条目，要提炼跨条目共性与脉络。
5. 情绪只是可选侧面，不当主轴。${mediaRule}

只输出 JSON，不要 markdown 围栏、不要解释。`
  const example = `示例（sentences 恰好 3 句的范式——你的句数须依上面的 ${n} 而定，不照搬示例句数）：
条目1：原文="把 CapturePort 抽成接口，PWA 和 Capacitor 各实现一个。" 摘要="抽 CapturePort 为接口，PWA/Capacitor 各实现"
条目2：原文="地铁里想到如果记一条东西能顺便变成提醒就好了。" 摘要="希望记录时能顺带生成提醒"
条目3：原文="读到一篇讲 second brain 的文章，核心是不要整理只要捕获。" 摘要="只捕获不整理，整理交给后端"
输出：{"sentences":["本周以 AiJi 项目推进为主轴：抽象端口、涌现分类逐步成形。","穿插阅读笔记（second brain：只捕获不整理）与地铁灵感（记录变提醒）。","整体偏专注，偏工程向。"],"highlights":["CapturePort 接口化","记录变提醒","Second brain 阅读"]}`

  const items = entries
    .map((e, i) => {
      const media = (e.imageCount > 0 || e.videoCount > 0)
        ? ` 图片=${e.imageCount}张 视频=${e.videoCount}段`
        : ''
      const mdImg = e.mediaDescription?.images?.trim() ? ` 图片理解="${e.mediaDescription!.images!.trim()}"` : ''
      const mdVid = e.mediaDescription?.videos?.trim() ? ` 视频理解="${e.mediaDescription!.videos!.trim()}"` : ''
      return `条目${i + 1}：原文="${e.text}"${e.aiSummary ? ` 摘要="${e.aiSummary}"` : ''}${media}${mdImg}${mdVid}`
    })
    .join('\n')

  const user = `时段：${scopeLabel}
条目数：${entries.length}
要求：sentences 数组恰好 ${n} 个元素。
${items}

输出 JSON。`
  return [
    { role: 'system', content: system + '\n\n' + example },
    { role: 'user', content: user },
  ]
}

export function parseAggregateJson(raw: string): AggregateResult {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('LLM 未返回 JSON')
  const parsed = JSON.parse(s.slice(start, end + 1))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LLM 未返回 JSON 对象')
  }
  const p = parsed as Record<string, unknown>
  return {
    sentences: asStringArray(p.sentences),
    summary: typeof p.summary === 'string' ? p.summary : undefined,
    highlights: asStringArray(p.highlights),
  }
}

// ── AI Chat · 纯读检索 (docs/design/ai-chat-impl-plan.md) ──────────────────
// 两轮 LLM：intent 解析问句→结构化 query；answer 基于本地召回 cites 作答 + 引用。
// 调用方在两轮之间跑 localRecall。防幻觉：answer 的 citedEntryIds port 层后校验剔非法 id。

// intent 轮：把自然语言问句解析成 {scope, keywords, categorySlugs}。scope.range 用与
// aggregate 一致的 ISO 格式（day=YYYY-MM-DD / week=YYYY-Www / month=YYYY-MM），以 nowIso
// 为锚解析相对时间。ISO 周号由 LLM 给（可能偏差 1 号，但 localRecall 是结构化∪keyword
// 召回，时间过滤错只收窄、不全丢——keyword 兜底）。无时间意图 scope=null。
export function buildIntentPrompt(question: string, nowIso: string) {
  const system = `你是「AiJi」(AI 记) 的检索意图解析器。给定用户问句 + 当前本地时间，输出严格 JSON，供本地检索用。

铁律：
1. scope：若问句含时间意图（今天/昨天/本周/上周/上个月/最近X天/具体日期），解析为绝对时间范围。type 为 day|week|month，range 用 ISO 格式：day=YYYY-MM-DD、week=YYYY-Www（ISO 周号，周一为首日）、month=YYYY-MM。以「当前时间」为锚：今天=当日、昨天=前一日、本周=当前周、上周=前一周、上个月=前一月。无时间意图时 scope=null。
2. keywords：提取**所有具体实体/主题词**用于本地检索匹配。包括：
   - 地名/地点（上海、北京、望京、咖啡店、楼下）—— 这类常存在条目的 location.address 或 facets.place，是关键检索信号，务必保留。
   - 人名、项目名、物品名、活动名（跑步、桂花拿铁、CapturePort、设计稿）。
   - 主题词（购物、开会、健身）。
   必须去掉纯功能词（的/了/我/关于/什么/怎么/那个/这条/记了/东西 等）。但实体名词即使短也要保留。宁可多留实体词也不要漏掉地名/人名。1-8 个，小写。
3. categorySlugs：若问句明显指向某类别（如「想法」「项目」），给 slug；不确定就省略此字段。绝不臆造。
4. 只输出 JSON，不要 markdown 围栏、不要解释。

输出 schema：
{"scope":{"type":"day|week|month","range":"<ISO>"}|null,"keywords":string[],"categorySlugs"?:string[]}`
  const example = `示例1（时间+具体词，去泛词「想法」）：
问句："我上个月关于跑步的想法"
当前时间：2026-07-17T10:30:00+08:00
输出：{"scope":{"type":"month","range":"2026-06"},"keywords":["跑步"]}

示例2（地点实体必须保留）：
问句："上海记了什么"
当前时间：2026-07-17T10:30:00+08:00
输出：{"scope":null,"keywords":["上海"]}

示例3（物品+地点实体）：
问句："桂花拿铁那条"
当前时间：2026-07-17T10:30:00+08:00
输出：{"scope":null,"keywords":["桂花拿铁"]}

示例4（本周，宽泛问句留少量主题词）：
问句："这周做了什么"
当前时间：2026-07-17T10:30:00+08:00（2026-W29）
输出：{"scope":{"type":"week","range":"2026-W29"},"keywords":[]}`
  const user = `问句：${question}
当前时间：${nowIso}
输出 JSON。`
  return [
    { role: 'system', content: system + '\n\n' + example },
    { role: 'user', content: user },
  ]
}

// answer 轮：基于传入 cites（本地召回条目）+ 先前对话作答。
// 设计取向（D35）：效果优先，不省 token。召回条目可能只是弱相关（兜底近期 top-K），
// 让 LLM 综合判断相关性并诚实作答，而非硬模板「未找到」。只有确实无任何相关条目时才说明。
// 铁律：citedEntryIds 必须是 cites 中真实存在的 id；绝不臆造引用或条目内容。
export function buildAnswerPrompt(question: string, cites: ChatCite[], conversation: { role: 'user' | 'assistant'; content: string }[]) {
  const citesBlock = cites.length === 0
    ? '（无召回条目）'
    : cites.map((c) => {
        const parts = [`id=${c.id}`, c.createdAt.slice(0, 10), `类别=${c.categorySlug || '未分类'}`]
        if (c.summary) parts.push(`摘要=${c.summary}`)
        if (c.place) parts.push(`地点=${c.place}`)
        if (c.tags.length) parts.push(`标签=${c.tags.join(',')}`)
        return `- ${parts.join(' | ')}\n  原文摘录：${c.textExcerpt}`
      }).join('\n')
  const system = `你是「AiJi」(AI 记) 的智能问答助手，帮用户从他的「记」条目里找信息、做总结、聊内容。这是个对话窗口，回答要自然、有用、像在跟用户聊，不要死板。

你的依据是下方「召回条目」（用户库内的笔记，含原文摘录/摘要/地点/标签/类别）。调用规范：
1. 优先用召回条目里的信息作答。可以综合多条条目归纳（如「这周你主要在忙 X 和 Y」「关于上海，你记了…」）。
2. 召回条目可能含弱相关或兜底近期条目——判断相关性后决定是否采用。相关的就用作答依据，无关的忽略。
3. 引用条目时用「（见 <id>）」标注，id 必须来自下方条目 id 集。citedEntryIds 列出你实际依据的条目 id。
4. 若召回条目确实与问题无关（比如问上海但条目全是北京的内容），诚实说「没找到相关的，要不要换个问法或告诉我大概时间」，citedEntryIds=[]。不要硬凑也不要臆造。
5. 不得编造条目里没有的具体内容（人名/数字/事件细节）。可以概括、可以推断语气，但事实性内容必须有条目支撑。
6. 回答用中文，自然流畅，可分点可分段。该详细就详细，别为省字数牺牲有用性。

召回条目：
${citesBlock}

输出 schema（纯 JSON，无围栏）：
{"answer":string,"citedEntryIds":string[]}`
  const msgs = [
    { role: 'system' as const, content: system },
    ...conversation,
    { role: 'user' as const, content: question },
  ]
  return msgs
}

export function parseIntentJson(raw: string): ChatQuery {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('LLM 未返回 JSON')
  const parsed = JSON.parse(s.slice(start, end + 1))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('LLM 未返回 JSON 对象')
  const p = parsed as Record<string, unknown>
  const scopeRaw = p.scope
  let scope: ChatQuery['scope'] = null
  if (scopeRaw && typeof scopeRaw === 'object' && !Array.isArray(scopeRaw)) {
    const sc = scopeRaw as Record<string, unknown>
    const type = sc.type
    const range = typeof sc.range === 'string' ? sc.range : ''
    if ((type === 'day' || type === 'week' || type === 'month') && range) {
      scope = { type, range }
    }
  }
  const keywords = asStringArray(p.keywords) ?? []
  const categorySlugs = asStringArray(p.categorySlugs)
  return { scope, keywords, categorySlugs: categorySlugs?.length ? categorySlugs : undefined }
}

export function parseAnswerJson(raw: string): { answer: string; citedEntryIds: string[] } {
  let s = raw.trim()
  if (!s) throw new Error('LLM 响应为空（thinking 可能耗尽 max_tokens，试试增大或清空会话）')
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    // D39: 模型偶尔返纯文本无 JSON 包裹（thinking 模型带对话历史时尤甚——推理吃 token，
    // content 末尾 JSON 没写出来，或整段退化成散文）。不硬报错——把整段当 answer 返回，
    // 免「问答出了点问题」打断对话（citedEntryIds 丢失可接受，answer 文本仍在）。
    return { answer: s, citedEntryIds: [] }
  }
  // D37: thinking 模型可能因 max_tokens 不足被截断（content 末尾 JSON 不完整）。
  // 容忍：JSON.parse 失败时 best-effort 用正则抽 answer 字段，避免整轮作废报「问答出了点问题」。
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(s.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not object')
  } catch {
    const slice = s.slice(start)
    const ansMatch = slice.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (ansMatch) {
      const answer = ansMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
      return { answer, citedEntryIds: [] }
    }
    // 截断且抽不出 answer 字段：把首个 { 后的整段当裸 answer（比报错强）。
    return { answer: slice.replace(/^\s*\{\s*"?answer"?\s*:\s*"?/, '').replace(/"\s*,?\s*$/, '') || slice, citedEntryIds: [] }
  }
  const p = parsed as Record<string, unknown>
  const answer = typeof p.answer === 'string' ? p.answer : ''
  const citedEntryIds = asStringArray(p.citedEntryIds) ?? []
  return { answer, citedEntryIds }
}

// D29: 清洗 answer 正文里的内联引用「（见 <id>）」。LLM 常臆造短别名（如 e3）或错配 id，
// UI 拿非法 id 找不到条目 → 误显「已删除」（实未删）。validIds 外的引用段整段去掉（含前导
// 空白/标点），合法 id 保留交 UI 渲染。匹配全角括号（见…）与半角括号 (见…) 两种。
function sanitizeInlineCites(answer: string, validIds: Set<string>): string {
  // 同时匹配前导空白，剔掉非法引用后不留多余空格。合法引用原样保留。
  const re = /([ \t　]*[（(]\s*见\s+([a-zA-Z0-9_-]+)\s*[）)])/g
  return answer.replace(re, (full, _m, id: string) => (validIds.has(id) ? full : ''))
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
      const textMsgs = buildPrompt(content, toLocalIso(entry.createdAt), categories, tags, false, locationAddress)
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
  async parseChatIntent(question, nowIso) {
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
        messages: buildIntentPrompt(question, toLocalIso(nowIso)),
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
  async answerChat({ question, cites, conversation }) {
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
        messages: buildAnswerPrompt(question, cites, conversation),
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
