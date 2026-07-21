# AI 记忆（用户明确记忆）— 设计（2026-07-22）

> 用户需求（原话）：「询问的 AI 应该有记忆功能，这样以后回答可以参考一些用户明确的记忆，
> 记忆进行分类理解的时候也能用到用户指定的情况，所以这一块要有」
>
> 范围定调：**用户显式书写**的记忆（AI 自动提取记忆是后续增强，不在本期）。
> 两个消费点：① 询问 AI（answerChat）回答时参考；② 分类（classify）时遵循用户指定的归类偏好。

## 1. Domain 模型（`src/domain/types.ts`）

```ts
export interface Memory {
  id: string              // uuid
  ownerId?: string        // 账号分区（与 Entry 等同策略：可选 + save 盖章 + upgrade 回填）
  content: string         // 用户原文，如「和老婆相关的内容都归到 family 类」「我对花生过敏」
  enabled: boolean        // 停用不删除（参与 prompt 与否的开关）
  createdAt: string       // ISO
  updatedAt: string       // ISO
}
```

- 不加 kind/category 枚举——用户原话只要求「明确的记忆」，分类理解靠 content 自然语言本身
  （「都归到 X 类」这种指令 LLM 直接读懂）。枚举是过度设计。
- 数量软上限：UI 层不限，prompt 注入取 enabled 按 updatedAt 倒序前 20 条（防爆 token）。

## 2. 存储

- Dexie `version(8)`：新表 `memories: 'id, ownerId, updatedAt'`。新表无存量迁移负担。
- `StoragePort` 加三方法：`listMemories()` / `saveMemory(m: Memory)` / `deleteMemory(id: string)`
  （分区语义与其他表一致：list 按 currentOwner 过滤、save 强制盖章、delete 先验 owner）。
- store.ts：hydrate 载入 `memories: Memory[]`（与 entries 同批 Promise.all）；
  增/改/删/开关走 store action（save → 落库 → set 内存态），settings 屏消费。

## 3. Prompt 注入（两个消费点，BYOK + builtin 双路径一致）

注入点集中在 `openAiCompatLlm.ts` 的 prompt builder（builtin 复用同批 builder，改一处两路生效）：

- **classify**：`buildPrompt(...)` 加可选尾参 `memories?: string[]`（content 文本数组）。
  有记忆时 system 追加一节：
  ```
  用户明确记忆与偏好（必须遵循，优先级高于你的默认判断）：
  - <content 1>
  - <content 2>
  若记忆与本条目分类/标签相关（如「X 都归到 Y 类」），严格按记忆执行。
  ```
  classify 内：`di.storage.listMemories()` → enabled → map content → 传入。
  （builtinLlm.classify 与 openAiCompatLlm.classify 同样传——两适配器各加 3 行。）
- **answerChat**：`buildAnswerPrompt(question, cites, conversation, memories?: string[])`，
  system 追加同一节（措辞改为「回答时参考这些用户明确记忆；与记忆冲突时以记忆为准」）。
- 无记忆（空数组）→ 不追加任何内容，prompt 与今日逐字节一致（回归安全）。

## 4. UI（settings 屏）

- 新 `MemorySheet`（镜像 `SttSheet`/`VlmSheet` 结构）：记忆列表（content + 开关 switch + 删除）
  + 底部输入框「记一条：如『和老婆的对话都归到家庭类』」+ 添加按钮。
- settings 列表加 `ChevronRow`「AI 记忆」（icon: Brain/Bookmark 类 lucide 图标，副标题显示条数）。
- 编辑=就地更新 updatedAt；开关/删除即时落库。

## 5. 实施分工（单 agent 顺序做，文件互不冲突）

1. `types.ts` Memory + `db.ts` v8 + `ports/index.ts` 三方法 + `dexieStorage.ts` 实装
2. `store.ts`：memories 状态 + hydrate 载入 + saveMemory/deleteMemory/toggleMemory action
3. `openAiCompatLlm.ts`：buildPrompt/buildAnswerPrompt 加 memories 参 + 两个 classify/answerChat 注入
4. `builtinLlm.ts`：classify/answerChat 同样注入（listMemories + 传参）
5. `settings/index.tsx`：MemorySheet + ChevronRow
6. 测试：
   - buildPrompt/buildAnswerPrompt 有/无记忆的 prompt 内容断言（无记忆逐字节回归）
   - dexieStorage memories 分区（A/B 隔离）
   - store action 落库 + 内存态一致
7. 自检：`npx tsc -p tsconfig.app.json` + `npx vitest run`

## 6. 明确不做（本期）

- AI 自动从对话/条目提取记忆候选（后续：answerChat 后异步提取 → 用户确认入库）
- 记忆条数硬上限 / 去重合并 / 向量检索（20 条软截断内 LLM 直接读得下）
- 记忆云同步（local-first，与其他数据一致）

## 7. 验收

- 设置里加记忆「螺蛳粉相关条目都归到 food 类」→ 记一条「今晚吃了螺蛳粉」→ 分类落 food
- 加记忆「我对花生过敏」→ 询问 AI「推荐点零食」→ 回答避开花生并体现记忆
- 停用记忆 → 同问不再体现；两账号记忆互不可见（分区）
