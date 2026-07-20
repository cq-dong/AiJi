// AI Chat · 本地检索层 (docs/design/ai-chat-impl-plan.md §2)。
// 纯函数，零 I/O：给定 LLM intent 轮解析出的 ChatQuery + store 内存里的 entries/aiByEntry/tags，
// 并集召回（结构化过滤 ∪ keywords substring）→ rankScore 排序 → top-8 压缩成 ChatCite。
// 压缩后的 cites 喂给 answer 轮 LLM；token 预算 top-8 × ≤120 字 excerpt ≈ 4K input。

import { scopeRange } from '@/domain/dateRange'
import type { ChatCite, ChatQuery, Entry, EntryAi, Tag } from '@/domain/types'

// 召回参数：宁可多召回喂给 LLM（token 便宜，效果优先）。top-15 × ≤240 字 excerpt ≈ 8K input，
// 对现代长上下文模型无压力。旧值 8×120 太省，常漏掉相关条目致 LLM 拒答。
export const RECALL_TOP_K = 15
const EXCERPT_MAX = 240

// 拼接条目所有可检索原文（text part 原文 + audio/video transcript）。供 excerpt + raw-text 匹配。
function entryText(entry: Entry): string {
  return entry.parts
    .map((p) => (p.type === 'text' ? p.content : p.transcript ?? ''))
    .filter(Boolean)
    .join('\n')
}

function toCite(entry: Entry, ai: EntryAi | undefined): ChatCite {
  const full = entryText(entry)
  const textExcerpt =
    full.length > EXCERPT_MAX ? full.slice(0, EXCERPT_MAX) + '…' : full
  const place = ai?.facets?.place?.trim() || entry.location?.address?.trim() || undefined
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    categorySlug: ai?.category ?? '',
    tags: ai?.tags ?? [],
    summary: ai?.summary,
    textExcerpt,
    place,
  }
}

// rankScore（plan §2 调整版）：per-keyword 取命中面最佳权重——summary(4) > tag(3) > raw(2)，
// 同一 keyword 不重复计分（旧版 summary 命中既 +4 又经 keyword 臂 +2 = +6 双计，泛词「想法」
// 误匹配大量条目 AI 摘要而盖过具体词「跑步」的 raw 命中）。category 命中 +3（过滤信号）+ 近期加成。
// 近期按天衰减（最新 +5，7天前 ≈0），仅 tie-breaker，不盖过相关性。
function scoreEntry(opts: {
  ai?: EntryAi
  keywords: string[]
  tagLabel: Map<string, string>
  entry: Entry
  categoryMatched: boolean
}): number {
  const { ai, keywords, tagLabel, entry, categoryMatched } = opts
  const summaryLower = ai?.summary?.toLowerCase() ?? ''
  const tagLower = (ai?.tags ?? []).flatMap((s) => [s, tagLabel.get(s) ?? '']).join(' ').toLowerCase()
  const rawLower = entry.parts
    .map((p) => (p.type === 'text' ? p.content : p.transcript ?? ''))
    .join(' ')
    .toLowerCase()
  // 地点/facets 检索面：location.address（reverse geocoded 文字地址）+ facets.place/person/project/event。
  // 不加这些面，问「上海」时 location 存着但召回搜不到 → cites 空 → LLM 答「库内未找到依据」。
  const facetLower = ai?.facets
    ? [ai.facets.place, ai.facets.project, ai.facets.event, ai.facets.mood, ...(ai.facets.person ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    : ''
  const locLower = entry.location?.address?.toLowerCase() ?? ''

  let kwScore = 0
  for (const k of keywords) {
    const inSummary = summaryLower.includes(k)
    const inTag = tagLower.includes(k)
    const inRaw = rawLower.includes(k)
    const inFacet = facetLower.includes(k)
    const inLoc = locLower.includes(k)
    // 命中面最佳权重：summary(4) > tag(3) > facet/loc(3) > raw(2)。
    kwScore += inSummary ? 4 : inTag ? 3 : inFacet ? 3 : inLoc ? 3 : inRaw ? 2 : 0
  }

  let score = kwScore
  if (categoryMatched) score += 3
  const ageDays = (Date.now() - new Date(entry.createdAt).getTime()) / 86_400_000
  score += Math.max(0, 5 - ageDays * 0.7)
  return score
}

// 并集召回：结构化臂（scope 时间 + categorySlugs）∪ keywords substring 臂（任一面命中即候选）。
// 空 query（scope=null + 无 keywords + 无 categorySlugs）→ 兜底返回近期 top-K，不空召回。
// 排序：score 降序，同分按 createdAt 降序（新者优先）。取 top-K 压缩成 ChatCite[]。
export function localRecall(
  query: ChatQuery,
  entries: Entry[],
  aiByEntry: Record<string, EntryAi>,
  tags: Tag[],
): ChatCite[] {
  const tagLabel = new Map(tags.map((t) => [t.slug, t.label]))
  const keywords = (query.keywords ?? [])
    .map((k) => k.toLowerCase())
    .filter(Boolean)
  const catFilter = query.categorySlugs?.length ? new Set(query.categorySlugs) : null
  const scope = query.scope
  const emptyQuery = !scope && !catFilter && keywords.length === 0

  // 空兜底：问句无任何可检索信号时，返回近期 top-K（answer 轮据此说「最近记了什么」）。
  if (emptyQuery) {
    const recent = [...entries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, RECALL_TOP_K)
    return recent.map((e) => toCite(e, aiByEntry[e.id]))
  }

  const candidates: Array<{ entry: Entry; ai?: EntryAi; score: number }> = []

  for (const entry of entries) {
    const ai = aiByEntry[entry.id]
    const aiCat = ai?.category ?? ''

    // 结构化臂：scope.range 与 entry.createdAt 的 scopeRange key 逐字比对（与 aggregate 落库同算法）。
    let structHit = false
    if (scope) {
      const eRange = scopeRange(scope.type, new Date(entry.createdAt))
      if (eRange === scope.range) {
        structHit = true
        if (catFilter && !catFilter.has(aiCat)) structHit = false
      }
    } else if (catFilter) {
      if (catFilter.has(aiCat)) structHit = true
    }

    // keyword 臂：任一 keyword 命中任一面（summary/tag/raw/facet/location）即候选。
    const summaryLower = ai?.summary?.toLowerCase() ?? ''
    const tagLower = (ai?.tags ?? []).flatMap((s) => [s, tagLabel.get(s) ?? '']).join(' ').toLowerCase()
    const rawLower = entry.parts
      .map((p) => (p.type === 'text' ? p.content : p.transcript ?? ''))
      .join(' ')
      .toLowerCase()
    const facetLower = ai?.facets
      ? [ai.facets.place, ai.facets.project, ai.facets.event, ai.facets.mood, ...(ai.facets.person ?? [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
      : ''
    const locLower = entry.location?.address?.toLowerCase() ?? ''
    let kwHits = 0
    for (const k of keywords) {
      if (
        summaryLower.includes(k) ||
        tagLower.includes(k) ||
        rawLower.includes(k) ||
        facetLower.includes(k) ||
        locLower.includes(k)
      ) {
        kwHits++
      }
    }

    const hit = structHit || kwHits > 0
    if (!hit) continue

    const score = scoreEntry({ ai, keywords, tagLabel, entry, categoryMatched: catFilter ? catFilter.has(aiCat) : false })

    candidates.push({ entry, ai, score })
  }

  // 兜底：intent 解析出 keywords 但全部 0 命中（如「上海」但地点存 location.address
  // 而该条恰好没被 keyword 臂命中，或词太偏）→ 不空召回，回落近期 top-K 喂给 LLM，
  // 让它自己判断相关性并诚实作答。空召回会让 store 直接裸答「未找到」，太死板。
  if (candidates.length === 0) {
    const recent = [...entries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, RECALL_TOP_K)
    return recent.map((e) => toCite(e, aiByEntry[e.id]))
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime(),
  )
  return candidates.slice(0, RECALL_TOP_K).map(({ entry, ai }) => toCite(entry, ai))
}
