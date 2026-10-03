// 语义召回纯函数模块（2026-10-03 P-B spec §1）：cosine 相似度 / 语义臂 top-K /
// 关键词+语义 cites 合并 / 问句向量进程内 LRU。零 I/O——embed 调用与向量存储
// 由调用方（store）注入/编排，本模块只做纯计算，便于单测。

// 语义臂参数（spec §1）：sim ≥ 0.2 取 top-8；合并后总 cites 上限 12。
export const SEMANTIC_SIM_THRESHOLD = 0.2
export const SEMANTIC_TOP_K = 8
export const MERGED_CITES_CAP = 12
// 默认 embedding 模型（与 openAiCompatLlm 适配器同默认值；settings.embeddingModel 留口）。
// store 给 EntryEmbedding.model 盖章用——换模型是 textHash 之外的第二重失效键。
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

// cosine 相似度。长度不等（换模型后新旧向量混存）→ 0，不参与召回。零向量 → 0。
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// 语义臂：全量向量算 cosine，sim ≥ 阈值取 top-K，按 sim 降序。
export function semanticArm(
  queryVector: number[],
  rows: { entryId: string; vector: number[] }[],
): { entryId: string; sim: number }[] {
  return rows
    .map((r) => ({ entryId: r.entryId, sim: cosine(queryVector, r.vector) }))
    .filter((x) => x.sim >= SEMANTIC_SIM_THRESHOLD)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, SEMANTIC_TOP_K)
}

// 合并（spec §1）：关键词 id 在前保序，语义臂中不在关键词结果里的按 sim 降序（调用方
// 已排好）追加在后，总长 ≤ cap。
export function mergeCites(
  keywordIds: string[],
  semantic: { entryId: string; sim: number }[],
  cap: number = MERGED_CITES_CAP,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of keywordIds) {
    if (out.length >= cap) break
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  for (const s of semantic) {
    if (out.length >= cap) break
    if (!seen.has(s.entryId)) {
      seen.add(s.entryId)
      out.push(s.entryId)
    }
  }
  return out
}

// 问句向量进程内 LRU(50)（spec §1：同问免调 embed）。进程内生命周期——刷新/杀进程即空，
// 可接受（embed 单价极低）。key = `${model}\n${问句归一化}`：问句归一化 trim+lowercase
// （同问不同大小写/首尾空格命中同槽）；**模型名入键**（accept-pb 修 2）——换 embeddingModel
// 后旧模型向量不得命中（维数/语义空间不同，跨模型比相似度是 garbage）。
const QUERY_VECTOR_CACHE_CAP = 50
const queryVectorMap = new Map<string, number[]>()

function cacheKey(model: string, question: string): string {
  return `${model}\n${question.trim().toLowerCase()}`
}

export const queryVectorCache = {
  get(model: string, question: string): number[] | undefined {
    const key = cacheKey(model, question)
    const v = queryVectorMap.get(key)
    // LRU 刷新：命中删再 set，提到最新位。
    if (v !== undefined) {
      queryVectorMap.delete(key)
      queryVectorMap.set(key, v)
    }
    return v
  },
  set(model: string, question: string, vector: number[]): void {
    const key = cacheKey(model, question)
    queryVectorMap.delete(key)
    queryVectorMap.set(key, vector)
    // 超帽逐最旧（Map 迭代序 = 插入序，第一个 key 即最久未用）。
    if (queryVectorMap.size > QUERY_VECTOR_CACHE_CAP) {
      const oldest = queryVectorMap.keys().next().value
      if (oldest !== undefined) queryVectorMap.delete(oldest)
    }
  },
  // 测试专用：清空缓存（模块级单例跨用例持久）。
  clear(): void {
    queryVectorMap.clear()
  },
}
