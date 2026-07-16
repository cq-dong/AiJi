import type { LlmPort } from '@/ports'
import type { Aggregate, AggregateScopeType, Category, Entry, EntryAi, Facets, Tag } from '@/domain/types'
import { di } from '@/app/di'

// LlmPort PWA 适配：DeepSeek（OpenAI 兼容 chat）BYOK。key/url/model 从 Settings(llmUrl/llmModel)
// + SecretStorePort('llm:key') 取——永不入源码。key 缺失 → throw，管线 catch 后条目标 failed
// （AI-only 降级，采集存储不伤）。涌现：LLM 标的新类别/标签在此落库（它有 label 信息）。

const SECRET_KEY = 'llm:key'

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
}

function entryText(entry: Entry): string {
  return entry.parts
    .map((p) => (p.type === 'text' ? p.content : p.transcript ?? ''))
    .filter(Boolean)
    .join('\n')
}

// createdAt 落库是 UTC（Z）；LLM 解析「明天下午3点」需用户本地时区信号——转成本地带偏移
// ISO（如 2026-07-16T09:30:00+08:00），与 prompt 示例格式一致，LLM 才输出对的偏移。
function toLocalIso(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const offStr = `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}${offStr}`
}

function buildPrompt(content: string, createdAt: string, categories: Category[], tags: Tag[]) {
  const catList = categories.map((c) => `${c.slug}:${c.label}`).join(', ') || '（暂无）'
  const tagList = tags.map((t) => t.slug).join(', ') || '（暂无）'
  const system = `你是「AiJi」(AI 记) 的笔记分类助手。给定一条用户的「记」条目内容 + 条目创建时间 + 现有类别库 + 现有标签库，输出严格 JSON。

铁律：
1. 类别由内容涌现——优先复用现有类别 slug；若都不贴切，创造一个新 slug（kebab-case，英文或拼音小写连字符）+ 中文 label。绝不硬编码固定类别集。
2. 标签同理，复用或新建，2-5 个，去重。
3. 情绪只是可选侧面——若内容明显带情绪，填 facets.mood（一个词）；绝不把情绪当主轴或必填。
4. titleSuggestion 一句话 ≤16 字；summary 一句话概述。
5. 时间型提醒意图：若正文含明确的提醒/待办时间意图（如「明天下午3点提醒我给设计稿反馈」「周五记得啃 STT」「下周一早上9点交周报」），解析出绝对时间并填 reminderSuggestion：dueAt 为绝对 ISO 8601 时间戳（含时区偏移），以条目创建时间为基准解析相对表达（"明天"=createdAt 次日、"下周一"=下一个周一等）；label 为 ≤12 字短摘要，用户后续可改。仅建议不调度——不创建任何 Reminder。无明确时间提醒意图时此字段必须省略，绝不臆造时间。

输出 JSON schema：
{"categorySlug":string,"categoryLabel"?:string,"tags":string[],"facets":{"mood"?:string,"person"?:string[],"place"?:string,"project"?:string,"event"?:string},"titleSuggestion"?:string,"summary"?:string,"reminderSuggestion"?:{"dueAt":string,"label":string}}

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

function parseJson(raw: string): ClassifyResult {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('LLM 未返回 JSON')
  return JSON.parse(s.slice(start, end + 1)) as ClassifyResult
}

interface AggregateResult {
  summary: string
  highlights?: string[]
}

// Build the aggregate prompt: given N entries (text + their AI summaries), ask
// the LLM to produce a period-level digest. few-shot one example.
function buildAggregatePrompt(
  entries: { id: string; text: string; aiSummary?: string }[],
  scope: AggregateScopeType,
) {
  const scopeLabel = scope === 'day' ? '日' : scope === 'week' ? '周' : '月'
  const system = `你是「AiJi」(AI 记) 的聚合摘要助手。给定一个${scopeLabel}内用户的若干条「记」条目（每条含原文与 AI 单条摘要），输出该${scopeLabel}的聚合摘要。

铁律：
1. 聚合摘要应覆盖该时段的主要主题与线索，2-4 句话，中文。
2. highlights 为 2-4 条该时段的关键亮点（每条 ≤16 字），反映最重要的内容/想法/进展。
3. 不要罗列每条条目，要提炼跨条目的共性与脉络。
4. 情绪只是可选侧面——若整体情绪明显可提，但不当主轴。

输出 JSON schema：
{"summary":string,"highlights":string[]}

只输出 JSON，不要 markdown 围栏、不要解释。`
  const example = `示例：
条目1：原文="把 CapturePort 抽成接口，PWA 和 Capacitor 各实现一个。" 摘要="抽 CapturePort 为接口，PWA/Capacitor 各实现"
条目2：原文="地铁里想到如果记一条东西能顺便变成提醒就好了。" 摘要="希望记录时能顺带生成提醒"
条目3：原文="读到一篇讲 second brain 的文章，核心是不要整理只要捕获。" 摘要="只捕获不整理，整理交给后端"
输出：{"summary":"本周以 AiJi 项目推进为主轴：抽象端口、涌现分类逐步成形；穿插阅读笔记（second brain）与地铁灵感（记录变提醒）。整体偏专注。","highlights":["CapturePort 接口化","记录变提醒","Second brain 阅读"]}`

  const items = entries
    .map((e, i) => `条目${i + 1}：原文="${e.text}"${e.aiSummary ? ` 摘要="${e.aiSummary}"` : ''}`)
    .join('\n')

  const user = `时段：${scopeLabel}
条目数：${entries.length}
${items}

输出 JSON。`
  return [
    { role: 'system', content: system + '\n\n' + example },
    { role: 'user', content: user },
  ]
}

function parseAggregateJson(raw: string): AggregateResult {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('LLM 未返回 JSON')
  return JSON.parse(s.slice(start, end + 1)) as AggregateResult
}

export const deepSeekLlm: LlmPort = {
  async classify(entryId) {
    const settings = await di.storage.getSettings()
    const entry = await di.storage.getEntry(entryId)
    if (!entry) throw new Error('entry not found: ' + entryId)
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    const content = entryText(entry)
    if (!content.trim()) throw new Error('条目无文本可分类')
    const categories = await di.storage.listCategories()
    const tags = await di.storage.listTags()
    // thinking 关闭：v4-flash/pro 默认走 reasoning_content（content 空），关掉后 JSON 直出 content，适配器才读得到。
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: buildPrompt(content, toLocalIso(entry.createdAt), categories, tags), max_tokens: 512, temperature: 0.3, thinking: { type: 'disabled' } }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') throw new Error('LLM 响应缺 content')
    const parsed = parseJson(raw)
    const now = new Date().toISOString()

    // 涌现：新标签落库（label=slug，用户后续可策展重命名）
    const tagSlugs = new Set(tags.map((t) => t.slug))
    for (const slug of parsed.tags ?? []) {
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

    const ai: EntryAi = {
      id: crypto.randomUUID(),
      entryId,
      version: 1,
      category: parsed.categorySlug,
      tags: parsed.tags ?? [],
      facets: parsed.facets ?? {},
      titleSuggestion: parsed.titleSuggestion,
      summary: parsed.summary,
      // B4: 仅 LLM 建议，不调度——用户在 TodoConfirm(B6) 确认后才建 Reminder
      reminderSuggestion: parsed.reminderSuggestion,
      modelUsed: model,
      createdAt: now,
    }
    return ai
  },
  async aggregate(entryIds: string[], scope: AggregateScopeType, range: string, id?: string) {
    const settings = await di.storage.getSettings()
    const apiKey = await di.secrets.get(SECRET_KEY)
    const url = settings.llmUrl
    const model = settings.llmModel || 'deepseek-v4-flash'
    if (!apiKey || !url) throw new Error('LLM BYOK 未配置（url/key 缺失）')
    if (entryIds.length === 0) throw new Error('无条目可聚合')

    // Pull entries + their AI summaries to feed the prompt.
    const entries = await Promise.all(
      entryIds.map(async (id) => {
        const entry = await di.storage.getEntry(id)
        if (!entry) return null
        const ai = await di.storage.getEntryAi(id)
        return { id, text: entryText(entry), aiSummary: ai?.summary }
      }),
    )
    const valid = entries.flatMap((e) => (e === null ? [] : [e]))
    if (valid.length === 0) throw new Error('条目无文本可聚合')

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildAggregatePrompt(valid, scope),
        max_tokens: 768,
        temperature: 0.4,
        thinking: { type: 'disabled' },
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

    const ag: Aggregate = {
      id: id ?? crypto.randomUUID(),
      scope: { type: scope, range },
      summary: parsed.summary,
      highlights: parsed.highlights,
      entryIds,
      modelUsed: model,
      createdAt: now,
      stale: false,
    }
    return ag
  },
}
