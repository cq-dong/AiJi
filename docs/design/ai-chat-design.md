# AiJi · AI 对话与智能写操作 · 设计文档

> 版本：1.0 · 2026-07-17
> 状态：已定稿（4 项产品决策已拍板，见 §10）
> 依据：三方设计讨论（读侧 agent + 写侧 agent + 互相 critique + lead 综合第三视角），基于当前工作区真实代码

---

## 1. 背景与目标

### 1.1 需求

AiJi 的所有记录是一个本地库。用户提出两个能力：

1. **对话检索**：用自然语言向 AI 提问，AI 在本地库里找出相关条目并回答。
   - 例：「我上个月关于记忆外包的那个想法」「上周我提过哪些关于 STT 的事」
2. **智能写操作**：用户用自然语言指挥 AI 直接修改条目、标签或大类。
   - 例：「帮我把这条加个 #reading 标签」「把 idea 和 thoughts 两个类合并」「给上周末的几条补上摘要」

这两个能力是**同一个 chat 界面的读/写两面**，必须统一设计——接缝处（用户一句话既检索又改）是设计核心。

### 1.2 设计原则

- **本地优先**：库原件永不离开本地（IndexedDB+OPFS）；云端 LLM（BYOK）只拿到检索片段。
- **读写可观测分离**：LLM 只返回工具调用意图，执行权在 store 层；adapter 无副作用。
- **记忆不可篡改**：条目正文（entry.parts）是用户 ground truth，AI 永不写（§10 决策）。
- **权限按字段细分**：additive 操作可自动，覆盖型/自由字段操作需确认。
- **优雅降级**：BYOK 模型不支持 function calling 时，读侧照常工作，仅写操作禁用。
- **不造新轮子**：复用现有 store action（updateEntryAi/trashEntry/saveCategory 等）作为工具，复用 search/aggregate 的检索逻辑。

### 1.3 产品铁律对齐（CLAUDE.md §1）

- 类别涌现：AI 可新建类别（涌现合法），但合并/重命名/删除属「策展」必须用户确认。
- 情绪是可选侧面：AI 不强制采集 mood，chat 检索不把情绪当主轴。
- 异构条目：chat 检索覆盖所有条目类型（文本/音频/视频），不预设类别。

---

## 2. 总体架构

### 2.1 统一的 tool-use chat loop

```
用户消息 → store.sendMessage
  │
  ├─ 1. 本地预筛（零 LLM）：searchEntries + 时间/slug 过滤 → top-20 候选
  │
  ├─ 2. 第一轮 LLM：意图解析（chat.intent）
  │     输入：用户问句 + 候选 slug/facet 集合 + now
  │     输出：结构化 query {category, facets, tags, keywords, timeRange, limit}
  │
  ├─ 3. 结构化召回（本地）：query 过滤 entries → 排序 → top-K（默认 8，上限 12）
  │
  ├─ 4. 第二轮 LLM：回答 + 工具调用（chat.answer）
  │     输入：问句 + top-K 条目压缩（summary+title+excerpt）+ 对话历史 + tools 定义
  │     输出：{answer, citedEntryIds, toolCalls?}
  │
  ├─ 5. 若 toolCalls 非空 → tool-use loop：
  │     ├─ L2 工具 → gate 执行 + 审计 → tool_result 回喂 → 回到步骤 4
  │     └─ L3 工具 → 暂停 loop，插 inline 确认卡到对话流
  │           ├─ 用户确认 → gate 执行 → tool_result 回喂 → 步骤 4
  │           └─ 用户拒绝 → tool_result: denied → 步骤 4（LLM 自行调整）
  │
  ├─ 6. 渲染：answer 气泡 + 引用 chip（点 → /detail/:id）+ L2 review 卡 / L3 确认卡
  │
  └─ 7. 落库：conversation 持久化到 conversations 表
```

**L3 loop 中段挂起**：确认卡作为 inline 消息插入对话流（非 modal），loop 暂停等用户。这是读/写交织的关键态机。

### 2.2 LlmPort.chat 统一签名

```ts
// src/ports/index.ts
interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON Schema
  }
}

interface ToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
}

interface LlmPort {
  classify(entryId: string): Promise<EntryAi>
  aggregate(entryIds: string[], scope: AggregateScopeType, range: string, detailLevel?: number, id?: string): Promise<Aggregate>
  // 统一对话入口。三字段可同时有（LLM 边回答边调工具）。
  // intent: 单轮意图解析（第一轮）；answer: 带 tools 的回答（第二轮）。
  chat(opts: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    tools?: ToolDef[]
    intent?: boolean  // true=仅意图解析模式（无 tools，返结构化 query）
    model?: string
  }): Promise<{
    answer?: string
    citedEntryIds?: string[]
    toolCalls?: ToolCall[]
    intent?: { category?: string; facets?: Facets; tags?: string[]; keywords?: string[]; timeRange?: { from: string; to: string }; limit: number }
  }>
}
```

**关键约束**：adapter **只返回** toolCalls，**不执行**。tool-use loop 在 store 层。LlmPort.chat 对只读用户 observable 无副作用。

---

## 3. 读侧：对话检索

### 3.1 两轮 LLM 检索流程（§10 决策）

用户选择两轮 LLM（意图解析 → 结构化召回 → 回答），而非本地单轮。优势是语义理解更强（模糊指代如「那个关于记忆的事」LLM 能结合上下文判断映射到哪个 slug/facet）。

**延迟缓解**（写侧 critique 的核心反对是 4-6s 太慢）：
1. 意图解析用更小/更快模型（deepseek-v4-flash 而非 pro），单轮 <1s。
2. 意图解析结果缓存：同会话内相似问句不重复解析。
3. 第二轮 answer 走 SSE 流式，用户边等边看字出来。
4. 明确 loading 态：第一阶段「理解问题…」、第二阶段「检索库中…」，4-6s 不像卡死。

**降级路径**：若真机测延迟不可接受，意图解析层可替换为本地正则（架构兼容，§3.2 的召回逻辑不变）。

### 3.2 意图解析 prompt（第一轮）

```ts
function buildIntentPrompt(question: string, nowLocalIso: string, categories: Category[], tags: Tag[]) {
  const system = `你是「AiJi」的检索意图解析器。把用户的自然语言问题解析成结构化检索 query。
铁律：
1. category/tags 优先复用现有 slug（给出列表），不贴切则省略该字段——绝不臆造 slug。
2. facets 仅在问题明确提及（如"在地铁里""关于 AiJi 项目""开心的"）时填，否则省略。
3. keywords 是用于全文 substring 命中的词（去虚词），1-3 个，保留用户原词。
4. timeRange：相对表达（"上个月""上周"）以 now 为锚解析成 {from,to} ISO（含时区偏移）。无时间意图则省略。
5. limit 默认 8，问"全部/所有"时给 20。
输出 JSON schema：
{"category"?:string,"tags"?:string[],"facets"?:Facets,"keywords"?:string[],"timeRange"?:{"from":string,"to":string},"limit":number}
只输出 JSON，不要 markdown 围栏、不要解释。`
  const example = `示例：
问题："我上个月关于记忆外包的那个想法"
now：2026-07-17T10:00:00+08:00
现有类别：idea,project,life,reading,errand
输出：{"keywords":["记忆外包"],"timeRange":{"from":"2026-06-01T00:00:00+08:00","to":"2026-06-30T23:59:59+08:00"},"limit":8}`
  return [
    { role: 'system', content: system + '\n\n' + example },
    { role: 'user', content: `问题：${question}\nnow：${nowLocalIso}\n现有类别：${categories.map(c => c.slug).join(',')}\n现有标签：${tags.map(t => t.slug).join(',')}\n输出 JSON。` },
  ]
}
```

### 3.3 召回与排序

```
召回 = (结构化过滤命中) ∪ (keywords 对 summary/title/原文 substring)
       ★ 并集防漏——facets 稀疏（9 条 AI 里 3 空），keywords 是主路径非回退

排序 score = summary命中*4 + category命中*3 + tag命中*3 + keyword命中*2 + 近期加成
             ★ boost summary 而非 facets（summary 9/9 稠密，facets 稀疏、project 全库仅 1 值）

top-K：默认 8，上限 12
```

**复用现有**：`search/helpers.ts` 的 `searchEntries`（本地 substring）、`summary/aggregate.ts` 的 `scopeRange`/`shiftRef`（时间解析）。

### 3.4 防幻觉（四层）

1. **prompt 铁律**：citedEntryIds 必须来自传入 id。
2. **后校验**：`citedEntryIds.every(id => passedIds.has(id))`，剔非法 id。
3. **空引用拒绝裸答**：post-validation 后 citedEntryIds 为空且问题指向库内容（非寒暄）→ 强制输出「库内未找到依据」或不答。绝不无引用裸答。
4. **right-id-wrong-claim 防御**：引真实条目但说错内容，后校验抓不到 → UI 把每条 cited id 映射到 verbatim 片段（Perplexity 式），用户肉眼对齐。

### 3.5 条目压缩与 token 预算

- 喂 LLM 时每条压缩为 `{id, createdAt, category, tags, summary, textExcerpt(≤120字)}`。
- 默认传 summary+title 稠密字段；cited chip 点开才按需取原文（省 token）。
- token 预算 ~4K input（top-8 × ~500 字）。
- **context 窗口**：12 seed ok；500 条 × 500 字 ≈ 60K token 撑爆 DeepSeek 64K → 历史用滑动窗 + 历史摘要，不全量塞。

### 3.6 离线降级

chat 无降级（不像 capture 有 WebSpeech、search 有本地 substring）。**/chat 离线禁用 + 明确提示**「对话需要联网」。复用 store.online flag。

### 3.7 检索缓存

同会话同问题不重调 LLM：`hash(question + entries-version)` memo。entries 变化（新存/改/删）则缓存失效。

---

## 4. 写侧：AI 改数据

### 4.1 权限按字段细分（核心设计）

权限**按 field 类型细分**，不按 action 粗分。这是读侧 critique 的红线——`updateEntryAi` 整体 L2 不可接受，因为覆盖已有 category 比加标签危险得多。

| 操作 | field 类型 | 档 | 确认机制 |
|------|-----------|-----|---------|
| 加标签（additive） | 受控词表 | **L2** | 自动 + review 卡 |
| 新建类别（涌现） | 受控 | **L2** | 自动 + review 卡 |
| 改标题/摘要 | 自由文本，非正文 | **L2** | 自动 + review 卡 |
| 改已有 category（覆盖用户策展） | 受控，覆盖 | **L3** | inline 确认 + diff |
| 改 facets（自由形式无校验） | 自由 | **L3** | inline 确认 + diff |
| 合并类别（改多条归属） | 策展 | **L3** | inline 确认 + 全量 diff |
| 重命名类别 | 策展 | **L3** | inline 确认 |
| 重命名标签（只改 label 不动归属） | 整理 | **L2** | 自动 + review 卡 |
| 合并标签（改多条归属） | 策展 | **L3** | inline 确认 |
| trashEntry（软删） | 破坏性可逆 | **L3** | inline 确认 + reason |
| deleteEntry（硬删） | — | **🚫 AI 永禁** | gate 直接拒绝 |
| 改 entry.parts 正文 | 篡改记忆 | **🚫 MVP 全禁** | 只走手动 PartsEditSheet（§10 决策） |

### 4.2 安全网

1. **删必走 trashEntry**（软删 30 天可恢复）。deleteEntry 在 gate 直接拒绝。
2. **改 EntryAi 必走 updateEntryAi**（version+1），**绝不走 classify**——D1（classify 硬编码 version:1）会让 AI 编辑被新 classify 结果 shadow。
3. **审计日志**：新 `aiActions` 表（db v6），记 `{id, ts, tool, tier, args, before, after, undone?}`，可撤销。
4. **撤销诚实边界**：undo 前检查每条受影响 entry 的 `aiByEntry[id].version` 是否仍 == 快照版本；任一发散则拒绝自动撤销 + 给诚实提示。不承诺「7 天都能撤」。
5. **aggregate 联动**：AI 改 category/tags 后，镜像 processEntry（store.ts:427-434）置当日/周/月 aggregate stale，让读侧 cited snippet 不静默过期。
6. **并发 CAS**：saveEntryAi 带 expectedVersion，mismatch 拒绝重试。防用户 AiEditSheet 和 AI 同时写 last-write-wins 丢一方。

### 4.3 L2 review 卡（取代 5 秒 toast）

L2 不用 5 秒 toast（对话里看不见）。改**会话级 review 缓冲卡**：折叠「AI 改了 N 条」可展开，常驻到离开 /chat 或显式关闭。撤销窗 = 卡存活期，不是定时器。

### 4.4 批量操作

- 硬上限 20 条/turn（tool schema `maxItems: 20`）。
- L2 批量自动执行，review 卡显「已整理 N 条」+「撤销全部」。
- L3 批量不自动，inline 确认卡列全量 diff（虚拟列表，折叠 >5）。
- 超 20 条 LLM 须分批或拒绝。

### 4.5 function calling 降级（写侧红线）

DeepSeek 原生 tools。BYOK endpoint 无 function-calling 时：
- **读侧（answer + citations）必须照常工作**。
- 仅写操作拒绝 + 清晰 UI 提示「当前模型不支持 AI 改数据，可手动编辑」。
- 绝不因 tools 不支持让 chat 整个废掉。

降级实现：探测 `data.choices[0].message.tool_calls` 缺失 → prompt 要求输出 `{"reply":"...","actions":[{"tool":"...","args":{}}]}` JSON，store 解析。两路汇入同一 `ToolCall[]`。

### 4.6 Tool schema 草稿（3 个典型）

```jsonc
// L2 · 自动执行（additive）
{
  "type": "function",
  "function": {
    "name": "add_tag",
    "description": "给条目加标签（additive，不覆盖已有标签）。可逆，自动执行。",
    "parameters": {
      "type": "object",
      "required": ["entryId", "tag"],
      "properties": {
        "entryId": { "type": "string" },
        "tag": { "type": "string", "description": "tag slug，须为已有或新建" }
      }
    }
  }
}

// L3 · 需确认+diff（覆盖型）
{
  "type": "function",
  "function": {
    "name": "change_category",
    "description": "修改条目类别（覆盖已有分类）。需用户确认。",
    "parameters": {
      "type": "object",
      "required": ["entryId", "newCategory"],
      "properties": {
        "entryId": { "type": "string" },
        "newCategory": { "type": "string", "description": "目标 category slug" },
        "reason": { "type": "string" }
      }
    }
  }
}

// L3 · 策展（改多条归属）
{
  "type": "function",
  "function": {
    "name": "merge_categories",
    "description": "合并类别：from 下所有条目重映射到 to，删除 from。需确认。",
    "parameters": {
      "type": "object",
      "required": ["fromSlug", "toSlug"],
      "properties": {
        "fromSlug": { "type": "string" },
        "toSlug": { "type": "string" }
      }
    }
  }
}
```

### 4.7 Tool 执行 gate

```ts
// src/app/aiTools.ts —— 唯一允许 AI 触发写 action 的入口
async function executeAiTool(call: ToolCall): Promise<ToolResult> {
  const before = await snapshot(call)  // 审计前态
  let result
  switch (call.tool) {
    case 'trash_entry':
      await useUiStore.getState().trashEntry(call.args.entryId as string)  // 软删
      break
    case 'add_tag':
    case 'change_category':
      await useUiStore.getState().updateEntryAi(call.args.entryId as string, buildPatch(call))  // version+1
      break
    case 'delete_entry':
      throw new Error('AI 无权硬删；使用 trash_entry')  // 🚫 永禁
    case 'update_entry_parts':
      throw new Error('AI 无权改正文；请手动编辑')  // 🚫 MVP 全禁
    default: /* ... */
  }
  const after = await snapshot(call)
  await auditLog({ tool: call.tool, args: call.args, before, after, ts: new Date().toISOString() })
  // aggregate 联动：置当日/周/月 stale
  await markAggregatesStale(call)
  return result
}
```

---

## 5. 数据模型变更（db v6）

### 5.1 新表

```ts
// db.ts version(6).stores(...) 全量重声明 + 两新表
this.version(6).stores({
  entries: 'id, createdAt, updatedAt, status, deletedAt',
  entryAi: 'id, entryId, version',
  categories: 'slug, usageCount',
  tags: 'slug, usageCount',
  aggregates: 'id, scope.type, scope.range, stale',
  settings: '++id',
  reminders: 'id, dueAt, status, entryId',
  drafts: 'id, updatedAt',
  conversations: 'id, updatedAt',     // ← 新：对话历史
  aiActions: 'id, ts, tool, undone',  // ← 新：AI 写操作审计
})
```

### 5.2 新类型

```ts
// src/domain/types.ts
interface Conversation {
  id: string
  title: string
  messages: {
    role: 'user' | 'assistant'
    content: string
    citedEntryIds?: string[]
    toolCalls?: ToolCall[]     // 该轮 AI 调用的工具（审计/回放用）
    createdAt: string
  }[]
  createdAt: string
  updatedAt: string
}

interface AiAction {
  id: string
  ts: string
  tool: string
  tier: 'L2' | 'L3'
  args: unknown
  before: unknown       // 快照前态（undo 用）
  after: unknown
  undone?: boolean
  undoneAt?: string
}
```

### 5.3 StoragePort 新增方法

```ts
// 对话
listConversations(): Promise<Conversation[]>
saveConversation(c: Conversation): Promise<void>
deleteConversation(id: string): Promise<void>
// 审计
saveAiAction(a: AiAction): Promise<void>
listAiActions(): Promise<AiAction[]>
undoAiAction(id: string): Promise<void>
```

### 5.4 SecretStorePort 加 delete（修 D8）

```ts
interface SecretStorePort {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>  // ← 新
}
```

### 5.5 对话持久化策略（§10 决策）

- **存**到 conversations 表（AiJi 是「记」的工具，对话历史有价值）。
- **不入 entries 流**（防 classify 把对话当条目分类污染）。
- **独立索引预留**：conversations 表自己可被检索（「搜我问过 STT 的对话」），MVP 不做但 schema 已留 `updatedAt` 索引。
- **清理**：会话级手动删除，MVP 不自动 TTL。

---

## 6. UI 设计（/chat 屏）

### 6.1 布局

- **BareLayout**（沉浸，仿 /detail），顶部返回 + 「问 AI」标题。
- **入口**：home 顶部搜索图标旁加「问 AI」按钮（§10 决策）。
- 输入栏贴底，发消息时 Spinner。

### 6.2 气泡与引用

- 用户气泡右 `bg-pri text-white`，AI 气泡左 `bg-card`。
- AI 气泡下方渲染引用 chip 行：`<Chip tone="project">记忆外包 · 7/14</Chip>` 点 → `navigate(/detail/:id)`。
- 引用 chip 可展开 verbatim 片段（防 right-id-wrong-claim，§3.4）。
- 顶部复用 AiPanel 的「上送云端」chip 作隐私标识；首次进 /chat inline 说明「问答会把相关条目发到你配置的 LLM」。

### 6.3 L2 review 卡

底部常驻折叠卡：`rounded-fab bg-priS`，文案「AI 已整理 N 条」+「展开」+「撤销全部」。展开列每条改动（entryId + field + before→after）。常驻到离开 /chat 或显式关闭。

### 6.4 L3 确认卡

inline 消息（非全屏 modal），复用 TodoConfirm 风格：

```tsx
<div className="rounded-card border border-catFail/30 bg-catFail/5 p-3">
  <p className="text-[12px] font-bold text-catFail">AI 请求删除 · {count} 条</p>
  <DiffPreview items={diffItems} />   {/* 折叠>5，虚拟列表 */}
  <p className="text-[11px] text-t2">{reason}</p>
  <div className="flex gap-2">
    <Button variant="secondary" size="sm" onClick={onCancel}>拒绝</Button>
    <Button variant="primary" size="sm" className="bg-catFail" onClick={onConfirm}>确认</Button>
  </div>
</div>
```

**diff 预览**：类别/标签用「A → B」chip 对比；摘要/标题用 strikethrough→new。正文 diff 框架预留（MVP 禁改正文，但 DiffPreview 组件支持）。

### 6.5 离线态

online=false 时禁用输入栏 + 提示「对话需要联网」。

### 6.6 无 function calling 降级态

模型不支持 tools 时，写操作按钮置灰 + 提示「当前模型不支持 AI 改数据，可手动编辑」；读侧问答照常。

---

## 7. 向量嵌入演进（远期，非 MVP）

MVP 不上 embedding，§3 的两轮 LLM + summary boost 已够。远期演进时：

- **独立 `EmbedPort` + `entryEmbeddings` 侧表**，不在 EntryAi 上加字段（隔离 schema 迁移）。
- **跨 provider 维度不兼容**（OpenAI 1536 vs BGE 768）→ 换模型需重嵌全库，明示成本。
- **DeepSeek 无 embed endpoint**（2026-07 仍 chat-only）→ BYOK 指 DeepSeek 则无 embed，需另配 embed provider。
- **本地 transformers.js** iOS Safari WASM 慢 + 内存压（同 CLAUDE.md §10 A1/A2）→ 演进前先验。
- AI 改 EntryAi 后 embedding 过期，re-embed 成本需算。

演进路径与 §3 检索兼容：有 embedding 走余弦召回，无则降级到 keywords（与 facets 回退同构）。

---

## 8. 前置依赖：必须先修的现有 bug

做 chat 前必须修这 5 个 bug（独立 PR，不依赖 chat）：

| bug | 位置 | 为何阻塞 chat |
|-----|------|--------------|
| **D1** | deepSeekLlm.ts:210 `version:1` 硬编码 | AI 经 updateEntryAi 写 v2 后，reprocess 的 classify 落 v1 shadow |
| **D11** | store.ts:416 processEntry 覆盖 state | AI 整理后用户点「重新分类」冲掉 AI 编辑 |
| **D8** | store.ts:367,374 清 key 不删 secret | 用户撤 AI 权限实则 secret 还在 |
| **D2** | dexieStorage.ts:99 getSettings 不合并 defaults | chat 新增 Settings 字段读不到 |
| **D7** | store.ts:264 saveEntry fire-and-forget | chat 检索依赖 entry 已落库 |

---

## 9. 落地步骤

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 0 | 修 D1/D11/D8/D2/D7（独立 PR） | — |
| 1 | Domain/Port：types 加 Conversation/AiAction/ToolDef/ToolCall；LlmPort 加 chat；StoragePort 加对话/审计方法；SecretStorePort 加 delete | 0 |
| 2 | DB v6：conversations + aiActions 表 | 1 |
| 3 | Adapter：deepSeekLlm 加 chat（intent 模式 + answer 模式，原生 tools 优先、JSON 降级），复用 parseJson | 1 |
| 4 | 本地检索层：src/ui/screens/chat/helpers.ts，复用 search/helpers.ts + aggregate.ts | 1 |
| 5 | Tool 层：src/app/aiTools.ts，tool schema + executeAiTool gate（tier 校验 + 审计 + undo 快照 + CAS + aggregate stale 联动） | 1,2 |
| 6 | Store：sendMessage action（loop 编排）+ 补 saveTag/mergeCategories/renameTag 策展 action | 3,5 |
| 7 | UI：src/ui/screens/chat/{index.tsx, helpers.tsx}（仅该目录，共享树防撞）+ AiToolToast/AiConfirmCard/DiffPreview 组件 | 6 |
| 8 | Router：BareLayout 段加 `<Route path="chat">` + lazy import（仿 /drafts /trash 已注册模式） | 7 |
| 9 | Home 顶栏：搜索图标旁加「问 AI」入口 | 8 |
| 10 | Settings：加「AI 操作记录」屏（查审计 + 撤销） | 5 |

---

## 10. 产品决策（已拍板，2026-07-17）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| AI 改条目正文（entry.parts） | **MVP 全禁** | 条目正文=用户记忆，AI 改正文=篡改记忆；校对意图 LLM 自判不可靠。改正文只走手动 PartsEditSheet |
| 对话历史持久化 | **存，独立索引预留** | AiJi 是「记」的工具，对话历史有价值；不入 entries 流防 classify 污染；表内独立索引预留「搜对话」 |
| /chat 入口 | **顶栏入口** | home 顶部搜索图标旁加「问 AI」；BareLayout 沉浸，不占底栏位 |
| 检索起步方案 | **LLM 意图解析两轮** | 语义理解更强（模糊指代 LLM 能结合上下文）；附延迟缓解（小模型+流式+缓存+loading 态）；架构兼容可降级为本地单轮 |

### 关于「两轮 LLM」的延迟权衡

写侧 critique 核心反对：DeepSeek 1-3s/call，两轮 4-6s 对聊天 UX 致命。缓解措施见 §3.1。若真机测延迟不可接受，意图解析层可替换为本地正则（架构兼容，召回逻辑不变），建议 MVP 先上两轮、真机验证后决定是否降级。

---

## 11. 风险与开放问题

| 风险 | 影响 | 缓解 |
|------|------|------|
| 两轮 LLM 延迟 4-6s | 聊天 UX 卡 | §3.1 缓解；可降级本地单轮 |
| DeepSeek 无 embed endpoint | 远期语义检索受限 | §7 独立 EmbedPort，另配 provider |
| L2 幻觉误改分类用户不察觉 | 数据污染 | review 卡常驻 + 撤销；覆盖型升 L3 |
| tool-use loop 中段挂起态机复杂 | 实现难度 | inline 确认卡 + tool_result denied 回喂 |
| BYOK 模型不支持 function calling | 写操作废 | 读侧照常 + 写禁用提示（§4.5） |
| context 窗口爆炸（500 条） | 回答截断 | 滑动窗 + 历史摘要 + 条目压缩（§3.5） |
| 对话存储无界增长 | 存储膨胀 | MVP 手动删除，远期 TTL |

---

## 附录 A：关键文件路径

- LlmPort 现签名：`src/ports/index.ts:84-97`
- prompt/parseJson 模式仿写：`src/adapters/deepSeekLlm.ts`
- 本地检索复用：`src/ui/screens/search/helpers.ts:199-232`（searchEntries）、`src/ui/screens/summary/aggregate.ts`（scopeRange/shiftRef）
- 写 action 源：`src/app/store.ts`（updateEntryAi:604 / updateEntry:596 / trashEntry:330 / deleteCategory:566 / deleteEntry:579）
- 版本 bug：`src/adapters/deepSeekLlm.ts:210`（D1）、`src/app/store.ts:416`（D11）
- 手动编辑 UI 模式：`src/ui/screens/detail/index.tsx`（AiEditSheet / ConfirmDeleteDialog / TodoConfirm）
- DB schema：`src/data/db.ts`（v5 末尾接 v6）
- Router 已注册 /drafts /trash 模式：`src/app/router.tsx:15-16,42-43`


---

## 12. 实现详解：AI 改标签的端到端链路

以「用户对 AI 说：给这条加个 reading 标签」（条目 e2，当前 `EntryAi.tags=['aiji','design']` version 1）为例，走完 LLM → 后端 → 前端三层。

### 12.1 第一层：LLM 返回工具意图（不执行）

第二轮 `chat.answer` 收到用户问句 + 候选条目（含 e2）+ `add_tag` tool 定义。LLM 返回：

```json
{
  "answer": "好的，已为「CapturePort 接口化」加上 reading 标签。",
  "citedEntryIds": ["e2"],
  "toolCalls": [{ "id": "call_1", "tool": "add_tag", "args": { "entryId": "e2", "tag": "reading" } }]
}
```

**adapter 只返回这个对象，不碰数据库**。执行权在 store 层 gate。

### 12.2 第二层：后端同步记录（三层落库）

`add_tag` 是 L2（additive），gate 自动执行。**关键：标签存在两处**——`EntryAi.tags`（条目标签数组）和 `tags` 表（标签库 + usageCount）。现有 `updateEntryAi` 只改前者，AI 改标签需要专门 action 同步两者 + 审计 + aggregate。

```ts
// src/app/store.ts 新增 addTag action（不直接复用 updateEntryAi，因要同步 tags 表）
addTag: async (entryId, tag) => {
  const cur = get().aiByEntry[entryId] ?? (await di.storage.getEntryAi(entryId))
  if (!cur) return
  if (cur.tags.includes(tag)) return  // 幂等：已有则不动

  // ── 1. 改 EntryAi.tags（version+1，走 updateEntryAi 同款路径）
  const next: EntryAi = { ...cur, tags: [...cur.tags, tag], version: cur.version + 1, createdAt: new Date().toISOString() }
  await di.storage.saveEntryAi(next)  // Dexie entryAi 表 put，version 2

  // ── 2. 标签库同步（tags 表）—— 现有 updateEntryAi 不做这步！
  const existing = get().tags.find((t) => t.slug === tag)
  if (existing) {
    // 已有标签：usageCount+1（修 D6：usageCount 永不递增）
    const updated = { ...existing, usageCount: existing.usageCount + 1 }
    await di.storage.saveTag(updated)
  } else {
    // 新标签：涌现落库（label=slug，用户后续可策展重命名）
    await di.storage.saveTag({ slug: tag, label: tag, usageCount: 1, createdAt: new Date().toISOString() })
  }

  // ── 3. aggregate 联动（防 cited snippet 过期）
  await markAggregatesStale(entryId)  // 置当日/周/月 aggregate.stale=true

  // ── 4. 前端 state 同步（见 12.3）
  const tags = await di.storage.listTags()
  set((s) => ({
    aiByEntry: { ...s.aiByEntry, [entryId]: next },
    tags,
  }))
}
```

gate 层包审计：

```ts
// src/app/aiTools.ts
case 'add_tag':
  const before = { ai: await di.storage.getEntryAi(args.entryId), tagInLib: (await di.storage.listTags()).some(t=>t.slug===args.tag) }
  await useUiStore.getState().addTag(args.entryId, args.tag)  // 上面的 action
  const after = { ai: await di.storage.getEntryAi(args.entryId) }
  await di.storage.saveAiAction({ id: uuid(), ts: now, tool:'add_tag', tier:'L2', args, before, after })
  // tool_result 回喂 LLM 继续对话
```

**落库后 Dexie 状态**：
- `entryAi` 表：e2 的 EntryAi 新增一行 version 2，tags=`['aiji','design','reading']`
- `tags` 表：`reading` 行 usageCount 从 5→6（或新建 usageCount=1）
- `aggregates` 表：当日/周/月行 stale=true
- `aiActions` 表：新增审计记录

### 12.3 第三层：前端同步变化

`set` 更新 Zustand 内存状态，React 订阅自动重渲染：

```ts
set((s) => ({
  aiByEntry: { ...s.aiByEntry, 'e2': next },  // version 2, tags 多了 reading
  tags,                                        // 标签库更新（usageCount+1 或新标签）
}))
```

订阅 `useUiStore((s)=>s.aiByEntry['e2'])` 的组件自动重渲染：
- **detail 屏** AiPanel 标签行立即显示 `#reading`
- **categories 屏** 标签列表 reading 的计数立即 +1（或新出现）
- **summary 屏** 当日卡显示「已过期」需重算（aggregate.stale）
- **/chat 屏** L2 review 卡显示「已整理 1 条：e2 +reading」+ 撤销

### 12.4 并发陷阱：processEntry 会覆盖 AI 编辑（D11 变体，未修）

**这是最关键的坑**。如果 AI 加标签时条目 e2 的 `processEntry` 还在跑（比如刚保存还没分类完），会发生：

```
时间线：
t1  AI addTag → saveEntryAi(version 2, tags:['aiji','design','reading'])
t2  processEntry.classify → ai(version 1, tags:['aiji','design'])  ← classify 硬编码 version:1（D1 未修）
t3  processEntry: set aiByEntry['e2'] = ai  ← store.ts:418 直接覆盖 state，没比 version！
    → 用户看到标签变回 ['aiji','design']，reading 没了
```

**Dexie 层是对的**：`getEntryAi`（dexieStorage.ts:62）reduce 取 max version，下次 hydrate 会读到 version 2（AI 的）。**但内存 state 被 processEntry 覆盖**，且 classify 写的 version:1 行也落了库（脏数据，虽被 max-version 忽略）。

**修法（两处必须都修）**：

1. **D1**：classify 读现有 version 递增（deepSeekLlm.ts:210）：
```ts
const existing = await di.storage.getEntryAi(entryId)
const ai: EntryAi = { ..., version: (existing?.version ?? 0) + 1, ... }
```

2. **D11 变体**：processEntry 完成 setState 时比 version（store.ts:416-418）：
```ts
const ai = await di.llm.classify(entryId)
await di.storage.saveEntryAi(ai)
// ...
set((s) => {
  const current = s.aiByEntry[entryId]
  // 防 AI/手动编辑被在途 classify 覆盖：只在新 version >= 当前时更新
  if (current && current.version > ai.version) return s  // AI 已写更高 version，不覆盖
  return { ..., aiByEntry: { ...s.aiByEntry, [entryId]: ai } }
})
```

**不修这两处，AI 改标签会被在途分类静默冲掉**——用户觉得「AI 加了又变回去」。这是 AI 写功能上线前的硬前置。

### 12.5 撤销链路（L2 review 卡）

用户点 review 卡「撤销」：

```ts
undoAiAction: async (actionId) => {
  const action = await di.storage.getAiAction(actionId)
  // 检查 entry 当前 version 是否仍 == after.ai.version（未被其他写动过）
  const current = await di.storage.getEntryAi(action.args.entryId)
  if (current.version !== action.after.ai.version) {
    // 发散：有别的写发生在 AI 写之后，自动 reverse 不安全
    throw new Error('条目已被其他改动修改，无法自动撤销；请手动编辑')
  }
  // reverse：恢复 before.ai 的 tags，version+1（不留原地，bump 一次）
  const reverted: EntryAi = { ...action.before.ai, version: current.version + 1, createdAt: now }
  await di.storage.saveEntryAi(reverted)
  // tags 表 usageCount-1（或若归零则删标签行）
  // ...
  await di.storage.saveAiAction({ ...action, undone: true, undoneAt: now })
  set((s) => ({ aiByEntry: { ...s.aiByEntry, [action.args.entryId]: reverted }, ... }))
}
```

**诚实边界**（§4.2 第 4 条）：version 发散时拒绝自动撤销 + 提示手动编辑，不假装能撤。

### 12.6 标签 rename / merge（L2 vs L3 边界）

- **rename 标签**（只改 `Tag.label`，不改条目归属）：L2 自动。`saveTag({slug:'reading', label:'阅读'})`，不动任何 EntryAi.tags。低风险。
- **merge 标签**（如把 `whisper` 并入 `stt`，改多条 EntryAi.tags 归属）：L3 确认。要遍历所有含 `whisper` 的 EntryAi，逐条 updateEntryAi 改 tags + version，全量 diff 预览。改多条归属属策展，必须确认。

这条边界与 §4.1 表一致：rename 单标签 = 整理（L2），merge 两标签 = 策展（L3）。

---

## 13. 深度方案：AI 写操作的一致性保证

> 本章节是 §12 并发难题的完整解法。核心洞察：D11 并发不是「需要全局锁」的单点问题，而是「AI 增量写 vs classify 全量重生成」的语义冲突 + 条目稳定态边界。解法是**分层防御**——每层独立可测、独立验证，跳层会爆。

### 13.1 问题再定义：并发到底在哪发生

先精确划定并发窗口（基于代码事实，非凭空设计）：

`processEntry` 触发点（仅两处）：
- `finishSave`（store.ts:266）：新存条目，status='processing'
- `handleReprocess`（detail:505）：用户手动重处理

AI 写触发点：
- chat loop 的 gate 执行 toolCall

**场景矩阵**：

| 场景 | 触发条件 | 并发？ | 严重度 |
|------|---------|--------|--------|
| A. AI 改已 ready 老条目 | 检索召回的条目早已 status=ready | 否（无在途 processEntry） | 无 |
| B. 新存条目立即被 AI 写 | 用户新存→马上对 AI 说「给刚才那条加标签」 | 是（processEntry 在跑 STT/classify） | 高 |
| C. 用户 reprocess + AI 同时写 | detail 点重处理，同时 chat 里 AI 写同条 | 是 | 高 |
| D. AI 连续两次写同条 | chat 一轮里 add_tag + change_category | 否（串行 await） | 无 |
| E. AI 写后用户 reprocess | AI 加标签后，用户手动点重处理 | 是（语义冲突，非时序） | 中高 |

**关键洞察**：D11 的时序并发只在 B/C（条目处于 processing 时被 AI 写）。场景 E 是**语义冲突**——classify 全量重生成会丢弃 AI 的增量改动，这不是时序问题，version 守卫挡不住。

### 13.2 五层防御方案

#### 层 1：status 守卫——串行化（消除 B/C 主场景）

AI gate 执行写工具前，检查条目稳定态：

```ts
// src/app/aiTools.ts
async function executeAiTool(call: ToolCall): Promise<ToolResult> {
  // 层 1：status 守卫——只写稳定态条目
  const entry = await di.storage.getEntry(call.args.entryId)
  if (!entry) throw new Error('条目不存在')
  if (entry.status === 'processing') {
    // 条目正在 STT/classify，AI 写会与 processEntry 撞车 → 拒绝，让 LLM 知道
    return {
      ok: false,
      toolResult: { error: '该条目正在 AI 处理中，请稍后再试' },
      // LLM 收到这个 tool_result 会调整回答（如「这条还在处理，稍等我再帮你加」）
    }
  }
  // ... 继续层 2-5
}
```

**效果**：AI 只写 status∈{ready, failed, idle, offline-pending} 的条目。processEntry 只在 status='processing' 时跑。两者不重叠，B/C 场景消除。

**为何不排队而是拒绝**：MVP 简化——拒绝 + LLM 自行调整（「稍后再试」）比维护待写队列简单。演进时可加队列。

#### 层 2：D1 修——classify version 递增（保证 max-version 语义）

```ts
// src/adapters/deepSeekLlm.ts classify（修 D1）
const existing = await di.storage.getEntryAi(entryId)
const ai: EntryAi = {
  id: crypto.randomUUID(),
  entryId,
  version: (existing?.version ?? 0) + 1,  // ← 修：递增，不再硬编码 1
  // ...
}
```

**效果**：Dexie 层 `getEntryAi` 的 max-version reduce 语义正确——任何写（classify 或 AI）都基于现有最高 version 递增。不再产生「脏 version:1 行被 max 忽略但内存被冲」的悖论。

#### 层 3：version 单调守卫——processEntry 不覆盖更高 version（防极端时序）

即便层 1 挡住主场景，仍可能有极端时序（AI 写刚完成 setState、processEntry 的 setState 恰在下一 tick）。层 3 是兜底：

```ts
// src/app/store.ts processEntry（修 D11 变体，store.ts:416-418）
const ai = await di.llm.classify(entryId)
await di.storage.saveEntryAi(ai)
const entry = await di.storage.getEntry(entryId)
if (entry) {
  const updated: Entry = { ...entry, status: 'ready', aiId: ai.id, updatedAt: now }
  await di.storage.saveEntry(updated)
  set((s) => {
    const current = s.aiByEntry[entryId]
    // 层 3：低 version 不覆盖高 version（防在途 AI 写被 classify 冲掉）
    if (current && current.version > ai.version) {
      // AI 已写更高 version，只更新 entry.status，不动 aiByEntry
      return { entries: s.entries.map((e) => (e.id === entryId ? updated : e)) }
    }
    return {
      entries: s.entries.map((e) => (e.id === entryId ? updated : e)),
      aiByEntry: { ...s.aiByEntry, [entryId]: ai },
      categories, tags,
    }
  })
}
```

**效果**：内存 state 的 version 单调递增，绝不回退。即便时序极端，AI 的高 version 写不会被 classify 的低 version 冲掉。

#### 层 4：重处理冲突提示——语义冲突交给用户（消除场景 E）

场景 E 是语义冲突：AI 加了 reading 标签（version 2），用户点「重处理」，classify 全量重生成（version 3，tags 不含 reading）。层 3 的 version 守卫挡不住（classify version 更高）。解法是把「会丢手动改动」的决策交还用户：

```ts
// src/ui/screens/detail/index.tsx handleReprocess（改）
const handleReprocess = async () => {
  if (!id) return
  // 层 4：检查该条目是否有 AI/手动写记录
  const hasManualEdits = await hasAiOrManualWrites(id)  // 查 aiActions 表 + version>1
  if (hasManualEdits) {
    setReprocessConfirmOpen(true)  // 弹 L3 确认卡
    return
  }
  setReprocessing(true)
  void useUiStore.getState().processEntry(id)
}
// 确认卡文案：「重处理会重新分类，可能覆盖已手动整理的标签/类别。是否继续？」
```

**效果**：用户主动触发重处理时，明确告知会覆盖手动/AI 改动。符合 AiJi「策展权在人」铁律——重处理是破坏性操作，用户该知道后果。不需要 classify 合并手动改动（那会污染 LLM 语义）。

#### 层 5：多表顺序写 + 失败回滚 + 审计（不用 Dexie 事务，保端口纯净）

AI 写涉及四张表（entryAi / tags / aggregates / aiActions）。不用 Dexie 跨表事务（会让 StoragePort 暴露 Dexie 细节，破坏端口 PWA 无关性）。改用顺序写 + 失败回滚：

```ts
// src/app/aiTools.ts 层 5：顺序写 + 回滚
async function applyAddTag(entryId: string, tag: string) {
  const before = await snapshotAiAndTag(entryId, tag)  // 快照前态
  try {
    // 1. 改 EntryAi.tags + version+1
    const cur = await di.storage.getEntryAi(entryId)
    if (!cur) throw new Error('无 AI 记录')
    if (cur.tags.includes(tag)) return { skipped: 'already' }
    const next = { ...cur, tags: [...cur.tags, tag], version: cur.version + 1, createdAt: now }
    await di.storage.saveEntryAi(next)

    // 2. 同步 tags 表（usageCount+1 或新建）
    try {
      const tags = await di.storage.listTags()
      const existing = tags.find((t) => t.slug === tag)
      if (existing) await di.storage.saveTag({ ...existing, usageCount: existing.usageCount + 1 })
      else await di.storage.saveTag({ slug: tag, label: tag, usageCount: 1, createdAt: now })
    } catch (e) {
      // 回滚步骤 1：恢复 cur（version 再 +1）
      const rolledBack = { ...cur, version: cur.version + 2, createdAt: now }
      await di.storage.saveEntryAi(rolledBack)
      throw e
    }

    // 3. 审计（失败不影响数据，只记日志）
    try {
      await di.storage.saveAiAction({ id: uuid(), ts: now, tool: 'add_tag', tier: 'L2', args: { entryId, tag }, before, after: { ai: next } })
    } catch (e) { console.error('[aiTools] audit failed', e) }

    // 4. aggregate stale（失败不影响数据）
    try { await markAggregatesStale(entryId) } catch (e) { console.error('[aiTools] stale mark failed', e) }

    return { ok: true, after: { ai: next } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
```

**效果**：步骤 2 失败时回滚步骤 1；步骤 3/4 失败只记日志（审计/stale 是辅助，不阻断主写）。比事务脆，但端口保持纯净，且审计日志可追查半成品。

### 13.3 五层防御覆盖矩阵

| 场景 | 层 1 status守卫 | 层 2 D1修 | 层 3 version单调 | 层 4 重处理提示 | 层 5 回滚 |
|------|:-:|:-:|:-:|:-:|:-:|
| A. AI 改 ready 老条目 | ✓ 通过 | — | — | — | ✓ |
| B. 新存条目立即被 AI 写 | ✓ 拒绝 | — | — | — | — |
| C. reprocess + AI 同时写 | ✓ 拒绝 | — | — | — | — |
| D. AI 连续两次写同条 | — | — | — | — | ✓ |
| E. AI 写后用户 reprocess | — | — | — | ✓ 提示 | — |
| 极端时序（层1漏） | — | ✓ | ✓ | — | — |
| 多表写中间失败 | — | — | — | — | ✓ |

**每场景至少两层覆盖**（除 D 单层但 D 本身无并发风险）。

### 13.4 L3 tool-use loop 中段挂起的态机

L3 工具（merge_categories / trash_entries）执行前暂停 loop 等用户确认。用 Promise 挂起 + 外部 resolve：

```ts
// src/app/store.ts sendMessage 的 loop 里
let pendingConfirm: { toolCall: ToolCall; resolve: (result: ToolResult) => void } | null = null

async function runTool(call: ToolCall): Promise<ToolResult> {
  const tier = getToolTier(call.tool)  // L2 / L3
  if (tier === 'L3') {
    // 挂起 loop，插 inline 确认卡到对话流
    const result = await new Promise<ToolResult>((resolve) => {
      pendingConfirm = { toolCall: call, resolve }
      set((s) => ({ /* 把确认卡作为待确认消息插入对话 */ }))
    })
    pendingConfirm = null
    return result
  }
  return executeAiTool(call)  // L2 自动执行
}

// UI 确认回调
const onConfirmL3 = async () => {
  if (!pendingConfirm) return
  const result = await executeAiTool(pendingConfirm.toolCall)
  pendingConfirm.resolve(result)  // 恢复 loop
}
const onRejectL3 = () => {
  if (!pendingConfirm) return
  pendingConfirm.resolve({ ok: false, toolResult: { denied: true } })
  pendingConfirm = null
}
```

**风险防护**：
- 超时清理：pendingConfirm 设 5 分钟超时，自动 resolve denied，防 promise 永挂。
- 离开页面：/chat unmount 时 resolve 所有 pending 为 denied，清理。
- MVP 限制：一次 chat turn 内最多一个 L3 toolCall（LLM prompt 约束），不支持 L3 批量连续确认，降低态机复杂度。

### 13.5 可行性结论（更新 §11 评估）

| 部分 | 难度 | 工作量 | 前置 | 风险 |
|------|------|--------|------|------|
| chat 检索（读） | 低 | 2-3 天 | 无 | 低 |
| 层 1-3 前置修 bug（D1/D11/status守卫） | 中 | 1-2 天 | — | — |
| AI 写 L2 整理（add_tag/改标题/新建类别） | 中 | 3-4 天 | 层 1-3 | 中（有层 5 回滚兜底） |
| AI 写 L3 破坏性（删/合并） | 高 | 3-5 天 | 层 1-4 | 高（态机 + 撤销复杂） |
| 撤销系统（aiActions undo） | 中 | 2-3 天 | 层 5 | 中（version 发散检测） |

**落地顺序**（强制串行，不可跳）：
1. 修 D1 + D11（层 2/3）——不修别碰 AI 写
2. chat 检索上线（纯读，零风险，立刻有价值）
3. gate 层 1 status 守卫 + 层 5 回滚框架
4. AI 写 L2 整理（最常见、可撤销、风险可控）
5. 层 4 重处理冲突提示
6. AI 写 L3 破坏性 + 撤销系统

**最大认知陷阱（再次强调）**：设计文档里「LLM 返回 toolCalls → gate 执行」看着清爽，工程量在 gate 执行后的**多表同步 + 并发守卫 + 撤销快照**。这五层防御是静默的、测试难复现的、上线才爆的——必须按顺序铺，跳层（比如不修 D1 直接上 AI 写）会让「AI 改了又变回去」成为线上噩梦。
