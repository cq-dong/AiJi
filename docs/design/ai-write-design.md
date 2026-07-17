# AiJi · AI 智能写操作 · 设计文档

> 版本：1.0 · 2026-07-17
> 状态：方案定稿（产品决策见 §0）
> 范围：用户用自然语言指挥 AI 直接修改条目/标签/大类
> 关联：读侧（对话检索）见 `ai-chat-design.md`；两者共享 chat 界面，本文件专注写侧

---

## 0. 产品决策（已拍板）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| AI 改条目正文（entry.parts） | **MVP 全禁** | 条目正文=用户记忆，AI 改正文=篡改记忆；校对意图 LLM 自判不可靠。改正文只走手动 PartsEditSheet |
| 写权限粒度 | **按字段细分**（非按 action 粗分） | additive 可自动，覆盖型/自由字段需确认 |
| L3 确认形式 | **inline 卡**（非全屏 modal） | 对话流不割裂 |
| 撤销机制 | **L2 review 卡常驻 + 审计日志** | 5 秒 toast 对话里看不见 |
| 硬删（deleteEntry） | **AI 永禁** | 只走 trashEntry 软删，30天可恢复 |

---

## 1. 产品语义

### 1.1 什么是「AI 写」

用户在 chat 里用自然语言指挥 AI 改数据，如：
- 「给这条加个 reading 标签」
- 「把 idea 和 thoughts 两个类合并」
- 「给上周末的几条补上摘要」
- 「删掉上周的测试条目」

LLM 把这些意图解析成**工具调用**（toolCalls），由 store 层 gate 执行——LLM 本身不碰数据库。

### 1.2 两种写语义的本质区别（设计核心）

| 语义 | 例子 | 特点 |
|------|------|------|
| **增量写**（AI 写） | 给条目加标签、改标题 | 改某个字段，保留其余 |
| **全量重生成**（classify） | processEntry 的 LLM 分类 | 产出全新 EntryAi，不含手动增量 |

这两者冲突：classify 一跑会丢弃 AI 的增量改动。这是 §6 一致性保证的核心难题——不是时序问题，是语义冲突。

### 1.3 与产品铁律对齐（CLAUDE.md §1）

- **类别涌现**：AI 可新建类别（涌现合法，§1「类别由内容涌现」）→ L2 自动
- **策展权在人**：合并/重命名/删除类别属「策展」（§1「用户可策展」）→ L3 必须确认
- **记忆不可篡改**：条目正文是用户 ground truth → AI 永禁改正文（§0 决策）
- **情绪是可选侧面**：AI 不强制采集 mood，改 facets 属 L3

---

## 2. 权限模型：按字段细分

权限**按 field 类型**分级，不按 action 粗分。这是核心设计——`updateEntryAi` 整体 L2 不可接受，因为覆盖已有 category 比加标签危险得多。

### 2.1 权限分级表

| 操作 | field 类型 | 档 | 确认机制 |
|------|-----------|-----|---------|
| 加标签（additive） | 受控词表 | **L2** | 自动 + review 卡 |
| 新建类别（涌现） | 受控 | **L2** | 自动 + review 卡 |
| 改标题/摘要 | 自由文本，非正文 | **L2** | 自动 + review 卡 |
| 重命名标签（只改 label 不动归属） | 整理 | **L2** | 自动 + review 卡 |
| 改已有 category（覆盖用户策展） | 受控，覆盖 | **L3** | inline 确认 + diff |
| 改 facets（自由形式无校验） | 自由 | **L3** | inline 确认 + diff |
| 合并类别（改多条归属） | 策展 | **L3** | inline 确认 + 全量 diff |
| 合并标签（改多条归属） | 策展 | **L3** | inline 确认 |
| 重命名类别 | 策展 | **L3** | inline 确认 |
| trashEntry（软删） | 破坏性可逆 | **L3** | inline 确认 + reason |
| deleteEntry（硬删） | — | **🚫 AI 永禁** | gate 直接拒绝 |
| 改 entry.parts 正文 | 篡改记忆 | **🚫 MVP 全禁** | 只走手动 PartsEditSheet |

### 2.2 分档原则

- **L2 自动**：additive（加不覆盖）、受控词表、单条、可逆。误改可撤销。
- **L3 确认**：覆盖型（改已有值）、自由字段（facets 无校验）、改多条归属（策展）、破坏性。
- **永禁**：硬删（不可恢复）、改正文（篡改记忆）。

### 2.3 L2/L3 边界的关键判断

- **标签 rename 单个 = L2**：只改 `Tag.label`，不动任何 EntryAi.tags 归属。低风险。
- **标签 merge 两个 = L3**：改多条 EntryAi.tags 归属，属策展。
- **改已有 category = L3**：覆盖用户已策展的分类，比 additive 危险。
- **改 facets = L3**：自由形式无校验，污染后续检索过滤。

---

## 3. Tool 层设计

### 3.1 LlmPort.chat 签名（读写统一）

```ts
interface LlmPort {
  // ... classify / aggregate 略
  chat(opts: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    tools?: ToolDef[]   // 可用工具定义
    model?: string
  }): Promise<{
    answer?: string
    citedEntryIds?: string[]   // 读侧用
    toolCalls?: ToolCall[]     // 写侧用
  }>
}
```

**关键约束**：adapter **只返回** toolCalls，**不执行**。tool-use loop 在 store 层。LlmPort.chat 对只读用户 observable 无副作用。

### 3.2 Tool schema 草稿

```jsonc
// L2 · 自动执行（additive）
{
  "type": "function",
  "function": {
    "name": "add_tag",
    "description": "给条目加标签（additive，不覆盖已有）。可逆，自动执行。",
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
        "newCategory": { "type": "string" },
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

// L3 · 软删
{
  "type": "function",
  "function": {
    "name": "trash_entries",
    "description": "将条目移入回收站（30天可恢复）。需确认。",
    "parameters": {
      "type": "object",
      "required": ["entryIds", "reason"],
      "properties": {
        "entryIds": { "type": "array", "items": { "type": "string" }, "maxItems": 20 },
        "reason": { "type": "string" }
      }
    }
  }
}
```

### 3.3 function calling 降级（写侧红线）

DeepSeek 原生 tools。BYOK endpoint 无 function-calling 时（Azure/vLLM/llama.cpp 严格 OpenAI 兼容，未知 tools 参数返 400）：
- **读侧（answer + citations）必须照常工作**
- 仅写操作拒绝 + UI 提示「当前模型不支持 AI 改数据，可手动编辑」
- 绝不因 tools 不支持让 chat 整个废掉

降级实现：探测 `data.choices[0].message.tool_calls` 缺失 → prompt 要求输出 `{"reply":"...","actions":[{"tool":"...","args":{}}]}` JSON，store 解析。两路汇入同一 `ToolCall[]`。

### 3.4 Tool 执行 gate（唯一写入口）

```ts
// src/app/aiTools.ts
async function executeAiTool(call: ToolCall): Promise<ToolResult> {
  // 层 1：status 守卫（见 §6.2）
  const entry = await di.storage.getEntry(call.args.entryId)
  if (entry?.status === 'processing') {
    return { ok: false, toolResult: { error: '该条目正在 AI 处理中，请稍后再试' } }
  }

  // 永禁检查
  if (call.tool === 'delete_entry') throw new Error('AI 无权硬删；使用 trash_entry')
  if (call.tool === 'update_entry_parts') throw new Error('AI 无权改正文；请手动编辑')

  const before = await snapshot(call)   // 审计前态
  let result
  switch (call.tool) {
    case 'add_tag':
      await useUiStore.getState().addTag(call.args.entryId, call.args.tag)
      break
    case 'change_category':
      await useUiStore.getState().updateEntryAi(call.args.entryId, { category: call.args.newCategory })
      break
    case 'trash_entry':
      await useUiStore.getState().trashEntry(call.args.entryId)   // 软删
      break
    case 'merge_categories':
      await useUiStore.getState().mergeCategories(call.args.fromSlug, call.args.toSlug)
      break
    default: /* ... */
  }
  const after = await snapshot(call)
  await di.storage.saveAiAction({ id: uuid(), ts: now, tool: call.tool, tier: getTier(call.tool), args: call.args, before, after })
  await markAggregatesStale(call)   // 联动 aggregate
  return result
}
```

---

## 4. 端到端链路：AI 改标签

以「给条目 e2（tags=['aiji','design'] version 1）加 reading 标签」为例。

### 4.1 LLM 返回工具意图（不执行）

```json
{
  "answer": "好的，已为「CapturePort 接口化」加上 reading 标签。",
  "citedEntryIds": ["e2"],
  "toolCalls": [{ "id": "call_1", "tool": "add_tag", "args": { "entryId": "e2", "tag": "reading" } }]
}
```

### 4.2 后端同步记录（标签存在两处）

标签在 `EntryAi.tags`（条目标签数组）和 `tags` 表（标签库+usageCount）两处。现有 `updateEntryAi` 只改前者，AI 改标签需专门 action 同步两者 + 审计 + aggregate：

```ts
// src/app/store.ts 新增 addTag action
addTag: async (entryId, tag) => {
  const cur = get().aiByEntry[entryId] ?? (await di.storage.getEntryAi(entryId))
  if (!cur) return
  if (cur.tags.includes(tag)) return  // 幂等

  // 1. 改 EntryAi.tags（version+1）
  const next: EntryAi = { ...cur, tags: [...cur.tags, tag], version: cur.version + 1, createdAt: now }
  await di.storage.saveEntryAi(next)

  // 2. 同步 tags 表（修 D6：usageCount 永不递增）
  const existing = get().tags.find((t) => t.slug === tag)
  if (existing) {
    await di.storage.saveTag({ ...existing, usageCount: existing.usageCount + 1 })
  } else {
    await di.storage.saveTag({ slug: tag, label: tag, usageCount: 1, createdAt: now })
  }

  // 3. aggregate 联动（防 cited snippet 过期）
  await markAggregatesStale(entryId)

  // 4. 前端 state 同步
  const tags = await di.storage.listTags()
  set((s) => ({ aiByEntry: { ...s.aiByEntry, [entryId]: next }, tags }))
}
```

**落库后 Dexie 状态**：entryAi 表新增 version 2 行；tags 表 reading 的 usageCount+1 或新建；aggregates 当日/周/月 stale=true；aiActions 新增审计。

### 4.3 前端同步变化

Zustand `set` 更新内存，React 订阅自动重渲染：
- **detail 屏** AiPanel 标签行立即显示 #reading
- **categories 屏** 标签计数+1 或新标签出现
- **summary 屏** 当日卡显示「已过期」需重算
- **/chat 屏** L2 review 卡显示「已整理 1 条：e2 +reading」+ 撤销

---

## 5. 批量操作

- **硬上限 20 条/turn**（tool schema `maxItems: 20`）。超限 LLM 须分批或拒绝。
- **L2 批量**（如「把这 15 条标 design」）：自动执行，review 卡显「已整理 N 条」+「撤销全部」。
- **L3 批量**（如「删掉上周测试条目」）：不自动，inline 确认卡列全量 diff（虚拟列表，折叠 >5），一次性「全部确认/逐条/取消」。
- **MVP 限制**：一次 chat turn 内最多一个 L3 toolCall（prompt 约束），不支持 L3 批量连续确认，降低态机复杂度。

---

## 6. 一致性保证：五层防御

> 核心洞察：AI 写的难题不在 LLM 调用，在 gate 执行后的多表同步 + 并发守卫 + 撤销快照。这些是静默的、测试难复现的、上线才爆的。

### 6.1 并发场景矩阵

| 场景 | 触发条件 | 并发？ | 严重度 |
|------|---------|--------|--------|
| A. AI 改已 ready 老条目 | 检索召回的条目早已 ready | 否 | 无 |
| B. 新存条目立即被 AI 写 | 新存→马上对 AI 说「给刚才那条加标签」 | 是 | 高 |
| C. reprocess + AI 同时写 | detail 点重处理，同时 chat 写同条 | 是 | 高 |
| D. AI 连续两次写同条 | 一轮里 add_tag + change_category | 否（串行 await） | 无 |
| E. AI 写后用户 reprocess | AI 加标签后用户手动重处理 | 是（语义冲突） | 中高 |

**关键洞察**：时序并发只在 B/C（条目 processing 时被 AI 写）。场景 E 是**语义冲突**——classify 全量重生成丢弃 AI 增量，version 守卫挡不住。

### 6.2 五层防御

#### 层 1：status 守卫——串行化（消除 B/C）

```ts
// gate 开头
const entry = await di.storage.getEntry(call.args.entryId)
if (entry?.status === 'processing') {
  return { ok: false, toolResult: { error: '该条目正在 AI 处理中，请稍后再试' } }
}
```

AI 只写稳定态（ready/failed/idle）条目，processEntry 只在 processing 时跑。两者不重叠。MVP 拒绝 + LLM 自行调整，不维护待写队列。

#### 层 2：D1 修——classify version 递增

```ts
// deepSeekLlm.ts classify（修 D1）
const existing = await di.storage.getEntryAi(entryId)
const ai: EntryAi = { ..., version: (existing?.version ?? 0) + 1, ... }
```

保证 Dexie 层 `getEntryAi` 的 max-version reduce 语义正确。

#### 层 3：version 单调守卫——processEntry 不覆盖更高 version

```ts
// store.ts processEntry setState（修 D11 变体）
set((s) => {
  const current = s.aiByEntry[entryId]
  if (current && current.version > ai.version) {
    // AI 已写更高 version，只更新 entry.status，不动 aiByEntry
    return { entries: s.entries.map((e) => (e.id === entryId ? updated : e)) }
  }
  return { entries: ..., aiByEntry: { ...s.aiByEntry, [entryId]: ai }, categories, tags }
})
```

内存 state 的 version 单调递增，绝不回退。

#### 层 4：重处理冲突提示——语义冲突交给用户（消除 E）

```ts
// detail handleReprocess（改）
const handleReprocess = async () => {
  if (!id) return
  const hasManualEdits = await hasAiOrManualWrites(id)  // 查 aiActions + version>1
  if (hasManualEdits) {
    setReprocessConfirmOpen(true)  // 弹 L3 确认卡
    return
  }
  setReprocessing(true)
  void useUiStore.getState().processEntry(id)
}
// 文案：「重处理会重新分类，可能覆盖已手动整理的标签/类别。是否继续？」
```

用户主动触发重处理时明确告知后果。不需要 classify 合并手动改动（那会污染 LLM 语义）。

#### 层 5：多表顺序写 + 失败回滚 + 审计（不用 Dexie 事务）

AI 写涉及四张表（entryAi/tags/aggregates/aiActions）。不用 Dexie 跨表事务（保端口 PWA 无关性），改顺序写 + 回滚：

```ts
async function applyAddTag(entryId, tag) {
  const before = await snapshot(entryId, tag)
  try {
    // 1. 改 EntryAi
    const cur = await di.storage.getEntryAi(entryId)
    const next = { ...cur, tags: [...cur.tags, tag], version: cur.version + 1, createdAt: now }
    await di.storage.saveEntryAi(next)

    // 2. 同步 tags 表（失败则回滚步骤1）
    try {
      const tags = await di.storage.listTags()
      const existing = tags.find((t) => t.slug === tag)
      if (existing) await di.storage.saveTag({ ...existing, usageCount: existing.usageCount + 1 })
      else await di.storage.saveTag({ slug: tag, label: tag, usageCount: 1, createdAt: now })
    } catch (e) {
      const rolledBack = { ...cur, version: cur.version + 2, createdAt: now }
      await di.storage.saveEntryAi(rolledBack)  // 回滚
      throw e
    }

    // 3. 审计（失败只记日志）
    try { await di.storage.saveAiAction({ ... }) } catch (e) { console.error(e) }
    // 4. aggregate stale（失败只记日志）
    try { await markAggregatesStale(entryId) } catch (e) { console.error(e) }

    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
```

### 6.3 防御覆盖矩阵

| 场景 | 层1 status | 层2 D1 | 层3 version单调 | 层4 重处理提示 | 层5 回滚 |
|------|:-:|:-:|:-:|:-:|:-:|
| A. AI 改 ready 老条目 | ✓ | — | — | — | ✓ |
| B. 新存条目立即被 AI 写 | ✓拒绝 | — | — | — | — |
| C. reprocess + AI 同时写 | ✓拒绝 | — | — | — | — |
| D. AI 连续两次写同条 | — | — | — | — | ✓ |
| E. AI 写后用户 reprocess | — | — | — | ✓提示 | — |
| 极端时序（层1漏） | — | ✓ | ✓ | — | — |
| 多表写中间失败 | — | — | — | — | ✓ |

**每场景至少两层覆盖**（除 D 单层但 D 无并发风险）。

---

## 7. 撤销系统

### 7.1 L2 review 卡（取代 5 秒 toast）

L2 不用 5 秒 toast（对话里看不见）。改**会话级 review 缓冲卡**：
- 折叠「AI 改了 N 条」可展开
- 常驻到离开 /chat 或显式关闭
- 撤销窗 = 卡存活期，不是定时器

### 7.2 撤销链路

```ts
undoAiAction: async (actionId) => {
  const action = await di.storage.getAiAction(actionId)
  // 检查 entry 当前 version 是否仍 == after.ai.version（未被其他写动过）
  const current = await di.storage.getEntryAi(action.args.entryId)
  if (current.version !== action.after.ai.version) {
    throw new Error('条目已被其他改动修改，无法自动撤销；请手动编辑')
  }
  // reverse：恢复 before.ai 的 tags，version+1
  const reverted = { ...action.before.ai, version: current.version + 1, createdAt: now }
  await di.storage.saveEntryAi(reverted)
  // tags 表 usageCount-1（若归零则删标签行）
  await di.storage.saveAiAction({ ...action, undone: true, undoneAt: now })
  set((s) => ({ aiByEntry: { ...s.aiByEntry, [action.args.entryId]: reverted } }))
}
```

**诚实边界**（§6.2 层 4 配套）：version 发散时拒绝自动撤销 + 提示手动编辑，不假装能撤。L3 merge_categories 撤销要重建 from 类别 + 回移条目，复杂但走同一 version 检查。

---

## 8. 数据模型变更（db v6）

### 8.1 新表

```ts
// db.ts version(6).stores(...) 全量重声明 + 新表
this.version(6).stores({
  // ... 现有表略
  aiActions: 'id, ts, tool, undone',  // ← 新：AI 写操作审计
})
```

### 8.2 新类型

```ts
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

### 8.3 StoragePort 新增方法

```ts
saveAiAction(a: AiAction): Promise<void>
listAiActions(): Promise<AiAction[]>
undoAiAction(id: string): Promise<void>
```

### 8.4 SecretStorePort 加 delete（修 D8）

```ts
interface SecretStorePort {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>  // ← 新
}
```

---

## 9. UI 设计

### 9.1 L2 review 卡

底部常驻折叠卡：`rounded-fab bg-priS`，文案「AI 已整理 N 条」+「展开」+「撤销全部」。展开列每条改动（entryId + field + before→after）。常驻到离开 /chat 或显式关闭。

### 9.2 L3 确认卡

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

diff 预览：类别/标签用「A → B」chip 对比；摘要/标题用 strikethrough→new。正文 diff 框架预留（MVP 禁改正文）。

### 9.3 L3 tool-use loop 中段挂起态机

```ts
let pendingConfirm: { toolCall: ToolCall; resolve: (r: ToolResult) => void } | null = null

async function runTool(call: ToolCall): Promise<ToolResult> {
  if (getToolTier(call.tool) === 'L3') {
    return await new Promise<ToolResult>((resolve) => {
      pendingConfirm = { toolCall: call, resolve }
      set((s) => ({ /* 插确认卡到对话流 */ }))
    })
  }
  return executeAiTool(call)  // L2 自动
}

const onConfirmL3 = async () => {
  if (!pendingConfirm) return
  const result = await executeAiTool(pendingConfirm.toolCall)
  pendingConfirm.resolve(result)  // 恢复 loop
}
const onRejectL3 = () => {
  if (!pendingConfirm) return
  pendingConfirm.resolve({ ok: false, toolResult: { denied: true } })
}
```

**风险防护**：
- 超时清理：pendingConfirm 设 5 分钟超时，自动 resolve denied，防 promise 永挂。
- 离开页面：/chat unmount 时 resolve 所有 pending 为 denied。
- MVP 限制：一次 turn 内最多一个 L3 toolCall。

### 9.4 无 function calling 降级态

模型不支持 tools 时，写操作按钮置灰 + 提示「当前模型不支持 AI 改数据，可手动编辑」；读侧问答照常。

---

## 10. 前置依赖：必须先修的 bug

| bug | 位置 | 为何阻塞 AI 写 |
|-----|------|--------------|
| **D1** | deepSeekLlm.ts:210 `version:1` 硬编码 | AI 写 v2 后，reprocess 的 classify 落 v1 shadow |
| **D11** | store.ts:416 processEntry 覆盖 state | AI 整理后用户点「重新分类」冲掉 AI 编辑 |
| **D8** | store.ts:367,374 清 key 不删 secret | 用户撤 AI 权限实则 secret 还在 |
| **D6** | usageCount 永不递增 | AI 加标签不同步 tags 表 |
| **D2** | dexieStorage.ts:99 getSettings 不合并 defaults | 新字段读不到 |

---

## 11. 落地步骤

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 0 | 修 D1/D11/D8/D6/D2（独立 PR） | — |
| 1 | Domain/Port：types 加 AiAction/ToolDef/ToolCall；LlmPort.chat 支持 tools；StoragePort 加审计方法；SecretStorePort 加 delete | 0 |
| 2 | DB v6：aiActions 表 | 1 |
| 3 | Tool 层：src/app/aiTools.ts，schema + executeAiTool gate（层1 status 守卫 + 层5 回滚 + 审计 + aggregate stale） | 1,2 |
| 4 | Store：addTag/mergeCategories/renameTag 等策展 action；补 saveTag usageCount 同步 | 3 |
| 5 | Adapter：deepSeekLlm chat 支持 toolCalls（原生 tools + JSON 降级） | 1 |
| 6 | UI 组件：AiToolToast（L2 review 卡）/ AiConfirmCard（L3）/ DiffPreview | 3 |
| 7 | /chat 屏接入 tool-use loop（含 L3 中段挂起态机） | 5,6 |
| 8 | 层 4 重处理冲突提示（detail handleReprocess） | 3 |
| 9 | Settings：加「AI 操作记录」屏（查审计 + 撤销） | 3 |

---

## 12. 可行性评估

| 部分 | 难度 | 工作量 | 前置 | 风险 |
|------|------|--------|------|------|
| 层 1-3 前置修 bug | 中 | 1-2 天 | — | — |
| AI 写 L2 整理（add_tag/改标题/新建类别） | 中 | 3-4 天 | 层 1-3 | 中（有层5回滚兜底） |
| AI 写 L3 破坏性（删/合并） | 高 | 3-5 天 | 层 1-4 | 高（态机+撤销复杂） |
| 撤销系统 | 中 | 2-3 天 | 层 5 | 中（version 发散检测） |

**强制串行顺序**：修 D1/D11 → gate 层1/5 → L2 整理 → 层4 提示 → L3 破坏性 + 撤销。

**最大认知陷阱**：设计里「LLM 返 toolCalls → gate 执行」看着清爽，工程量全在 gate 后的**多表同步 + 并发守卫 + 撤销快照**——这些静默、测试难复现、上线才爆。跳层（不修 D1 直接上 AI 写）会让「AI 改了又变回去」成线上噩梦。

---

## 13. 风险与开放问题

| 风险 | 影响 | 缓解 |
|------|------|------|
| AI 幻觉误改分类用户不察觉 | 数据污染 | review 卡常驻 + 撤销；覆盖型升 L3 |
| tool-use loop 中段挂起态机复杂 | 实现难度 | inline 确认卡 + promise 挂起 + 超时清理 |
| BYOK 模型不支持 function calling | 写操作废 | 读侧照常 + 写禁用提示（§3.3） |
| L3 merge 撤销复杂 | 撤销失败 | version 发散检测 + 诚实提示 |
| 多表写半成品 | 数据不一致 | 层5 顺序写 + 回滚 + 审计可追查 |

