# 更新日志

> **约定**：每开一条新分支，在本文档追加一段，写明「相比父分支主要更新了什么功能」。格式：
>
> ```
> ### <分支名>（基于 <父分支>，<日期>）
> **主要更新**
> - <功能点 1，附 commit 短码>
> - <功能点 2>
> **后续 / 待办**
> - <本分支未完成或留给下条分支的>
> ```
>
> 2026-10-09 起由 README 迁至本文件。

### v2.5（基于 v2.0，2026-08 ~ 2026-10）

**主要更新**——账号系统 + 云同步 + AI 陪伴 + 性能优化

- **账号系统**：注册 / 登录（JWT 双 token）、套餐与配额（plan / quota）；httpAuth / httpPlan / httpQuota 云端适配 + localAccount 本地兜底（`feat/network-register`）
- **云同步 Phase 2**：sync_rows / outbox / tombstone / 离线补传，local-first 全量服务器同步（Hono server `sync.ts` 路由 + `syncHttp` 适配器）
- **AI 陪伴问答**：意图驱动查询管线（recall / weather / search / action + ActionConfirmBubble 确认卡）；天气 / 网页搜索（Tavily）适配器；SSE 流式回答（BYOK + builtin 双链路贯通）（`55a6769` / `14cc23e` / `e3d2ed0`）
- **语义召回 + 滚动摘要**：db v10 embeddings 表、embed? / summarizeConversation 端口、knownMemories 记忆去重；记忆生命周期 + 主动触达（`571221d` / `a3c79c7` / `fd28996` / `74d8f2d`）
- **录音豆集成**：RecordingDonglePort + mock 驱动（Anker 黑客松；硬件缺席下仍可全速推进并可测试）
- **性能**：mediaCache 两级 blob 缓存（LRU CAP=60）+ 主页窗口化（PAGE=30）（`5f9e97f` / `d56bd65`）
- **zip 导入 / 系统分享**：zipImport 适配器 + shareTarget 屏
- **工程债波（E2）**：llmShared 抽取（openAiCompatLlm 收敛）、store 拆分（reminderScheduler / chatHelpers / processEntry 迁出）、适配器测试补差 41 例
- **体验修复**：citedEntryIds 泄露修复（`29ff193`）、主页视频缩略图（`4e8f1b4`）、「今天」锚定真实系统时钟（`cbf6d96`）

**后续 / 待办**

- v2.5.2 正式版发布（当前 rc13 真机验证中）
- 移动端 A1/A2 假设持续验证（麦克风 / 摄像头 / IndexedDB 配额，iOS 尤甚）
- dark mode（后置）

### v2.0（基于 v1.5，2026-07-20）

**主要更新**——Android 原生壳 + GitHub 分发 + 应用内自更新 + 真机缺陷全量修复

- **Capacitor APK 壳 + GitHub Actions CI 发版**：PWA 包进 Capacitor Android 壳（`com.cqdong.aiji`，androidScheme https），tag `v*` 触发 CI 自动构建 APK 上传 Release（`307bfab`）
- **应用内自更新**：`AppUpdatePort` 端口 + 平台分流适配器；自定义 `ApkInstaller` 插件（OkHttp 原生下载绕 CORS + FileProvider 拉起系统安装器）；设置页「关于 AiJi」检查最新版 + 一键下载安装（`307bfab` / `8c9dea8`）
- **品牌图标 + 开屏页**：app icon / splash 打入 APK 资源，含开源信息与免责声明（`6b9692a`）
- **release 签名**：release keystore 存 GitHub secret + 本机备份，固定签名修覆盖安装冲突（`b3f8d60`）
- **使用反馈**：设置页 → /feedback 多建议 + 图片 → GitHub Issue（孤儿分支存图 + contents API，token CI 烘进 APK）（`3aed618` / `9199108` / `44f1d45`）
- **内置高德地理编码 Key**：开箱即用地址解析，免用户自配（`7f51227`）
- **AI 问答深度优化**：召回加地点面 + facets 多面搜索 + 实体抽取 + 自然对话 prompt + 思维链可展开（理解→检索→组织，默认折叠）+ 真实错误原因 + 抗截断容错（`1758945` / `8c32780` / `4a4b5f5`）
- **多模态摘要附媒体内容**：摘要末尾附「图片内容：xxx / 视频内容：xxx」；类别地图地点聚类（`7cf5d03` / `33480b2`）
- **提醒 heads-up 横幅**：自建 `HeadsUpNotifier` Capacitor 插件（`PRIORITY_HIGH` + `IMPORTANCE_HIGH` + AlarmManager exact 排程），绕过 `@capacitor/local-notifications` 写死 `PRIORITY_DEFAULT` 不弹横幅的根因；前后台/被杀均触发（`f3fc921` / `ceae6ae`）
- **GitHub API 403 修复**：原生平台走 `CapacitorHttp` 绕 WebView User-Agent 限制（`33480b2` / `151d4f9`）
- **SW 缓存致更新后首启显旧版修复**：原生壳注销 PWA Service Worker，每次从 APK 文件系统加载最新 bundle（`4a4b5f5`）
- **真机缺陷全量修复**：D1-D30 共 30+ 条真机回归（安全区原生注入 / 通知声音 / 权限流程 / 铺屏比例 / 地址 / 失败重试 / 提醒弹窗 等）（`0926f9c` / `4d7bb1b` / `840e089` / `4ae8b15` / `0948a8b` / `f1d2d33` / `930c6e0`）

**后续 / 待办**

- 移动端 A1/A2 假设持续验证（麦克风 / 摄像头 / IndexedDB 配额，iOS 尤甚）
- 账号系统实装（设计见 `docs/design/account-system.md`）
- dark mode（后置到 MVP 后）

### v1.5（基于 main，2026-07-17）

**主要更新**

- **AI 检索问答**：两轮 LLM + 本地召回 + markdown 渲染 + 语音输入（`c047e38`）
- **多模态视觉 + 通用 BYOK + STT 双模**：图片采集 + VLM 视觉分类；统一 BYOK 密钥管理；DashScope Paraformer WS STT + WebSpeech 双模（`0f54c56`）
- **独立 VLM 端点 + 自定义模型下拉**：视觉分类走单独 VLM 端点，模型可选（`adfddcb`）
- **采集重设计 + 提醒创建三联修 + chat 语音 + 各屏打磨**：WIP checkpoint（`4ef0b16`）
- **按类别 .zip 导出**（`18b7fb6`）
- **账号系统设计文档 + app icon / splash 规格 + 发布研究**（`8d4ff5d`）
- **根目录测试截图归档 + gitignore + CLAUDE.md 协作铁律 + 应用图标**（`6b1e6ea`）

**后续 / 待办**

- 账号系统实装（已在 `worktree-feat-account-system` 分支开工，设计见 `docs/design/account-system.md`）
- 移动端真机 A1/A2 验证（麦克风 / 摄像头 / IndexedDB 配额，iOS 尤甚）；不过则走 Capacitor 原生壳或砍视频
- dark mode（后置到 MVP 后，单独阶段做）

### v1.0（初始版本，2026-07-15）

**主要更新**

- 脚手架：React 19 + Vite + TS strict + Tailwind + Zustand + TanQuery + Dexie
- 24 屏 UI 层（Figma → 代码，5 并行子智能体铺屏）
- Dexie StoragePort 落库 + OPFS 存音频 blob + 详情播放
- PWA CapturePort（getUserMedia 麦克风 + WebSpeech 实时 STT）
- settings theme / recordLocation 持久化
- Elevated-soft 质感打磨（tokens + primitives + 全屏 polish）
- AI 提醒 MVP（LLM 识意图 → 确认 → 调度 → Notification fire / 错过补推）
- .zip 导出 + Web Share API + PWA 离线壳

详见 `docs/roadmap.md`。
