# AI 陪伴化 · P0 设计文档（2026-09-10）

> 目标：把 chat 从「智能问答助手」演进为「长期个人陪伴助手」。本文档记 P0
> 已落地的两件事：① 伙伴人格 prompt 重写；② 每轮自动记忆提取 + 判重 + 开关。
> 后续阶段（记忆生命周期 / 滚动对话摘要 / 主动触达 / embedding 语义召回）未定稿，
> 定稿时另起文档。语义检索决策：**embedding 走云端 API**（经现有 OpenAI 兼容通道）。

## 1. 伙伴人格 prompt（buildAnswerPrompt）

`src/adapters/openAiCompatLlm.ts` 的 answer 轮 system prompt 重写（zh/en 双语同步）：

- 身份：从「智能问答助手」改为「通过用户的『记』条目逐渐了解 TA 的朋友」。
- 新增「陪伴风格」三条：先接住（事实/情绪）再给信息，低落时先共情；合适时跟进
  对话历史/条目/记忆里的事保持延续感（但不每条回复都回问）；把条目当共同记忆
  织进对话而非罗列。
- **事实规范六条原样保留**（引用「（见 <id>）」、citedEntryIds、诚实拒答、不臆造、
  语言指令、JSON 输出 schema）——防幻觉层不动。memoryBlock 注入逻辑逐字节不变
  （aiMemory.test.ts 契约）。
- 「情绪不是轴」铁律不受触：情绪只做回应调制的信号，不进 schema/导航/字段。

## 2. 每轮自动记忆提取（陪伴化的核心行为）

旧行为：仅当用户消息命中「记住 X」类 regex 才调 `extractMemory`。
新行为（store.sendMessage 回答成功落库后，fire-and-forget 不变）：

| 场景 | 行为 |
|------|------|
| 普通对话（autoMemory 开） | 每轮调提取器；提取成功**静默落记忆**（不追加确认消息，免打扰） |
| 显式「记住 X」意图 | 无论开关都提取；成功追加「已记住：…」确认消息（原 UX 保留） |
| `settings.autoMemory === false` | 隐式轮跳过；显式意图仍生效 |
| 缓存命中早返 | 不提取（同问句首次已提取过，省一次 LLM 调用） |

决策理由：
- **静默落 + 设置可审**：隐式提取若每轮弹确认会撕裂聊天节奏；记忆在
  设置→AI 记忆 里全程可见/可停用/可删，透明性不失。
- **显式意图豁免开关**：用户花一句话的力气说「帮我记住」，必须生效——
  「自动」关掉的是被动行为，不是用户意志。

## 3. 判重（knownMemories）

逐轮提取会把同一件事反复记下来。`LlmPort.extractMemory(text, knownMemories?)`
第二参传现有 enabled 记忆原文（新者优先，截 50 条防 prompt 膨胀），提取 prompt
追加判重块：「已记住的内容（无新增信息 → NULL）」。BYOK/builtin 双适配器同透传，
prompt helper 单源（buildExtractMemoryPrompt）保证两路径措辞一致。

## 4. 可记类别扩展

提取 prompt 规则 1 新增：进行中事项/目标（备考/求职/项目节点）、有持续意义的
状态（如「最近睡眠不好」）。一时情绪/一次性琐事明确不记（防记忆池噪声）。

## 5. 成本与开关

- builtin 路径每次提取 `consume('llm', 1)`：自动提取使配额消耗近乎翻倍 →
  设置→AI 记忆新增「聊天时自动记住」开关（`Settings.autoMemory`，undefined=开）。
- 提取 prompt 本身极小（max_tokens 128，temperature 0），BYOK 成本可忽略。

## 6. 测试

- `storeChatMemory.test.ts`：用例2 语义反转（无记住意图→也被调）+ 新增
  隐式静默落 / autoMemory=false 两态 / knownMemories 透传四个用例。
- `extractMemory.test.ts`：判重块有/无 + 不传时逐字节回归（旧 prompt 零漂移）。

## 7. 视觉设计（同日 E2E 验收后补）

E2E（`.e2e_shots/verify-p0.mjs`，Playwright 390×844 + 真实 BYOK LLM）驱动三处视觉改动：

1. **空态伙伴化**：旧「问库里的内容 + 检索示例」是工具语气。改为时段问候
   （早安/下午好/晚上好/夜深了）+ Sparkles 头像徽章 + 「我记着你的条目，也想听你聊聊」
   + 3 个开场建议 chips（「今天过得怎么样？」等），点击填入输入框并聚焦、不直接发送。
   设计原则：无插画无营销感，对话感优先。
2. **记忆回执与对话气泡分化**：`ChatMessage.kind='memoryConfirm'` 渲染为居中安静胶囊
   （Sparkles + bg-priS/text-pri，12px），不再与伙伴发言同构——系统回执 ≠ 伙伴说话。
3. **修复存量缺陷·隐私提示条叠字**：提示条（y92-109）无背景且层级低于其后的滚动容器，
   滚动时被截半行的气泡会在同一行带内与提示文字像素级叠印（E2E 截图复现）。
   修法：提示条加 `relative z-10 bg-page pb-1.5` 盖住滚动区顶缘。
