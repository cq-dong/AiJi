# AI Chat 检索 · 实施计划

> 2026-07-17 · 纯读检索，不含 AI 写操作
> 目标：3-4 天出可用 MVP，零数据风险，无需前置修 bug
> 设计依据见 `docs/design/ai-chat-design.md` §2-3、§5-6

## 范围

做：自然语言问库内容 → AI 检索 + 回答 + 引用 chip。
不做：AI 改数据（标签/类别/正文）、tool calling、撤销、审计。这些是后续阶段。

## 依赖的现有零件（不造轮子）

- 检索：`search/helpers.ts` 的 `searchEntries`（本地 substring）、`summary/aggregate.ts` 的 `scopeRange`/`shiftRef`（时间解析）
- LLM：`deepSeekLlm.ts` 的 prompt 模式（铁律+schema+示例）、`parseJson`（去围栏）、`toLocalIso`
- UI 原语：`Chip`/`Spinner`/`Card`/`EmptyState`、BareLayout
- 状态：`useUiStore` 的 entries/aiByEntry/categories/tags/settings/online

## 步骤（6 步，可并行处标出）

### 1. LlmPort 加 chat 方法
- `ports/index.ts`：LlmPort 加 `chat(opts) → {answer, citedEntryIds}`（不带 tools，纯读）
- `deepSeekLlm.ts`：实现 chat，内部两步
  - intent 模式：`buildIntentPrompt`（解析问句→结构化 query）
  - answer 模式：`buildAnswerPrompt`（top-K 条目压缩 + 铁律「citedEntryIds 必须来自传入 id」）
  - 复用 parseJson；后校验 citedEntryIds ∈ 传入集

### 2. 本地检索层
- `ui/screens/chat/helpers.ts`：
  - `localRecall(query, entries, aiByEntry)`：并集召回（结构化过滤 ∪ keywords substring）
  - `rankScore`：summary*4 + category*3 + tag*3 + keyword*2 + 近期
  - top-K=8，压缩成 `{id, createdAt, category, tags, summary, textExcerpt≤120}`

### 3. 数据层 + router
- `db.ts` v6：加 `conversations: 'id, updatedAt'`
- `domain/types.ts`：加 `Conversation` 类型
- `dexieStorage.ts`：`listConversations/saveConversation/deleteConversation`
- `router.tsx`：BareLayout 段加 `<Route path="chat">`（仿 /drafts /trash）

### 4. store.sendMessage
- 意图解析（LLM intent）→ 本地召回 → LLM answer → 落 conversation
- 离线（online=false）直接拒绝
- 同会话同问题缓存（hash(question+entries-version)）
- loading 态：第一阶段「理解问题…」、第二阶段「检索库中…」

### 5. /chat 屏 UI
- `ui/screens/chat/index.tsx`：BareLayout，气泡（用户右/AI 左），引用 chip 行
- 引用 chip 点 → `/detail/:id`；可展开 verbatim 片段
- 顶部「上送云端」隐私 chip（复用 AiPanel）
- 离线态：禁用输入 + 提示
- 流式回答（第二轮 SSE，体感降延迟）

### 6. 入口
- home 顶栏搜索图标旁加「问 AI」按钮 → `/chat`

## 关键约束（别漏）

- **防幻觉四层**：prompt 铁律 + 后校验剔非法 id + 空引用拒绝裸答（输出「库内未找到依据」）+ verbatim 片段让用户肉眼对齐
- **token 预算**：top-8 × 压缩 ~4K input；历史用滑动窗，不全量塞
- **两轮延迟缓解**：intent 用 flash 模型、结果缓存、流式 answer、明确 loading 文案
- **离线禁用**：不假装能降级

## 不做（后续阶段）

- AI 写操作（add_tag/change_category/merge/trash）→ 需先修 D1/D11，见 design doc §13
- function calling / tool-use loop
- 向量嵌入（远期）
- 搜对话历史（schema 预留，MVP 不实现）

## 验收

- 能问「我上个月关于 X 的想法」并返回带引用的回答
- 引用 chip 点进对应 detail
- 离线时禁用 + 提示
- 回答不出现臆造引用（后校验 + 空引用拒绝）
