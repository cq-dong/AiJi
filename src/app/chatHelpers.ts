import type { ChatAnswer, ChatCite, ChatMessage, Conversation, Entry, EntryAi, EntryEmbedding } from '@/domain/types'
import { dateKey, toCite } from '@/ui/screens/chat/helpers'
import { semanticArm, mergeCites, queryVectorCache, DEFAULT_EMBEDDING_MODEL } from '@/app/semanticRecall'
import { buildEmbeddingText, textHash, listEmbeddings, saveEmbedding, deleteStaleEmbeddings } from '@/data/embeddings'
import { getCurrentOwner } from '@/app/currentOwner'
import { di } from './di'
import type { UiState } from '@/app/store'

// E2（2026-10-05 store 拆分一阶）：chat 辅助簇 + P-B 簇自 store.ts 逐字迁入，函数体零改动。
// 运行时依赖核实：仅 maybeRollSummary 碰 useUiStore（conversation 读 + setState）——经
// initChatHelpers 晚绑定注入（句柄沿用 useUiStore 命名保逐字一致）；withSemanticArm /
// backfillEmbeddings / embedEntryNow 只碰 di（di 不引 useUiStore，无环）。UiState 走
// import type（verbatimModuleSyntax 编译期抹除）→ 零运行时环。
type ChatHelpersStore = {
  getState: () => Pick<UiState, 'conversation'>
  setState: (partial: Pick<UiState, 'conversation'>) => void
}
// store.ts 在 create 完成后立即 initChatHelpers 注入。definite-assignment：
// init 先于任何调用（模块级无调用，sendMessage 链路才首次触发）。
let useUiStore!: ChatHelpersStore

export function initChatHelpers(store: ChatHelpersStore): void {
  useUiStore = store
}

// ── AI Chat · 纯读检索 (docs/design/ai-chat-impl-plan.md §4) ──────────────
// 多会话（2026-07-22）：无固定 id，新会话用 crypto.randomUUID()；chatList 缓存历史。
// answer 轮塞入的先前对话条数（滑动窗，token 预算——不全量塞历史）。
export const CHAT_HISTORY_WINDOW = 6

// 同会话同问题缓存（hash(question + entries 签名)）：entries 数量/最新 updatedAt 不变即复用上次
// answer，免两轮付费 LLM。内存态不持久——重载空，可接受。entries 变（新记/删/改）即失效。
export const chatAnswerCache = new Map<string, ChatAnswer>()

export function chatCacheKey(question: string, entries: Entry[]): string {
  const norm = question.trim().toLowerCase()
  const sig = entries.length + ':' + (entries[0]?.updatedAt ?? '')
  return `${norm}::${sig}`
}

// 到期时间短格式「M/D HH:MM」（与 reminders 屏 formatDueAt 同式）——建提醒回执文案用。
export function formatDueShort(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// conversation null → 新空会话（首次 sendMessage lazy-create，id=uuid）。
export function ensureConversation(c: Conversation | null): Conversation {
  return c ?? { id: crypto.randomUUID(), messages: [], updatedAt: new Date().toISOString() }
}

export function appendMessage(c: Conversation, m: ChatMessage): Conversation {
  return { ...c, messages: [...c.messages, m], updatedAt: m.createdAt }
}

// Finding 5 兜底（2026-09-29 rc9）：历史注入 prompt 带 [YYYY-MM-DD] 前缀，模型可能模仿该格式
// 把回答正文以 [日期] 开头（prompt 规则引导之外的第二道防线）。只 strip 开头一处——
// 正文中间的合法日期引用（如「[2026-09-29] 那天…」非开头）不动。
export function stripLeadingDatePrefix(text: string): string {
  return text.replace(/^\s*\[\d{4}-\d{2}-\d{2}\]\s*/, '')
}

// M2（2026-09-28 流式验收）：chatLoading 所有权序号。每次 sendMessage 递增并记录本轮 seq；
// 离开/切换会话（newConversation/loadConversation 异 id/deleteChatConversation 当前条）同样递增——
// 旧轮随即放弃 chatLoading 所有权：相位推入点（recall/answer）仅在 seq 最新时生效，
// finalize/早退路径 guard 失败时仅在自己仍是最新 seq 才复位 idle（防永久卡 'answer' 软锁输入框）。
let chatSendSeq = 0

// store.ts 读写面（let 绑定跨模块不可直接赋值）：nextChatSendSeq 等价原 ++chatSendSeq /
// 语句位 chatSendSeq++（返值弃用），currentChatSendSeq 等价原 seq === chatSendSeq 读。
export function nextChatSendSeq(): number {
  return ++chatSendSeq
}

export function currentChatSendSeq(): number {
  return chatSendSeq
}

// W0（2026-10-04）：saveMemory 串行化队列。旧实现 candidates 取 T0 快照后经 embed/裁决两次
// await 让出事件循环——两次并行 saveMemory（sendMessage 记忆提取 fire-and-forget 与
// MemorySheet 手动添加可并行）各持 T0 快照裁决，merge/replace 后写覆盖先写，记忆静默丢失。
// 模块级 promise 链：每次调用把整个函数体挂到链尾串行执行；链尾 catch 吞错（console.error）
// 防一次失败毒化后续所有排队任务。
let memoryQueue: Promise<unknown> = Promise.resolve()

// store.ts saveMemory 读写面（let 绑定跨模块不可直接赋值）：getMemoryQueue 等价原
// memoryQueue.then 读，setMemoryQueue 等价原 memoryQueue = task.catch(...) 续链写。
export function getMemoryQueue(): Promise<unknown> {
  return memoryQueue
}

export function setMemoryQueue(next: Promise<unknown>): void {
  memoryQueue = next
}

// M4：流式占位（streaming:true）是内存态语义——进程被杀后 Dexie 可能残留 streaming:true 的
// 尸体会话（空气泡+打字光标+压住 LoadingBubble）。读出时一律抹 false：内存态不信持久层。
export function stripStreamingFlags(conv: Conversation): Conversation {
  if (!conv.messages.some((m) => m.streaming)) return conv
  return { ...conv, messages: conv.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }
}

// 从 conversation 取最近 N 条 {role, content, date} 作 answer LLM 对话历史（不含当前问题——
// buildAnswerPrompt 把当前问题作为最后一轮 user 追加，故此处只给先前轮次）。跳过 error 消息。
// date（2026-09-29 能力大补）：每条历史的本地日键（YYYY-MM-DD），prompt 渲染 [日期] 前缀，
// LLM 可解析「昨天说的」等跨天指代。
export function chatHistory(conv: Conversation | null, limit: number): { role: 'user' | 'assistant'; content: string; date?: string }[] {
  if (!conv) return []
  return conv.messages
    .filter((m) => !m.error)
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content, date: dateKey(m.createdAt) }))
}

// ── P-B 语义召回（2026-10-03 spec §1）────────────────────────────────────
// 语义臂：embed 可用时按问句向量补召回——关键词 cites 在前保序，语义命中且未中关键词的
// 条目按 sim 降序追加（总长 ≤12，ChatTrace.recalled 照旧记录合并后列表，prompt 零改动）。
// embed 缺席/抛错/返 null → 原样返回关键词 cites（行为与纯关键词召回逐字节一致）。
export async function withSemanticArm(
  question: string,
  cites: ChatCite[],
  entries: Entry[],
  aiByEntry: Record<string, EntryAi>,
): Promise<ChatCite[]> {
  const embed = di.llm.embed
  if (!embed) return cites
  try {
    // model 与适配器同源（accept-pb 修 1）：读 di.storage.getSettings()（适配器 embed
    // 同读 Dexie settings），不用 uiStore 内存态——两侧失步会「戳≠实际模型」致重复重嵌。
    // 读失败回退缺省模型，不阻断召回。
    const settings = await di.storage.getSettings().catch(() => null)
    const model = settings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
    // 问句向量：进程内 LRU(50) 同问免调（键含模型名，换模型不串）；每问至多 1 次 embed 调用。
    let qv = queryVectorCache.get(model, question)
    if (!qv) {
      const vecs = await embed.call(di.llm, [question]).catch(() => null)
      qv = vecs?.[0] ?? undefined
      if (qv && qv.length > 0) queryVectorCache.set(model, question, qv)
    }
    if (!qv) return cites
    // 只召回当前条目集内的向量（回收站/已删条目的残留向量自然出局）。
    const entryIds = new Set(entries.map((e) => e.id))
    const allRows = await listEmbeddings()
    const rows = allRows.filter((r) => entryIds.has(r.entryId))
    // W0 惰性 GC（2026-10-04）：embeddings 表无 delete 挂点，条目已删/已清的向量行永久残留
    // ——召回过滤时顺带发现（allRows 比 rows 多即有残留），fire-and-forget 清掉。
    // 不阻塞召回主路径；失败静默（console.warn），下轮召回再试。
    if (allRows.length !== rows.length) {
      void deleteStaleEmbeddings(entryIds).catch((e) => console.warn('[store] stale embedding GC failed', e))
    }
    // 惰性回填：发现无向量/文本已变的 ready 条目 → 后台补嵌（每轮 ≤20），本轮不等。
    void backfillEmbeddings(rows, entries, aiByEntry, model)
    const sem = semanticArm(qv, rows)
    if (sem.length === 0) return cites
    const mergedIds = mergeCites(cites.map((c) => c.id), sem)
    const citeById = new Map(cites.map((c) => [c.id, c]))
    const entryById = new Map(entries.map((e) => [e.id, e]))
    const merged: ChatCite[] = []
    for (const id of mergedIds) {
      const hit = citeById.get(id)
      if (hit) {
        merged.push(hit)
        continue
      }
      // 语义臂新命中：复用 localRecall 同一压缩逻辑造 ChatCite（形状与关键词臂一致）。
      const e = entryById.get(id)
      if (e) merged.push(toCite(e, aiByEntry[e.id]))
    }
    return merged
  } catch (e) {
    console.warn('[store] semantic arm failed, fallback to keyword recall', e)
    return cites
  }
}

// 惰性回填（spec §1）：语义臂激活时，无向量或文本已变（textHash/model 不等）的 ready
// 条目 → fire-and-forget 批量补嵌，每轮最多 20 条（防首轮爆配额）。失败静默。
// model 由调用方（withSemanticArm）传入——与本轮 embed 实际用模同源，免二次 IDB 读。
async function backfillEmbeddings(
  existing: EntryEmbedding[],
  entries: Entry[],
  aiByEntry: Record<string, EntryAi>,
  model: string,
): Promise<void> {
  const embed = di.llm.embed
  if (!embed) return
  try {
    const byEntryId = new Map(existing.map((r) => [r.entryId, r]))
    const targets: { entry: Entry; text: string; hash: string }[] = []
    for (const entry of entries) {
      if (entry.status !== 'ready') continue // STT/分类失败的条目不嵌
      const text = buildEmbeddingText(entry, aiByEntry[entry.id])
      if (!text.trim()) continue
      const hash = textHash(text)
      const row = byEntryId.get(entry.id)
      if (row && row.textHash === hash && row.model === model) continue // 双键新鲜 → 跳过
      targets.push({ entry, text, hash })
      if (targets.length >= 20) break
    }
    if (targets.length === 0) return
    const vecs = await embed.call(di.llm, targets.map((x) => x.text)).catch(() => null)
    if (!vecs) return
    const now = new Date().toISOString()
    for (let i = 0; i < targets.length; i++) {
      const v = vecs[i]
      if (!v || v.length === 0) continue
      await saveEmbedding({
        entryId: targets[i].entry.id,
        ownerId: getCurrentOwner(),
        vector: v,
        model,
        textHash: targets[i].hash,
        updatedAt: now,
      })
    }
  } catch (e) {
    console.warn('[store] embedding backfill failed', e)
  }
}

// 增量嵌（spec §1）：processEntry classify 成功后 fire-and-forget 嵌该条目。
// embed 缺席/失败静默——绝不影响条目处理主流程。
export async function embedEntryNow(entry: Entry, ai: EntryAi): Promise<void> {
  const embed = di.llm.embed
  if (!embed) return
  try {
    const text = buildEmbeddingText(entry, ai)
    if (!text.trim()) return
    // model 与适配器同源（accept-pb 修 1）：读 Dexie settings，不用 uiStore 内存态。
    const settings = await di.storage.getSettings().catch(() => null)
    const model = settings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
    const vecs = await embed.call(di.llm, [text]).catch(() => null)
    const v = vecs?.[0]
    if (!v || v.length === 0) return
    await saveEmbedding({
      entryId: entry.id,
      ownerId: getCurrentOwner(),
      vector: v,
      model,
      textHash: textHash(text),
      updatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[store] embedEntry failed', e)
  }
}

// ── P-B 滚动对话摘要（2026-10-03 spec §2）────────────────────────────────
// 答案落库后 fire-and-forget：积攒 >10 条未压缩 → 把 [summarizedCount, len-6) 区间压进
// rollingSummary（最近 6 条永保原文，与 chatHistory 窗口同边界，摘要与原文不重叠）。
// 本轮问答不等摘要——摘要为下一轮准备。失败仅 console.warn，不影响问答。
export async function maybeRollSummary(conv: Conversation): Promise<void> {
  if (typeof di.llm.summarizeConversation !== 'function') return
  try {
    const total = conv.messages.length
    // 防御：summarizedCount 越界（杀进程恢复/历史脏数据）按 0 重算。
    let start = conv.summarizedCount ?? 0
    if (start < 0 || start > total) start = 0
    if (total - start <= 10) return
    const end = total - 6
    const chunk = conv.messages
      .slice(start, end)
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content, date: dateKey(m.createdAt) }))
    if (chunk.length === 0) return
    const summary = await di.llm.summarizeConversation(conv.rollingSummary ?? null, chunk)
    if (!summary) return
    // 竞态：await 期间用户可能已发新消息。以最新会话为底合并摘要字段——messages 只增
    // 不改，end 作为前缀位置仍合法（≤ 最新长度），不会盖住后到的消息。
    const cur = useUiStore.getState().conversation
    const base = cur?.id === conv.id ? cur : await di.storage.getConversation(conv.id)
    if (!base) return
    const next: Conversation = { ...base, rollingSummary: summary, summarizedCount: Math.min(end, base.messages.length) }
    if (cur?.id === conv.id) useUiStore.setState({ conversation: next })
    await di.storage.saveConversation(next)
  } catch (e) {
    console.warn('[store] rolling summary failed', e)
  }
}
