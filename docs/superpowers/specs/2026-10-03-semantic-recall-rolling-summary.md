# P-B 陪伴化：embedding 语义召回 + 滚动对话摘要（2026-10-03）

> 前置：P0（伙伴人格 + 每轮记忆提取）已落地。本文定稿 P1 的两件主干能力。
> 陪伴化四候选中的「记忆生命周期」（P-C）依赖本文的语义能力做相似记忆检测；
> 「主动触达」（P-D）依赖本文的摘要质量。

## 1. embedding 语义召回

### 现状问题
`localRecall`（chat/helpers.ts）纯关键词 substring 匹配。「我记过的那家咖啡店」类
模糊回忆（用户措辞 ≠ 条目措辞）命中不了——伙伴「记性」停留在字面检索。

### 决策（延续 P0 文档）
embedding 走**云端 API**，经现有 OpenAI 兼容通道。**BYOK 先行**：老服务端无
embed 端点且部署受阻（SSH），builtin 路径本期不做——能力缺席时静默降级为
纯关键词召回（现有行为逐字节保留）。

### Port：`LlmPort.embed`（可选方法）

```ts
embed?(texts: string[]): Promise<number[][] | null>
```

- 返回 `null` = 该链路不支持 embedding（builtin 不实现此方法 → `undefined`，
  调用方 `di.llm.embed?.(...) ?? null` 统一兜底）。抛错 = 调用失败（网络/key），
  调用方 catch 后同样降级关键词召回。**任何失败都不影响问答主流程。**
- BYOK（openAiCompatLlm）：POST `{baseUrl}/embeddings`，body `{model, input: texts}`。
  model 读 `settings.embeddingModel`（新可选字段，缺省 `'text-embedding-3-small'`；
  本期不做设置页 UI，字段为未来留口）。key/baseUrl 复用现有 BYOK 解析。
- llmProxy（di.ts）：proxy 上 embed 恒定义，builtin 分支直接返 null、byok 分支
  `openAiCompatLlm.embed?.() ?? null`——与「目标缺席则缺席」行为等价（调用方对
  undefined 与 null 同一兜底），实现取恒定义更简（accept-pb MINOR#4 措辞同步）。

### 存储：Dexie v10 新表 `embeddings`

```ts
// .stores() 非增量——全部 store 逐字重声明，仅追加 embeddings。
this.version(10).stores({ ...verbatim, embeddings: 'entryId, ownerId, updatedAt' })

interface EntryEmbedding {
  entryId: string        // 主键
  ownerId: string
  vector: number[]       // Float32 展开存 number[]
  model: string          // 生成时所用模型（换模型 → textHash 之外的第二重失效键）
  textHash: string       // 被嵌文本的 hash（条目文本变了 → 重嵌）
  updatedAt: string
}
```

被嵌文本（cap 800 字符）：`titleSuggestion/summary + tags.join(' ') + 正文/转写`。
`textHash` = 简单 FNV/djb2 hex（纯 TS 实现，不引依赖）。

### 计算时机（两处，均 fire-and-forget，失败静默）
1. **增量**：processEntry classify 成功后嵌该条目（STT/分类失败的条目不嵌）。
2. **惰性回填**：语义召回时发现无向量的 ready 条目 → 后台批量补嵌
   （每轮最多 20 条，避免首轮爆配额）；本轮只用已有向量作答，不等回填。

### 查询侧与混合排序
- 问句向量：每问 1 次 embed 调用；进程内 Map LRU(50) 缓存（同问免调）。
- 相似度：cosine。纯 TS 实现（向量维数 ~1536，条目数百级，主线程可承受）。
- 语义臂产出：sim ≥ 0.2 的 top-8。
- **合并**（store.sendMessage recall 段）：关键词 cites（localRecall，现有不动）在前，
  语义臂中**不在**关键词结果里的条目按 sim 降序**追加**在后，总 cites 上限 12。
  embed 不可用/失败 → 语义臂为空，行为与现状完全一致。
- answer prompt 零改动（cites 格式不变；ChatTrace.recalled 照旧记录合并后列表）。

### 配额/成本
BYOK 用户自担（embedding 单价极低）；builtin 无此路径、配额零影响。

## 2. 滚动对话摘要

### 现状问题
`chatHistory` 窗口 = 最近 6 条。更早的对话 LLM 完全不可见——长聊之后伙伴
「忘记」上文，与陪伴化的延续感直接冲突。

### 数据模型（conversations 表不加索引，无需升版）
`Conversation` 增加两个可选字段：
```ts
rollingSummary?: string   // 已被压缩的早期对话摘要
summarizedCount?: number  // messages 前缀已纳入摘要的条数
```
清空对话/新会话时两字段一并清空。messages 只增不改（杀进程恢复防御：
summarizedCount > messages.length 时按 0 处理并重算）。

### Port：`LlmPort.summarizeConversation`（必需方法，双适配器实现）

```ts
summarizeConversation(
  prior: string | null,
  chunk: { role: 'user' | 'assistant'; content: string; date?: string }[],
): Promise<string>
```

- prompt helper `buildConversationSummaryPrompt`（openAiCompatLlm，zh+en 单源）：
  「把以下对话片段压缩成一段第三人称摘要，保留事实/约定/进行中事项/用户透露的
  偏好与状态，丢弃寒暄；已有摘要作为上文并入，输出合并后的新摘要」。
  max_tokens ~300，temperature 0。
- BYOK：现有 chat completions 通道。builtin：POST /api/llm/chat（老服务端已支持），
  consume('llm', 1)。失败抛错由调用方吞掉（摘要失败不影响问答）。

### 触发与注入（store.sendMessage，答案落库后 fire-and-forget）
- 条件：`messages.length - (summarizedCount ?? 0) > 10`（积攒超 10 条未压缩）。
- 压缩区间：`[summarizedCount, messages.length - 6)`——**最近 6 条永远保持原文**
  （与 chatHistory 窗口同边界，摘要与原文不重叠）。
- 产出：`rollingSummary = await summarizeConversation(prior, chunk)`，
  `summarizedCount = messages.length - 6`，saveConversation 落库。
- **注入**：复用能力大补的 `extraSystem` 口子——store 拼
  `早前对话摘要：{rollingSummary}` 段（zh/en 各一模板，i18n key），与时间行/
  天气块/搜索块并列。answer prompt 本体零改动。
- 时序：本轮问答**不等**摘要（摘要为下一轮准备）；摘要轮次内并发消息用
  seq 守卫外的独立 try/catch，失败仅 console.warn。

## 3. 任务拆分（lead 契约 → 2 路并行）

**Lead 契约 commit**：ports/index.ts（embed?/summarizeConversation 签名 + 注释）、
domain/types.ts（Conversation.rollingSummary/summarizedCount、Settings.embeddingModel）、
db.ts v10（逐字重声明 + embeddings 表）、EntryEmbedding 类型、i18n key stub。
- **A（src/adapters/）**：openAiCompatLlm embed + buildConversationSummaryPrompt（zh+en）
  + summarizeConversation；builtinLlm summarizeConversation（embed 不实现）；
  di.ts llmProxy 透传。适配器测试（fetch mock）。
- **B（src/app/ + src/data/ + chat helpers）**：embedding 持久化 helpers（textHash/
  被嵌文本组装/读写）、语义臂+cosine+合并（纯函数模块 src/app/semanticRecall.ts）、
  sendMessage 集成（语义臂调用/降级/惰性回填/问句向量缓存）、processEntry 增量嵌、
  滚动摘要触发/区间/extraSystem 注入。store + 纯函数测试。
- **验收 agent**：静态审 + 浏览器联合测试（BYOK 真 key：模糊语义问句命中、
  长对话超 16 条后摘要生成、embed 失败降级无感）。

## 4. 测试要点（TDD）

embed fetch mock（成功/非 200→null 语义按实现定/异常→抛）；textHash 稳定性+
文本变更触发重嵌；cosine 正交/同向；合并去重保序（关键词在前语义在后，cap 12）；
embed 缺席/抛错 → 与现行为逐字节一致（防回归断言）；惰性回填批量上限 20；
摘要触发阈值（≤10 不触发/11 触发）、压缩区间不重叠最近 6 条、summarizedCount
推进、prior 并入、注入 extraSystem 文本、清空对话重置两字段；db v10 迁移
（v9 数据保留 + 新表可读写）。360 既有测试防回归。

## 5. Follow-ups（accept-pb 验收记录，2026-10-03）

- **每问全表扫描**（store.ts 语义臂段）：每问 listEmbeddings 全量 + ready 条目重算
  buildEmbeddingText/textHash，主线程 O(n)/问。百级无感，千级可能帧抖——优化方向
  textHash 落库或增量脏检查。（MINOR#2）
- **孤儿向量不级联**：删条目后 embeddings 行残留（查询按 entryIds 过滤，无正确性问题，
  仅空间累积）——删条目路径补 delete 或定期 GC。（MINOR#3）
- 已修：model 戳同源化（MINOR#1）、queryVectorCache 键并入模型（另注缝）。

## 6. 非目标

- 不做服务端 embed 端点（部署受阻，builtin 用户本期无语义臂）。
- 不做 embedding 设置页 UI（默认模型 + settings 字段留口）。
- 不动记忆系统（P-C 在其上做相似检测）。
- 不做流式摘要/增量 UI（摘要是后台行为，用户无感）。
