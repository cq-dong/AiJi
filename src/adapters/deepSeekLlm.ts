import type { LlmPort } from '@/ports'
import type { Category, Entry, EntryAi, Facets, Tag } from '@/domain/types'
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
}

function entryText(entry: Entry): string {
  return entry.parts
    .map((p) => (p.type === 'text' ? p.content : p.transcript ?? ''))
    .filter(Boolean)
    .join('\n')
}

function buildPrompt(content: string, categories: Category[], tags: Tag[]) {
  const catList = categories.map((c) => `${c.slug}:${c.label}`).join(', ') || '（暂无）'
  const tagList = tags.map((t) => t.slug).join(', ') || '（暂无）'
  const system = `你是「AiJi」(AI 记) 的笔记分类助手。给定一条用户的「记」条目内容 + 现有类别库 + 现有标签库，输出严格 JSON。

铁律：
1. 类别由内容涌现——优先复用现有类别 slug；若都不贴切，创造一个新 slug（kebab-case，英文或拼音小写连字符）+ 中文 label。绝不硬编码固定类别集。
2. 标签同理，复用或新建，2-5 个，去重。
3. 情绪只是可选侧面——若内容明显带情绪，填 facets.mood（一个词）；绝不把情绪当主轴或必填。
4. titleSuggestion 一句话 ≤16 字；summary 一句话概述。

输出 JSON schema：
{"categorySlug":string,"categoryLabel"?:string,"tags":string[],"facets":{"mood"?:string,"person"?:string[],"place"?:string,"project"?:string,"event"?:string},"titleSuggestion"?:string,"summary"?:string}

只输出 JSON，不要 markdown 围栏、不要解释。`
  const example = `示例：
内容："把 CapturePort 抽成接口，PWA 和 Capacitor 各实现一个，UI 层不动。"
现有类别：idea:想法, project:项目进展, life:生活片段
输出：{"categorySlug":"project","tags":["aiji","design"],"facets":{"project":"AiJi"},"titleSuggestion":"CapturePort 接口化","summary":"抽 CapturePort 为接口，PWA/Capacitor 各实现"}`
  const user = `现有类别：${catList}
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
      body: JSON.stringify({ model, messages: buildPrompt(content, categories, tags), max_tokens: 512, temperature: 0.3, thinking: { type: 'disabled' } }),
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
      modelUsed: model,
      createdAt: now,
    }
    return ai
  },
}
