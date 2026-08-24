# AiJi 商店上架素材清单

> 本文件包含华为应用市场、Google Play 等商店上架所需的文案与说明。建议按表格逐项复制粘贴。

---

## 1. 基础信息

| 字段 | 内容 |
|------|------|
| 应用名称（中文） | AI 记 |
| 应用名称（英文） | AiJi — AI Note |
| 包名 | `com.cqdong.aiji` |
| 应用分类 | 工具 > 效率 / Productivity |
| 开发者 | 董成麒（Chengqi Dong） |
| 联系邮箱 | （建议填写你的真实邮箱，如 ustc 邮箱） |
| 隐私政策 URL | `https://cq-dong.github.io/AiJi/privacy-policy.html` |
| 支持语言 | 简体中文、English |

---

## 2. 应用简介（短描述，≤80 字）

**中文**
AI 记是一款本地优先的全模态记录工具：文字、语音、照片、视频随时捕获，AI 自动分类与摘要，让记录不再散落。

**English**
AiJi is a local-first, full-modal note-taking app. Capture text, voice, photos, and video — AI organizes and summarizes for you.

---

## 3. 应用描述（长描述，推荐 500–1000 字）

**中文**
「AI 记」（AiJi）是一款通用的「记」的工具。它不是传统日记，而是帮你随时捕获生活片段、跳脱想法与项目进展的随身助理。

核心特性：
• 全模态捕获 —— 文字、语音、拍照、录像，一键记录不中断。
• AI 智能整理 —— 大语言模型自动发现类别、提取摘要、生成标签与情绪，无需手动归类。
• 本地优先存储 —— 所有内容默认保存在设备本地 IndexedDB，断网也能用，隐私不外流。
• BYOK 灵活接入 —— 支持自带 API Key（OpenAI / DeepSeek / 通义等），也可使用内置代理，选择权在你。
• 时间摘要 —— 按日、周、月自动生成回顾，帮你看见自己的节奏。
• 智能提醒 —— 自然语言建立提醒，到点准时推送。
• 问答助手 —— 向自己的记录库提问，AI 基于本地内容作答，不改动原始条目。

AI 记采用现代 Web 技术构建（React + Capacitor），兼顾 PWA 与原生体验，让跨端记录无缝衔接。

**English**
AiJi is a universal "note" tool — not a traditional diary, but a capture assistant for life fragments, fleeting ideas, and project progress.

Key features:
• Full-modal capture — text, voice, photo, and video in one tap.
• AI-powered organization — LLM auto-discovers categories, summaries, tags, and moods.
• Local-first — all content stored in device IndexedDB; works offline.
• BYOK — bring your own API Key (OpenAI, DeepSeek, Tongyi, etc.) or use the built-in proxy.
• Time summaries — daily, weekly, monthly retrospectives generated automatically.
• Smart reminders — set reminders in natural language with exact-time notifications.
• Ask AI — query your own note library; AI answers based on local content without altering entries.

Built with React + Capacitor for a seamless cross-device experience.

---

## 4. 权限说明（上架审核必填）

| 权限 | 用途说明（中文） | 用途说明（英文） |
|------|------------------|------------------|
| `INTERNET` | 访问网络以同步账号、调用 AI 服务与语音转写 | Required for account sync, AI services, and speech-to-text |
| `RECORD_AUDIO` | 采集语音用于语音转文字录入 | Capture voice for speech-to-text input |
| `MODIFY_AUDIO_SETTINGS` | 确保 WebView 音频录制路由正确 | Ensure correct audio routing during WebView recording |
| `CAMERA` | 拍摄照片或视频并添加到记录 | Take photos/videos and attach to entries |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | 为记录附加地理位置信息（可选，默认关闭） | Optional geo-tagging for entries (off by default) |
| `POST_NOTIFICATIONS` | 在设定时间发送提醒通知 | Send reminder notifications at scheduled times |
| `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM` | 确保提醒在 Doze 模式下也能准时触发 | Ensure reminders fire exactly on time, even in Doze mode |
| `REQUEST_INSTALL_PACKAGES` | 应用内检测新版本并引导系统安装（仅在用户主动确认时触发） | In-app update prompt; only triggered with user confirmation |

---

## 5. 更新日志模板（首次上架）

**v2.5.1**
- 首发版本，包含全模态记录、AI 分类摘要、时间线回顾、智能提醒、问答助手等核心功能。
- 支持本地账号与云端账号双模式。
- 支持 BYOK（自带 API Key）与内置代理两种 AI 接入方式。

---

## 6. 截图文件清单

所有截图存放于 `release/store/screenshots/`，共 5 张核心场景：

| 序号 | 文件名 | 场景 | 尺寸 |
|------|--------|------|------|
| 1 | `01-home.png` | 首页时间线 | 1000×1412 |
| 2 | `02-capture.png` | 采集录入 | 1000×1407 |
| 3 | `03-detail.png` | 条目详情与 AI 分析 | 1000×1429 |
| 4 | `04-categories.png` | 类别地图 | 1000×1407 |
| 5 | `05-summary.png` | 时间摘要 | 1000×1407 |

> 注：华为应用市场对截图尺寸无强制像素要求（320–2560px 均可），以上截图符合规范。如后续需要 1080×1920 精修版，可在模拟器重新截取。

---

## 7. 图标文件

- `release/store/icon-512.png` — 512×512 PNG，源自现有自适应图标素材高清重采样，可直接用于商店提交。

---

## 8. 待办阻塞项（需要你确认/补充）

| 阻塞项 | 状态 | 说明 | 建议行动 |
|--------|------|------|----------|
| 华为开发者账号 | ✅ | 已注册完成 | — |
| 后端 HTTPS / 域名 | 🔄 | 域名已购买：`aiji.site`。需解析 A 记录到 `106.54.26.195`，服务器执行一键脚本启用 HTTPS | 1. 腾讯云控制台添加 A 记录 → 2. SSH 执行 `./setup-https.sh aiji.site` → 3. 验证 `curl https://aiji.site/health` |
| 开发者联系邮箱 | ⏳ | 隐私政策与商店需要真实可联系的邮箱 | 填写你的 USTC 或常用邮箱 |
| `REQUEST_INSTALL_PACKAGES` 权限 | ⏳ | 华为可能要求移除应用内自更新 | 上架华为版时，在 `AndroidManifest.xml` 中临时注释掉该权限行（见下方说明） |
| Google Play 账号 | ⏳ | 需 $25 + 可支付美元的信用卡 | 按需注册 |

### 华为版 `REQUEST_INSTALL_PACKAGES` 处理

华为应用市场通常不允许应用内自更新（有自己的应用更新机制）。在提交华为审核前，临时注释掉该权限：

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<!-- 注释掉以下行： -->
<!-- <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" /> -->
```

这样不会影响其他渠道（Google Play / 侧载）的正常使用。如果后续需要同时维护多渠道，建议使用 build flavor 区分。

> **注意**：当前你只有一个 `.env.production`，CI 构建时所有渠道的 APK 都会用同一个后端地址。如果后续需要区分国内/海外渠道（不同域名），需要配置 build flavor 和多个 env 文件。

---

*生成时间：2026-08-24*
