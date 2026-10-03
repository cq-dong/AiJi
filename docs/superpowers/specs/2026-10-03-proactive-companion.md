# P-D 陪伴化：应用内主动触达（2026-10-03）

> 前置：P0（人格）/ P-B（语义召回 + 滚动摘要）/ P-C（记忆生命周期）。
> 现状伙伴完全被动——用户不开口它不存在。陪伴感的另一半是**它先开口**。
> 第一版只做应用内触达：iOS PWA 无 Web Push，系统级推送留待 Capacitor 壳。

## 1. 两个触点

### 1.1 开屏问候（home 顶部卡）
打开 App 进 home 时，若距上次问候 ≥ 6 小时，伙伴主动说一句话。
内容依据（按可得性拼装 context，**不瞎编**）：
- 时段（早/下午/晚/深夜）
- 最近 7 天条目数、最近一条距今天数
- enabled 未归档记忆中的「进行中」线索（原文注入，LLM 自己判断相关性）
- 对话 rollingSummary（有则注入，承接上次聊天）
- 今天到期/已逾期的 reminders 条数

例：「三天没记了，上周说的那个方案后来怎么样了？」

### 1.2 关怀卡（同一张卡的第二形态）
无特别可说的时段 → 轻量模板（不调 LLM）：「今天有什么想记的？」
**一张卡两种形态**：LLM 问候优先，失败/无料 → 模板兜底，卡片骨架一致。

## 2. 端口：`LlmPort.proactiveGreeting`（必需方法）

```ts
proactiveGreeting(context: {
  daypart: 'morning' | 'afternoon' | 'evening' | 'night'
  recentEntryCount7d: number
  daysSinceLastEntry: number | null   // null = 从未记过
  openLoops: string[]                 // enabled 未归档记忆原文（≤5 条截断）
  rollingSummary?: string
  dueReminderCount: number
}): Promise<string | null>            // null = 无特别可说 → 调用方走模板
```

- prompt helper `buildProactiveGreetingPrompt`（zh+en 单源，双适配器共享 import）。
  指令：以伙伴人格写一句主动问候，≤40 字；有可承接的具体线索就承接，没有
  输出 NULL；不编造 context 里没有的事；不用问号轰炸，最多一个问题。
- max_tokens ~80，temperature 0.7（问候比事实任务要一点温度）。
- BYOK chat completions / builtin chat() + consume('llm', 1)。
- 失败抛错 → 调用方兜底模板卡，console.warn。

## 3. 触发、频控与缓存

- **触发点**：home 屏 mount（entries 已 hydrated 后）。只此一处。
- **频控**：`lastGreetingAt`（localStorage kv，非关键状态不进 Dexie）——
  距上次 < 6h 直接不渲染卡（模板卡也不出，避免变成常驻噪音）。
- **当日缓存**：同日同时段（date+daypart）内重复进 home 不重复调 LLM——
  localStorage 存 `{key: 'YYYY-MM-DD:daypart', text}`，命中直接用。
- **dismiss**：卡片可划走/点 ×，当日不再出现（dismissedKey=date）。
- LLM 不可用（keySource 无配置/网络失败）→ 模板卡（仍受 6h 频控）。

## 4. UI

home 顶部、问候语区之下插入 `CompanionCard`：
- 样式：bg-priS 底 + 伙伴头像占位（圆形 pri 底白字「记」）+ 一句 13px 文本 +
  右侧 × 关闭。圆角 rounded-card，与现有卡片体系同 tokens。
- 入场：fade-in（framer-motion 现有模式）；无自动消失。
- 点击卡片 → 跳 /chat（带问候上下文？——v1 直接跳，不带）。
- i18n：`home.companion.fallback`（模板句）+ `home.companion.aria` 等 zh/en。

## 5. 任务拆分（lead 契约 → 2 路并行）

**Lead 契约 commit**：ports（proactiveGreeting 签名）+ di 透传 + 适配器桩 +
i18n stub。
- **A（src/adapters/）**：buildProactiveGreetingPrompt 双语 + 双适配器实现 + 测试。
- **B（src/app/ + src/ui/screens/home/）**：greeting 编排（context 拼装/频控/
  当日缓存/dismiss/fallback）+ CompanionCard 组件 + home 挂载。store/纯函数
  逻辑抽 src/app/proactive.ts（可测）。
- **验收 agent**：静态审（频控边界/缓存键/降级）+ 浏览器联测（真 key 开屏
  问候、6h 内不再出、dismiss 当日不出、LLM 挂掉模板兜底）。

## 6. 测试要点（TDD）

prompt 双语 + NULL 指令；context 拼装（daysSinceLastEntry 计算/openLoops ≤5/
dueReminderCount）；频控 6h 边界；当日缓存键 date+daypart；dismiss 当日；
LLM 返 null → 模板；LLM 抛错 → 模板 + warn；daypart 分时段边界；
UI 渲染（问候形态/模板形态/关闭回调/点击跳 /chat）。既有测试防回归。

## 7. 非目标

- 不做系统推送（iOS PWA 无 Web Push；Capacitor 壳后另议）。
- 不做定时后台生成（仅开屏触发）。
- 不做卡片内嵌操作按钮（v1 只跳 /chat）。
- 不做多卡片流（一张，当日一张）。
