# AiJi 演示视频制作交接文档

> 目标：制作 5 分钟以内的演示视频，完整展示 AiJi 核心功能，用于 2026 鸿蒙高校创新赛初赛提交。
> 命名格式：`02-演示视频+随手记.mp4`

---

## 一、比赛背景

- **赛事**：2026「中国高校计算机大赛—人工智能创意赛」鸿蒙赛道
- **方向**：应用创新
- **团队**：随手记（队长：董成麒，中国科学技术大学）
- **作品名称**：AiJi —— 教一次就懂你的 AI 随手记
- **初赛截止**：2026/07/26 23:59（已报名+提交作品说明文档 PDF）
- **演示视频要求**：MP4，5分钟内完整展示核心功能

## 二、一句话创意

> AI记忆驱动涌现分类与对话检索的全模态随手记

## 三、产品定位

AiJi（AI 记）= 通用的「记」的工具，**不是日记**。条目异构：生活片段、跳脱想法、项目进展、待办提醒——什么都能记。

核心差异化：
1. **涌现分类**：不预设分类体系，LLM 从每条内容自动发现类别/标签/情绪/提醒意图，类别随内容涌现
2. **AI 记忆**（最大创新）：用户显式教 AI 规则（如"螺蛳粉归美食类"），规则贯穿分类与问答，教一次一直受用
3. **对话检索**：自然语言问库，双轮 LLM 带思维链，有据可引
4. **本地优先**：数据存端侧，密钥不下发，AI 调用经自有代理

## 四、项目启动方式

### 前端 dev 服务

```sh
cd /Users/dcq/Desktop/AionUiSpace/AiJi
npm run dev          # http://localhost:5173（视口 390×844 调试）
```

### 后端服务（如需联动真实 AI 功能）

```sh
cd /Users/dcq/Desktop/AionUiSpace/AiJi/server
npm run dev          # http://localhost:8787
```

### 环境变量

- 前端 `.env.local`（已配好）：`VITE_LLM_KEY`、`VITE_STT_KEY` 等 BYOK 密钥
- 后端 `server/.env`（已配好）：`JWT_SECRET`、`DEEPSEEK_KEY`、`DASHSCOPE_KEY`、`GAODE_KEY` 等
- 前端通过 `VITE_AIJI_BACKEND=http` 切换 mock/真实后端适配器

### 其他命令

```sh
npm run build        # tsc -b && vite build（生产构建）
npm run typecheck    # tsc -b（类型检查）
npm run test:run     # vitest run（跑测试，94项）
npm run lint         # oxlint
```

### Android APK

已有可安装 APK（v2.0.1），Capacitor 打包，appId: `com.cqdong.aiji`

## 五、技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | React 19 + TypeScript 6 (strict) |
| 构建 | Vite 8 |
| 样式 | Tailwind v3 + CSS 变量主题 |
| 路由 | react-router-dom 7 |
| 状态 | Zustand 5 |
| 数据查询 | TanStack Query 5 |
| 本地存储 | Dexie 4 (IndexedDB)，10 张表，v8 schema |
| 移动端 | Capacitor 8 (Android) |
| PWA | vite-plugin-pwa (Service Worker) |
| 后端 | Hono + better-sqlite3 + jose (JWT)，Node >=22 |
| AI 服务 | DeepSeek LLM / DashScope Paraformer STT / qwen-vl VLM |
| 测试 | Vitest 4 (94项单测) |
| 图标 | Lucide React |
| i18n | 自建双语系统 (zh/en，13 个命名空间) |

## 六、架构分层

```
UI 层 (React)               纯展示+视图状态，无 I/O
应用层 (Zustand+TanQuery)    视图状态 / 编排 / 采集→落库→入队
Domain 层 (纯 TS，零 I/O)    条目模型 / 涌现分类规则 / 标签去重
Port 端口 (10 个接口)        Storage/Capture/Stt/Llm/SecretStore/AppUpdate/LocalNotifications/Feedback/Auth/Quota/Plan
适配层 (PWA 实现)            Dexie·WebSpeech·Paraformer·DeepSeek·builtinProxy
处理管线 (后台、可恢复)       保存即落库→AI 入队；断网不丢；LLM 失败只伤 AI 层
```

**关键隔离**：Domain + Port 不绑 PWA API。同一套代码已在 PWA / Capacitor Android / 服务端代理三态验证。鸿蒙化只需换适配器。

## 七、路由结构

### 主路由（有底部导航 + 采集 FAB）

| 路径 | 屏 | 说明 |
|------|------|------|
| `/` | Home | 首页时间流 |
| `/categories` | Categories | 涌现分类地图 |
| `/summary` | Summary | 时间聚合摘要 |
| `/search` | Search | 搜索 |
| `/reminders` | Reminders | 提醒列表 |
| `/settings` | Settings | 设置（含 AI 记忆管理） |

### 裸路由（仅状态栏，无底部导航）

| 路径 | 屏 | 说明 |
|------|------|------|
| `/capture` | Capture | 多模态采集（文本/语音/图片） |
| `/detail/:id` | Detail | 条目详情 + AI 面板 |
| `/chat` | Chat | AI 对话检索 |
| `/onboarding` | Onboarding | 引导页 |
| `/login` | Login | 登录/注册 |
| `/drafts` | Drafts | 草稿箱 |
| `/trash` | Trash | 回收站 |
| `/feedback` | Feedback | 使用反馈 |

## 八、核心功能列表（演示视频建议覆盖）

### 必须展示（核心创新）

1. **多模态采集**（/capture）：文本输入 + 语音实时转写 + 图片拍照/选择，混合在同一条目
2. **涌现分类**（/categories）：AI 自动发现类别，用户可合并/重命名/新增
3. **AI 记忆**（/settings 中的记忆管理）：添加规则 → 后续分类自动应用
4. **对话检索**（/chat）：自然语言提问，思维链推理过程可见，引用具体条目
5. **条目详情 AI 面板**（/detail/:id）：展示 AI 生成的分类/标签/情绪/摘要

### 建议展示

6. **提醒意图识别**（/reminders）：记录中提到时间 → 自动弹出提醒确认
7. **时间摘要**（/summary）：按日/周/月聚合，可调详细度
8. **本地优先 + BYOK**（/settings）：密钥配置、数据导出
9. **草稿箱 + 回收站**（/drafts, /trash）：30天软删恢复
10. **搜索**（/search）：全文搜索

### 可选展示

11. 引导页（/onboarding）
12. 登录/注册（/login）
13. 使用反馈（/feedback）
14. 应用内更新

## 九、目录结构速查

```
/Users/dcq/Desktop/AionUiSpace/AiJi/
├── src/
│   ├── domain/          # 纯 TS 领域模型（types.ts, account.ts, plan.ts, quota.ts, dateRange.ts）
│   ├── ports/           # 10 个端口接口（index.ts）
│   ├── adapters/        # 20+ 适配器实现
│   ├── app/             # 应用层（router, store, accountStore, quotaStore, di, i18n/）
│   ├── data/            # Dexie schema（db.ts）+ 12条样例数据（seed.ts）
│   └── ui/
│       ├── layout/      # AppShell (MainLayout + BareLayout)
│       ├── components/  # 14 个共享组件
│       └── screens/     # 15 个屏目录，每个 index.tsx default-export
├── server/              # Hono 后端（LLM/STT/VLM/地理编码代理 + 账号/配额）
├── docs/
│   ├── contest/         # 比赛材料（已提交的 PDF + 文案 + 海报 + 截图）
│   ├── screenshots/     # 8 张产品截图（01-home ~ 08-settings）
│   ├── design/          # 设计文档 + 品牌素材
│   └── superpowers/     # PRD + specs + plans
├── CLAUDE.md            # AI 协作工程指令（必读）
├── package.json         # aiji v2.0.1-rc7
├── vite.config.ts       # Vite + PWA 配置
├── tailwind.config.js   # 设计 token
└── capacitor.config.ts  # Android 配置
```

## 十、处理管线（核心 AI 流程）

```
用户采集 → finishSave()
  → saveEntry(Dexie, status='processing')
  → processEntry(fire-and-forget):
      1. enrichLocation（反向地理编码，best-effort）
      2. STT transcribe（语音→文字，Paraformer/Whisper）
      3. VLM describe（图片→描述，qwen-vl）
      4. LLM classify（涌现分类 + 标签 + facets + 情绪 + 提醒意图 + AI记忆注入）
      5. saveEntryAi + reload categories/tags
      6. mark aggregate stale → recompute
  → status='ready'（失败则 status='failed'，可重试）
```

## 十一、现有素材

### 产品截图（docs/screenshots/）

| 文件 | 内容 |
|------|------|
| 01-home.png | 首页时间流 |
| 02-capture.png | 采集页 |
| 03-detail.png | 条目详情 |
| 04-categories.png | 分类地图 |
| 05-summary.png | 时间摘要 |
| 06-chat.png | AI 对话 |
| 07-reminders.png | 提醒 |
| 08-settings.png | 设置 |

### 品牌素材（docs/contest/）

- `poster-v1-vertical.jpg` / `poster-v2-light.jpg` — 宣传海报
- `showcase-horizontal.jpg` — 横版展示
- `banner-ppt-cover.png` — PPT 封面
- `icon-*.png` — App 图标方案

### 设计素材（docs/design/generated/）

- `aiji-app-icon.png` / `aiji-brand-splash.png` — 品牌图
- `aiji-logo-*.png` — Logo 方案
- `effects/` — 各屏效果对比图

## 十二、Git 状态

- **当前分支**：`feat/network-register`
- **最新版本**：v2.0.1-rc7
- **Push 注意**：`git -c http.version=HTTP/1.1 push`（本机 HTTP/2 framing 有问题）

## 十三、演示视频建议脚本（5分钟）

```
0:00-0:30  开场：产品名+一句话创意+痛点（传统笔记分类手动、AI不懂你）
0:30-1:30  核心演示1：多模态采集（打字+录音+拍照 → 一条记录）
1:30-2:30  核心演示2：查看详情AI面板（涌现分类+标签+情绪）→ 分类视图
2:30-3:30  核心演示3：AI记忆（设置中添加规则 → 新记录自动按规则归类）
3:30-4:15  核心演示4：AI对话检索（自然语言提问 → 思维链 → 引用条目）
4:15-4:45  补充功能：提醒、摘要聚合、搜索、数据导出
4:45-5:00  收尾：技术架构一图流 + 鸿蒙化路径 + 结语
```

## 十四、设计 Token 速查

- 背景：`bg-page`(#f7f7fa) / `bg-card`(#fff)
- 文字：`text-ink`(#14141a) / `text-t2`(#6b6b75) / `text-t3`(#9a9aa5)
- 主色：`bg-pri`/`text-pri`(#4f46e5) / `bg-priS`(#eeedfd)
- 边框：`border-brd`(#ececef)
- 类别色：catIdea(#4f46e5) / catProject(#0d9488) / catPending(#d97706) / catFail(#dc2626)
- 圆角：screen(32) / card(16) / chip(11) / btn(12) / fab(28)
- 字体：Noto Sans SC
- 视口：390×844

## 十五、注意事项

1. **CLAUDE.md 是必读文件**——包含所有工程约束和产品铁律
2. **屏只渲染内容**——不要重复画 statusbar/nav/FAB，AppShell 已提供
3. **不碰共享文件**——components/、router.tsx、AppShell.tsx、data/、domain/、ports/ 只读
4. **TypeScript 严格**——`verbatimModuleSyntax`(类型必须 `import type`)、`erasableSyntaxOnly`(禁 enum)、`noUnusedLocals/Parameters`
5. **当前阶段是 UI 层**——端口走 mock 适配器，真实 AI 通过 BYOK 密钥或内置代理
