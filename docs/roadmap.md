# AiJi · 开发路线图

> 最后更新：2026-07-17。MVP 范围见 PRD `docs/superpowers/specs/2026-07-15-aiji-design.md`（§7.3）。
> 本文件固化「已完成 / 在做 / 后置」三态，方便用户 + 未来 agent 查。状态变就更新本文。

## 当前状态：MVP 功能完备

核心闭环 + AI 提醒已跑通并验收：**记 → 采音/文本 → STT → 落库(Dexie+OPFS) → AI 分类/聚合 → 各屏查看 → 导出/分享**，外加 **AI 提醒**（前台 Notification 定时：LLM 识意图 → 用户确认 → 调度 → 到点 fire / 错过补推·标 missed）。

架构分层全部到位：UI(React) / app(Zustand+TanQuery) / Domain(纯 TS) / 5 端口(Capture/Stt/Storage/Llm/SecretStore) / PWA 适配(DexieStorage · webCapture · DashScope STT · DeepSeek Llm · localStorage secrets) / 处理管线（保存即落库 → AI 入队 → 分类 → 聚合，断网不丢，LLM 失败只伤 AI 层）。

## 已完成

### 主干 Phase 0-6
- **Phase 0**：脚手架（React 19 + Vite + TS strict + Tailwind + Zustand + TanQuery + Dexie）+ `CLAUDE.md` 工程自述（`3ae06c2` / `14b621f`）
- **Phase 1**：24 屏 UI 层（home/capture/detail/categories/search/summary/settings/onboarding，Figma→代码，5 并行子智能体铺屏）
- **Phase 2**：Dexie StoragePort 落库（`1341c9a`）
- **Phase 3**：PWA CapturePort — getUserMedia 麦克风 + WebSpeech 实时 STT（`3ce81b6`）
- **Phase 4**：OPFS 存音频 blob + 详情播放（`acda250`）
- **Phase 5**：真文本输入 sheet，去 SAMPLE_TEXT mock（`37d7a36`）
- **Phase 6**：settings theme/recordLocation 持久化（`ae8808d`）

### 收尾 + 2a（Phase 8 + Batch 2a）
- STT 静音修复（AudioBufferSourceNode 必须 `src.start()` 才出声）+ summary 真聚合 + dedup + skip-when-fresh 守卫
- processEntry 标 stale 修复（MAJOR-3：新条目让当日摘要过期，须置 stale 才能穿过守卫）
- F2：.zip 导出（手写 STORE+CRC32，无新依赖，`38f6b99`）
- F3：调试态清理（DemoToggle / `?demo=` gate / `__aiji` DEV hook 全去，`d67532f`）
- D1：Web Share API（替代微信/QQ 占位，`06a5506`）
- PWA 离线壳（vite-plugin-pwa + manifest + 192/512 icons + autoUpdate SW，`e019ffb`）
- A1：视频采集探针页 `public/video-probe.html`（getUserMedia+MediaRecorder，桌面录 5s 通过，`cc31712`）

## 已完成：Batch 2b · AI 提醒（MVP 功能完备）

> 详见 `docs/acceptance/phase9-batch2b.md`。用户拍板 Q1-Q4：前台 only / LLM 解析时间用户确认 / 错过补推·>1h 标 missed / 首次确认请求权限。

| 子任务 | 内容 | 状态 |
|---|---|---|
| B1-B3 | Reminder 类型 + Dexie v3 + StoragePort 4 方法 + seed | done（`7e7259f`） |
| B4 | LLM 识别提醒意图 → `reminderSuggestion`（绝对 ISO + label） | done（`8538a6a`） |
| B5+B8 | store 调度（reminders state / hydrate / scheduleReminders / confirm·dismiss·snooze）+ Notification 适配 + di 接线 | done（`8dc081a`） |
| B6 | detail 确认提醒卡（预填 dueAt+label，可改） | done（`49ff619`） |
| B7 | settings 提醒与待办 sheet（list pending / dismiss / snooze 10min） | done（`903042e`） |
| 收尾 | 联合浏览器验收（确认→Notification fire / reload 不丢 / 错过策略） | done · LGTM（2026-07-16） |

验收 LGTM（2026-07-16）：6 项行为测试（卡片渲染 / 确认流 / Notification fire / reload 持久 / 错过策略 / snooze+dismiss）+ 4 项 store 不变量（timeout 去重 / fire 前 re-check / Q3 阈值 / processEntry 不自动建）全 pass，无 console error。

**打磨回合（2026-07-16，LGTM 后 polish）**：修 3 处 correctness minor——(1) `confirmReminder` 清掉 EntryAi.reminderSuggestion 防 reload 后卡片重现/重确认建重复（含深链直达 detail、hydrate 前 aiByEntry 空时从 Dexie 取 AI 再清）；(2) `snoozeReminder` 锚定 `max(now, dueAt)` 防稍后提醒把未来到点提醒往前挪；(3) `deepSeekLlm` 传本地带偏移 ISO 给 LLM（原 UTC `Z` 无时区信号，相对时间解析偏移会错）。余 a11y/UX minor（label-input 关联、空 datetime guard、formatDueAt 防错、dead STATUS_LABELS、comment rot）留后续打磨轮。

## 后置 / 不做（用户已决策，2026-07-16）

| 项 | 决策 | 备注 |
|---|---|---|
| 离线可恢复队列（自动重试） | 后置 | D8 手动重试按钮已够 MVP；用户要自动重试再启 |
| dark mode | 后置到 MVP 后 | 撞全屏 `dark:` token，单独阶段做（不与任何屏并行） |
| capture 视频 | 后置 | 探针页已建 + 桌面通过；移动端真机 A1 等真做视频再验 |
| 密钥加密 | 不做 | 明文 BYOK 自负（D5：静态 app key 等于没加；WebAuthn 派生太重） |

## 待验假设（PRD §7.4，可能改 MVP 范围）

- **A1**：移动端 PWA（iOS Safari / Android Chrome）能否稳定采麦克风/摄像头。桌面已通过；移动端真机随视频功能一起验。
- **A2**：浏览器本地能否存视频（IndexedDB/OPFS 不被清/不爆配额，iOS 尤甚）。随 A1。
- A1/A2 不过 → 走 Capacitor 原生壳（架构已留退路：Domain+Port 不绑 PWA API，移动端只换 CapturePort/StoragePort 的 Capacitor 适配器，UI/Domain/管线不动）或砍视频。

## Wave 3 已完成（2026-07-17，7 条用户反馈，验收 LGTM）

摘要倒序+5 级详细度 · 采集工具栏合并+语音不夺屏 · 标题可编辑 · 清空/草稿 · 搜索上移顶栏 · 提醒独立 tab · dev key 默认填充。缺陷 D1/D2/D3 全修。详见 `docs/acceptance/defects.md`。

附带修复：STT 繁体→简体（WebSpeech 在部分系统忽略 `lang='zh-CN'` 仍出繁体，`webCapture.ts` 的 `onInterim`/`onFinal` 统一 `t2s` 转简体；同时修好保存的 transcript，因 `stopRecording` 存的是 `finalized+interim`）。

## Wave 4 候选（用户提议，2026-07-17，待规划）

> 用户手机实测后新提，未排期、未设计。需先逐条过产品铁律（§1）再 fan-out。

| 项 | 描述 | 依赖/风险 |
|---|---|---|
| 单条导出/分享 | 单条记录支持导出 + 分享（现仅有全局 .zip 导出 F2） | 详情页加 share sheet（文本/图片）；无 schema 风险 |
| 同类小类聚合 | 大类内同 sub-category/facet 的条目聚一块（如同一项目不同时间的进展聚在一起） | categories 屏分组逻辑改；facet 已有（project/person/place/event） |
| 草稿视图 | 类别地图加「草稿」入口，点击恢复继续记 | Draft 表已就绪（Wave 3 S3）；需列表 UI + 恢复进 capture |
| 回收站（30 天找回） | 软删 + 30 天可恢复 | **新 schema**：Entry 加 `status:'deleted'`+`deletedAt`，Dexie 加清理任务；现 status 无 deleted 态 |
| 更多视图（类别地图多视图化） | categories 屏从单列表升级为多视图（按类别/按时间/按 facet…） | categories 屏重构；视图切换 UI |
| 心情视图 | 「类别地图」加 mood 视图（按 facets.mood 聚类） | ⚠️ **触碰 §1 铁律「情绪不是轴」**——见下 |

### ⚠️ 待用户决策：心情视图是否违反「情绪不是轴」铁律？

CLAUDE.md §1：情绪只是可选侧面，**不当独立导航轴、不当强制采集字段**。用户 2026-07-15 两度纠正过此事。

「心情视图」两种解读，需用户拍板：
1. **facet 透镜之一**（推荐，不违规）：mood 作为 facets 的一个可选视图镜头（与 project/person/place 视图并列），用户主动切入才看，不强制、不进主导航。≈「情绪是可选侧面」的合法体现。
2. **导航轴**（违规）：mood 作为常驻侧栏/主分类轴。违反 §1。

若采 (1)，「心情视图」只是「更多视图」里 facet-lens 的一种，可与 project/person/place 视图一起做。需用户确认后进 Wave 4 设计。
