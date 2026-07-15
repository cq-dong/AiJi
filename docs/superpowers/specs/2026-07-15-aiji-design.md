# PRD — AiJi (AI 记)

> 产物：AI 辅助的「记」的工具。不是日记。套用 pm `create-prd` 8 节模板。
> 状态：设计稿，待用户审阅 → 进入 Figma 原型。
> 日期：2026-07-15。

---

## 1. Summary

AiJi（AI 记）是一款移动优先的 PWA「记」的工具：用文本/语音/视频随手捕获**异构**内容（生活片段、跳脱灵感、项目进展……），由云端 LLM（BYOK）自动**涌现**分类与聚合，本地优先存储原始与 AI 处理结果，以「类别地图 / 时间线 / 时间摘要 / 全文搜索」四视图呈现，便于回看与检索。**不是日记**——重点在「记」，条目异构，类别由内容涌现、不预定。

## 2. Contacts

个人项目。Owner：用户本人（兼任产品与开发，AI 辅助批量生成代码）。无外部干系人。

## 3. Background

- **为什么现在**：LLM（Claude 等）分类/摘要质量已成熟可用；STT（Whisper）中文质量够用；PWA + Web Speech + OPFS 让浏览器能采音视频并本地存；BYOK 模式让个人用得起、不经手用户数据。
- **痛点**：现有工具——语音备忘只能单一模态且不整理；笔记 App 多模态弱且分类要手动；日记类只覆盖生活、结构僵化；云笔记数据上云不可控。一个「随手记 + AI 自动整理 + 数据本地 + 多模态统一 + 分类开放涌现」的工具缺失。
- **触发**：名字 AiJi=AI记，定位即「记」而非「日记」。

## 4. Objective

- **目标**：把「随手记」摩擦降到最低（≤2 次点击开录），记完后 AI 自动涌现归类聚合，过后能按类别/时间/搜索快速找回与回看，数据留在本地。
- **Key Results（个人项目，相对指标）**：
  - KR1：从打开 App 到开始记录 ≤2 次点击（语音默认 1 次，切文本/视频 ≤2 次）。
  - KR2：保存后 AI 分类完成 P95 ≤30s（含网络）。
  - KR3：使用 2 周后，能在 ≤10s 内经类别地图或搜索找到一条指定旧条目。
  - KR4：离线时仍可采集+落库，联网后 AI 处理自动补跑、零丢失。
  - KR5：月 API 成本 ≤ ~$40（日均 5 条 + 周聚合）。

## 5. Market Segment(s)

- **为谁**：高频捕获想法与进展的个人使用者——做项目的人、爱记想法的人、记录生活片段的人。
- **约束**：移动端为主、随手记、隐私敏感（日记级内容）、单用户本地优先、不愿被锁定在某云。
- **定义**：按「要记的东西 + 想低摩擦捕获 + 不想自己整理」这组 job 定义，非人口属性。

## 6. Value Proposition(s)

- **JTBD**：当我冒出一个想法 / 记一笔进展 / 留一段生活片段时，我想用最顺手的模态（说/打字/拍）立刻记下，之后不用自己整理就能按类别和时间回看与检索，且数据留在本地不外泄。
- **增益**：多模态统一采集；AI 自动涌现分类+聚合，免手动整理；原始+AI 双存可溯源；本地优先+BYOK 控隐私与成本。
- **避免的痛**：不再因「懒得整理」丢想法；不再因「分类要手动」堆积成垃圾堆；不再因数据上云而不安。
- **优于竞品**：比语音备忘多了 AI 整理；比笔记 App 多了多模态+自动分类；比日记多了非生活类（项目/想法）的开放涌现结构。

## 7. Solution

### 7.1 UX / 流程

- **首页** = 时间线 + 主采集按钮 + 底部导航（时间线 / 类别地图 / 摘要 / 搜索 / 设置）。
- **采集流**：点采集 → 默认进语音录制（可切文本/视频）→ 语音实时预览 → 可选快速归侧面 → 保存 → 条目带「处理中」徽标 → AI 填好即刷新。
- **Share Target**：从系统分享进 App 直成条目（PWA manifest share_target；原生壳下原生分享扩展）。
- **权限**：首次用麦克风/摄像头时解释 + 请求；拒则降级为文本。
- **详情页**：各 part 展示（文本/音频播放器/视频播放器）+ 转写 + AI 面板（类别/标签/侧面/标题/摘要）+ 编辑/重处理/删除。

### 7.2 Key Features

**F1 采集（文本/语音/视频）**
- 混模态/条：一条可含文本块 + 语音片段 + 视频片段（`parts[]`）。
- **默认模态 = 语音**：点采集按钮即开始录音（最低摩擦，首页到开录 = 1 次点击）；文本/视频为可切换的次要模态。
- 文本：多行、自动存草稿、轻量 markdown（加粗/列表）。
- 语音：点一下开始 / 点一下停（语音备忘式）；实时 Web Speech 预览字；波形 + 计时；暂停/继续；默认上限 5 分钟（可配）；停 → 云端 Whisper 出终稿。
- 视频：前后切换；默认上限 ~90s（本地存储 sanity）；停 → 抽音轨 → STT → 视频存 OPFS + 转写存库。
- 快速入口：首页一键开录 + PWA Share Target。
- 心情/情绪：降为**可选侧面**（仅当对某条有意义时才出现），不再作核心采集字段。
- 摩擦目标：首页到开录 ≤2 次点击。

**F2 LLM 分类与打标（涌现）**
- 触发：保存即异步入队，不阻塞采集；条目先以「处理中」徽标出现，AI 完成后刷新。一次保存 = 一次分类调用。
- 每条 AI 产出（`EntryAi`，与原始分离、带版本）：
  - `category` —— 涌现类别：LLM 看内容 + 现有类别库，归入已有或新建。
  - `tags[]` —— 涌现动态标签：喂入已有标签库优先复用而非新建。
  - `facets` —— 可检测侧面（情绪/人物/事件/地点/项目……哪面有意义提哪面），**非预定独立轴**。
  - `titleSuggestion` —— 用户没起标题时 LLM 生成短标题。
  - `summary` —— 一句话条目摘要。
- 涌现 + 去重：不预定大类；auto-dedup（相似度 embedding/编辑距离，近义复用，否则新建）；用户可合并/重命名/新增/挪条目。
- 人工修正：静默覆盖（存为 override，MVP 不反哺 LLM；v2 再考虑带标签示例反哺）。
- 重处理：编辑条目 → 重入队（保留历史版本）；类别库策展变更 → 可批量重分类。
- Prompt：系统提示含当前类别库 + 标签库 + few-shot；输出 JSON；校验后落库。

**F3 聚合与摘要**
- 维度（全 MVP）：时间（日/周/月）+ 类别 + 标签 + 侧面（如情绪期）。
- 时机：按需（打开视图 stale 才重算）+ 日/周自动定时；月按需不自动（省成本）。
- 内容：富摘要 = 主题回顾 + 侧面弧线（如情绪）+ 显眼人物/事件 + 条数 + 挂链代表条目。
- 成本：每聚合上限 ~50 条，超出分批再汇总。
- 失效与重算：`Aggregate` 缓存 + scope 内条数/最后条目时间；stale 则重算。

**F4 呈现与导航**
- **类别地图**：涌现类别卡网格（条数 + 最新摘要片段）；点卡 → 该类别条目（按标签分组）；点标签 → 条目。
- **时间线**（首页默认）：倒序信息流，每卡标题/预览/模态图标/标签/时间。
- **时间摘要**：日/周/月 digest 卡片时间线（日期 + 富摘要），最新在前；点开 → 完整 digest + 挂链条目。
- **全文搜索 + 过滤**：全文搜（文本 + 转写）；过滤按 类别/标签/侧面(如情绪)/日期/模态。
- 情绪轨迹**不单列为核心视图**，降为过滤侧面之一（有条目带情绪时可按情绪过滤/在摘要里看弧线）。

**F5 横切（默认，按用户确认走默认）**
- **Onboarding**：首次引导 + BYOK 填 API key（无 key 则 AI 功能降级、采集+存储仍可用）+ 麦克风/摄像头权限请求。
- **隐私透明**：每条在 AI 处理时显「本次上送云端」标识；设置里可看哪些数据出去了、用了哪个 provider。
- **导出/备份**：导出 markdown + 媒体包（含原始 + AI 处理结果）；可恢复。本地优先 = 数据在设备，备份必需。
- **提醒**：可选每日「记一笔」提醒（默认关）。
- **离线**：采集 + 落库离线可用；AI 处理入可恢复队列，联网补跑、零丢失。

### 7.3 Technology

**栈**：React + Vite + TypeScript + Tailwind + shadcn/ui + Dexie（IndexedDB）+ OPFS（媒体 blob）+ Zustand + TanStack Query。单测 Vitest；E2E 用 Playwright / chrome-devtools-mcp 在移动视口（390×844）驱动。

**架构（分层 + 端口，Capacitor 退路）**：
```
UI 层 (React + shadcn)         纯展示+视图状态，无 I/O
应用层 (Zustand + TanStack Query)  视图状态 / LLM 编排 / 采集→落库→入队
Domain 层 (纯 TS，零 I/O) ★框架无关  条目模型 / 涌现分类规则 / 标签去重合并 / 侧面归一
Port 端口（接口）★PWA 无关        CapturePort / SttPort / StoragePort / LlmPort / SecretStorePort
适配层（PWA 实现）              DexieStorage · WebSpeech+getUserMedia · Whisper云 · Claude云
适配层（Capacitor 实现，预留）    原生 FS · 原生音视频 · 原生 SecureStorage
处理管线（后台、可恢复队列）      保存即落库 → AI 入队；刷新/断网不丢；LLM 失败只伤 AI 层，原始已安全
```

**数据模型（核心实体）**：
- `Entry`：id, createdAt, updatedAt, parts[]（block: type∈{text,audio,video}, content/ref, meta）, moodSelf?(可选侧面), aiVersion?(指向当前 EntryAi)。
- `EntryAi`：id, entryId, version, category, tags[], facets{}, titleSuggestion, summary, modelUsed, promptHash, createdAt。
- `Category`：slug, label, aliases[], usageCount, createdAt（涌现）。
- `Tag`：slug, label, aliases[], usageCount, createdAt（涌现）。
- `Aggregate`：id, scope(type+range), summary(rich), entryIds[], modelUsed, createdAt, version, staleKey。
- `Settings`：llmProvider, apiKeyRef(经 SecretStorePort), sttProvider, reminders, theme...。

**关键隔离**：Domain + Port 不绑 PWA API。若移动端 PWA（iOS/Android）采集/存储不过，只换 CapturePort/StoragePort 的 Capacitor 适配器，UI/Domain/管线不动——退路落地。

### 7.4 Assumptions（最该先验的）

| # | 假设 | 类别 | 信心 | 最便宜验证 |
|---|---|---|---|---|
| A1 | 移动端 PWA（iOS Safari / Android Chrome）能稳定采麦克风/摄像头 | Feasibility | 低 | 1 屏「按住说话」PWA 装到手机（iOS+Android）实测 |
| A2 | 浏览器本地能存视频条目（IndexedDB/OPFS 不被移动浏览器清/不爆配额，iOS 尤甚） | Feasibility | 低-中 | 存 50 条短视频测配额 + 回收（iOS+Android） |
| A3 | 用户真会高频用语音/视频记 | Value | 中 | 上线 2 周看模态占比，<20% 则多模态是伪需求 |
| A4 | LLM 涌现分类质量够、类别/标签不漂移乱 | Value/Usability | 中 | 30 条样本人工 vs LLM 一致率；2 周后看近义标签是否需合并 |
| A5 | 月 API 成本 ≤$40 | Viability | 中 | 实跑 1 月记账 |

- A1/A2 不过 → 动摇「移动优先 PWA + 本地存视频」，走 Capacitor 原生壳（架构已留退路）或砍视频（MVP 先砍）。

## 8. Release

- **MVP**：采集（混模态 + Share Target + 一键开录 + Web Speech 预览 + Whisper 终稿）→ 涌现分类 + 标签 + auto-dedup + 静默覆盖 + 自动标题 → 聚合（按需 + 日/周自动，全维度，富摘要）→ 四视图（类别地图/时间线/时间摘要/搜索）→ 横切（onboarding+BYOK+隐私标识+导出/恢复+离线队列）。A1/A2 的移动端 PWA 验证（iOS+Android）并行做。
- **v2**：Capacitor 原生壳（若 A1/A2 驱动）+ 人工修正反哺 LLM（带标签示例）+ AI 关联线索（跨类别关联条目，second-brain 增值）+ 可选加密云同步 + 提醒与习惯闭环。
- **时间**：MVP 以「周」计（AI 辅助生成），不设死日期；A1/A2 验证先行，结果可能调整 MVP 范围。

---

## 附：决策溯源（brainstorming 锁定项）

| 维度 | 决策 |
|---|---|
| 平台 | 移动优先 PWA + Capacitor 原生壳退路 |
| 数据 | 单用户·本地优先（IndexedDB/OPFS），采集/存储层抽象 |
| LLM | 云端 + BYOK（Claude/OpenAI） |
| 分类 | 涌现：LLM 发现类别+标签，用户可合并/重命名/新增；不预定大类；情绪为可选侧面 |
| STT | Web Speech 实时预览 + 云端 Whisper 终稿 |
| 呈现 | 类别地图 + 时间线 + 时间摘要 + 全文搜索/过滤（情绪轨迹降为过滤侧面） |
| 语言 | 中文 UI/内容 |
| 横切 | onboarding+BYOK / 隐私透明 / 导出备份 / 可选提醒 / 离线队列（默认走） |
