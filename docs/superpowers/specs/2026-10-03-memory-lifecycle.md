# P-C 陪伴化：记忆生命周期（2026-10-03）

> 前置：P0（每轮 extractMemory + knownMemories 判重）已落地；P-B（embedding
> 语义能力）已落地。本文给 AI 记忆补上**更新 / 合并 / 过期**的完整生命周期——
> 现状记忆只增不减，伙伴「记住的」越积越脏。

## 1. 现状问题

1. **判重靠 LLM 读文本**：extractMemory 把 ≤50 条已知记忆原文塞给模型自判，
   措辞差异大时重复照存（「喜欢美式」+「爱喝美式咖啡」并存）。
2. **无更新语义**：「我搬到杭州了」与旧「住在上海」永远并存，prompt 注入
   两条冲突事实——伙伴说出自相矛盾的话。
3. **无过期**：「正在准备 7 月考试」考完后仍年年注入。
4. `enabled=false` 只有手动开关语义，没有「自动归档但可恢复」的概念。

## 2. 相似检测：向量先行（复用 P-B 能力，不加新表）

新记忆提取成功后、落库前：
- `di.llm.embed([新记忆, ...enabled 记忆原文])` 一次 batch（记忆量级几十条，
  无新表、无持久化向量——每次现算，成本可忽略）。
- cosine ≥ **0.85**（比条目召回的 0.2 严得多——这里判的是「同一事实」）→
  取 top-3 相似旧记忆进入裁决（§3）；无命中 → 直接 ADD 落库（现状路径）。
- **降级**：embed 缺席/抛错/返 null → 跳过裁决直接 ADD（= 现状行为，
  逐字节保留；builtin 用户天然在此路径）。

## 3. 冲突裁决：`LlmPort.adjudicateMemory`（新必需方法）

```ts
type MemoryVerdict =
  | { action: 'add' }                                  // 全新信息
  | { action: 'replace'; oldId: string }               // 事实更新（搬家/换工作）
  | { action: 'merge'; oldId: string; merged: string } // 互补合并
  | { action: 'skip' }                                 // 旧记忆已覆盖

adjudicateMemory(
  newMemory: string,
  similar: { id: string; content: string }[],  // ≤3，向量初筛产出
): Promise<MemoryVerdict>
```

- prompt helper `buildMemoryAdjudicationPrompt`（zh+en 单源，放 openAiCompatLlm
  与既有 helper 并列，builtin 复用 import——照 buildConversationSummaryPrompt 模式）。
  指令：判断新事实与旧记忆的关系；replace=同一事实的新值；merge=同一主题互补
  信息，输出合并后的单条原文；skip=新信息已被旧记忆覆盖；add=无关新事实。
- JSON 输出 + 白名单校验解析（照 parseIntentJson 模式：非法 action/oldId 丢弃）。
  max_tokens ~200，temperature 0。
- **裁决失败兜底**：抛错 / JSON 坏 / oldId 不在 similar 里 → 默认 ADD
  （宁可多存不丢信息），console.warn。
- store 执行：replace → 旧行 `enabled=false`（不删，留痕可恢复）+ 新行落库；
  merge → 旧行 content=merged、updatedAt/lastConfirmedAt 刷新，不新增行；
  skip → 只刷新旧行 lastConfirmedAt；add → 新行落库。

## 4. 过期归档

`Memory` 加两个**可选非索引字段**（Dexie 不升版）：
```ts
lastConfirmedAt?: string  // 提取/裁决保留时刷新；老数据缺省按 createdAt 算
archivedAt?: string       // 非空 = 已自动归档（区别于 enabled=false 手动停用）
```
- **刷新**：extractMemory 产出被裁决 add/replace/merge/skip 保留侧的行；
  手动「恢复」清 archivedAt 并刷新。
- **扫描**：`archiveStaleMemories()`——`enabled && !archivedAt &&
  now - (lastConfirmedAt ?? createdAt) > 90 天` → 盖 archivedAt。
  时机：hydrate 完成后一次 + saveMemory 成功后（低频，全表几十条）。
- **注入过滤**：prompt 拉取处（classify/answerChat 的 memoryBlock 拼装）过滤
  `archivedAt` 非空。`listMemories()` 返回全部（UI 要展示归档组），过滤在
  注入侧——找现有注入调用点逐一加（有且仅有两处：classify、answerChat 的
  memories 拉取）。
- **UI（最小）**：settings 记忆列表分两组——「已归档」折叠组置底，条目可
  「恢复」（清 archivedAt + 刷 lastConfirmedAt）；归档条目不再显示停用/启用
  开关（恢复即回到 enabled）。i18n zh/en。

## 5. 降级矩阵

| 能力缺席 | 行为 |
|---|---|
| embed 缺席/失败 | 无向量初筛 → 全部走 ADD（= 现状） |
| adjudicate 失败 | 默认 ADD + console.warn |
| 无相似记忆 | 直接 ADD（不调裁决，省一次 LLM） |

## 6. 任务拆分（lead 契约 → 2 路并行）

**Lead 契约 commit**：domain/types.ts（Memory.lastConfirmedAt/archivedAt +
MemoryVerdict）、ports/index.ts（adjudicateMemory 签名）、i18n key stub。
- **A（src/adapters/）**：buildMemoryAdjudicationPrompt 双语 + JSON 白名单解析 +
  双适配器 adjudicateMemory（BYOK chat completions；builtin chat() + consume）。
- **B（src/app/ + src/ui/screens/settings/）**：saveMemory 生命周期编排（embed 初筛
  → 裁决 → 四动作执行 + lastConfirmedAt 刷新 + 降级）、archiveStaleMemories +
  调用时机、注入过滤、settings 记忆列表归档组 UI。
- **验收 agent**：静态审 + 浏览器联测（BYOK 真 key：冲突记忆 replace、相似合并、
  过期归档、embed 缺席降级无感）。

## 7. 测试要点（TDD）

prompt 双语关键指令；JSON 解析白名单（四 action + 非法丢弃 + oldId 校验）；
cosine 0.85 阈值初筛；裁决四动作落库语义（replace 旧行 enabled=false 留痕 /
merge 合并刷新 / skip 只刷时间 / add 新增）；裁决失败默认 ADD；embed 缺席
走 ADD 与现行为一致；归档扫描边界（89/91 天、lastConfirmedAt 缺省回落
createdAt、archivedAt 非空跳过）；注入过滤（archived 不进 memoryBlock）；
恢复清 archivedAt；UI 归档组渲染 + 恢复回调。427 既有测试防回归。

## 8. 非目标

- 不做记忆手动编辑（改名/改写内容）。
- 不做记忆向量持久化（量级小，现算即可；与条目 embeddings 表无关）。
- 不做跨设备记忆冲突合并（同步层议题，与本期正交）。
- 不做「忘记 X」意图的语义匹配删除（现 deleteMemory 手动够用）。
