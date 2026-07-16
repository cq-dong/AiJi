# Phase 9 计划 — 待开发项盘点 + 决策

> 来源：2026-07-16 lead 盘点（phase8 F1/F2/F3 之外的 outstanding dev）。供无记忆
> worktree subagent 协调 + 用户决策。决策项由用户拍板后回填本文，再 fan-out。

## 纯代码（无决策，可 fan-out）

- **离线可恢复队列**：`processEntry` 断网/失败重试（PRD §7.3「断网不丢；LLM 失败只伤
  AI 层」）。撞 `store.ts`/`di`——**需独占串行**（不与本批其他 store 改动并行）。方案：
  `entry.status='failed'` 的重试队列 + online 恢复时 flush；D8 重试按钮已有单条路径。
- **PWA 离线壳**：`vite-plugin-pwa` + Service Worker（离线可打开、可安装到主屏）。撞
  `vite.config.ts`/`manifest`——**独立可并行**。
- **localStorageSecrets 加固**：见决策 D5（加密 key 来源未定，阻塞此 item）。

## 需用户拍板（仅用户能定）

- **D1 分享**：settings 微信/QQ 现是占位按钮。**Web Share API**（调原生分享面板，
  零平台集成，iOS/Android 各走系统层）vs **微信/QQ SDK**（需平台注册+审核，重）。
  推荐：Web Share 先、SDK 后置。
- **D2 dark mode**：Phase 6 已存主题切换，但暗色视觉未渲染（全屏 `dark:` token）。
  **现在做**（撞所有屏，高工时）vs **后置**到 MVP 后。
- **D3 capture 视频**：A1 假设（移动端 PWA 能否稳定采视频）未验。**先验 A1**（真机/
  模拟器测 `getUserMedia({video:true})`）vs **直接实现**看跑不跑得通。
- **D4 AI 提醒**：detail `TodoConfirm` + settings「提醒与待办」(现 ChevronRow 占位)。
  触发模型：**Notification API 定时提醒** vs **仅"待办"列表视图**（不做系统通知）。
- **D5 密钥加密**：localStorage BYOK key 现明文存。加密 key 来源——**静态 app key**
  （源码里，等于没加，防不了本地攻击者）/ **WebAuthn 派生**（真安全但重）/ **不做**
  （明文，BYOK 自负）。

## 串行/依赖

- 离线队列独占 `store.ts`——不与 D4（reminder state）并行；二者串行，或 worktree
  隔离 + lead 合并时解冲突。
- dark mode（D2）若做，**单独阶段**（撞全屏 token，不与任何屏并行）。
- D3 视频若直接实现，撞 `capture/` + `webCapture`——**独立可并行**。
- PWA 离线壳独立——可与任何代码项并行。

## lead 集成

- 前置：phase8 verify（STT 重验 + F1 静态审查）LGTM → F3 land → 联合浏览器验收 → push。
- 用户定 D1–D5 + 优先级 → 回填本文 → fan-out 纯代码项（worktree 隔离）→ 串行/合并
  store-touching 项 → 验收 → push。

## 决策结果（2026-07-16 用户拍板）

- D1 分享 = **Web Share API**（非微信/QQ SDK）
- D2 dark mode = **后置** MVP 后
- D3 capture 视频 = **先验 A1**（探针页 `public/video-probe.html` 已建，桌面录制 5s 通过；移动端真机 A1 后置——视频 capture 尚未实现，等真做视频再验）
- D4 AI 提醒 = **Notification 定时提醒**（非仅待办列表）
- D5 密钥加密 = **不做**（明文 BYOK 自负）

## Batch 2a（并行 · worktree 隔离 · 文件域互斥）

- **分享 Web Share**：`src/ui/screens/settings/index.tsx` 微信/QQ 占位按钮 → `navigator.share`（合并为单一「分享」按钮，neutral 色）。
- **PWA 离线壳**：`vite-plugin-pwa` + manifest + autoUpdate SW（`package.json`/`vite.config.ts`/`public/icon-*`）。
- **capture 视频 A1 探针**：`public/video-probe.html` 独立 vanilla 页测 `getUserMedia({video:true})` + MediaRecorder + 约束/错误日志（用户真机开）。

## Batch 2b（串行 · 撞 store.ts/shared core · 2a + phase8 verify LGTM + push 后）

- **AI 提醒（Notification 定时）**：detail `TodoConfirm` + settings「提醒与待办」sheet + LLM 检测提醒项 + reminder 存储 + Notification 调度。大，再拆子任务。
- **离线可恢复队列**：后置（D8 手动重试已够 MVP）；用户要自动重试再启。
