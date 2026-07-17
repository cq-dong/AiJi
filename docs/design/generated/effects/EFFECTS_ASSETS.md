# AiJi 效果宣传图清单

本批 16 张图（8 个运行页 × 功能介绍图 FI + 界面优化美化图 UP），由 **meigen-designer**（美团 美境AI设计师，gpt-image-2）于 2026-07-17 图生图生成。sessionId `1026591`，16/16 成功并已下载至本地。

> **图生图**：每张以该页 390×844 运行截图（`/tmp/aiji-shots/<page>.png`）为参考底图，`generate.py --image <path>` 自动传 S3。prompt 只描述「拿参考底图做什么」，无需手写占位符。
> **FI**（功能介绍图）：`config {"ratio":"9:16"}`，竖屏海报，屏外旁注要点，引向屏内区域。
> **UP**（界面优化美化图）：`config {"width":828,"height":1792}`（手机 390:844 比例），以截图为底重绘更精致版本，保留真实信息架构与文案。
> 本地 PNG 是稳定归档；meituan.net 源 URL 带 expiring token，会失效，勿作长期引用。源 URL 见 `/tmp/meigen-effects-summary.json`。
> 产品身份铁律（每条 prompt 隐含）：AiJi=通用「记」工具非日记 · 条目异构 · 类别涌现不预定（勿硬编码生活/想法/项目）· 情绪仅可选侧面不当轴。色：靛蓝 #4f46e5 / 底 #f7f7fa / 卡 #fff / priS #eeedfd · 圆角 16 · Noto Sans SC。
> 临时预览页：`docs/design/generated/effects-preview.html`（30s 自动刷新），经 `python3 -m http.server 7788 --dir docs/design/generated` 服务，访问 `http://localhost:7788/effects-preview.html`。

---

## 1 · onboarding

### onboarding-intro（FI）
- **路径**：`effects/onboarding-intro.png`
- **尺寸/格式**：9:16 竖屏 · PNG · 57 KB
- **定位作用**：onboarding 首屏功能介绍海报。以该页截图为底图，屏外旁注三要点（随手捕获异构碎片 / AI 涌现分类不预定 / 离线先存断网不丢），引向屏内「记」字标 + tagline + 「开始使用」CTA。
- **prompt**：AiJi onboarding 首屏功能介绍海报。以该页截图为参考底图：竖屏，保留中央大字标「记」与 tagline「随手记，AI 帮你理」，在手机屏外以旁注卡片标注三要点——①随手捕获异构碎片（语音/文字/图片）②AI 涌现分类（类别由内容浮现，不预定）③离线先存、断网不丢；底部呼应「开始使用」CTA 按钮（靛蓝实色 #4f46e5）。海报式留白，旁注用细线引向屏内对应区域。

### onboarding-uipolish（UP）
- **路径**：`effects/onboarding-uipolish.png`
- **尺寸/格式**：828×1792 · PNG · 66 KB
- **定位作用**：onboarding 首屏 UI 优化美化。重绘更精致版本：「记」字标呼吸感、tagline 层级、三段图示（捕获→涌现分类→离线不丢）细腻插画、CTA 质感。
- **prompt**：以该页 onboarding 截图为参考底图重绘更精致首屏：中央「记」字标呼吸感更强、tagline 层级清晰，三段图示区（捕获→涌现分类→离线不丢）用更细腻插画与连接线，底部「开始使用」CTA 有质感（柔和阴影、圆角 12）。保留信息架构与「开始使用」文案，勿增硬编码类别集。靛蓝 #4f46e5 / priS #eeedfd / 底 #f7f7fa。

---

## 2 · home

### home-intro（FI）
- **路径**：`effects/home-intro.png`
- **尺寸/格式**：9:16 竖屏 · PNG · 69 KB
- **定位作用**：home 首页功能介绍。旁注三要点：异构条目时间线分组（非日记日期流）/ 每条带时间戳+AI 状态 chip+类别 chip+标签 / 右下采集 FAB + 底部五 tab。
- **prompt**：AiJi home 首页功能介绍海报。以该页截图为参考底图：竖屏，屏标题「记」居顶，旁注三要点——①异构条目按时间线分组呈现（非日记日期流）②每条带时间戳 + AI 处理状态 chip + 类别 chip + 标签③右下采集 FAB 一键记一笔、底部五 tab 导航。旁注细线引向屏内对应卡片/FAB。

### home-uipolish（UP）
- **路径**：`effects/home-uipolish.png`
- **尺寸/格式**：828×1792 · PNG · 76 KB
- **定位作用**：home 首页 UI 优化。条目卡精致化（时间戳/AI 状态 chip/类别 chip/标签层级分明），NavBottom 五 tab + 采集 FAB 质感。
- **prompt**：以该页 home 截图为参考底图重绘更精致首页：屏标题「记」层级清晰，日期分组条通透，条目卡更精致（时间戳 / AI 状态 chip / 类别 chip / 标签层级分明），底部 NavBottom 五 tab 与右下采集 FAB 有质感。保留时间线与样本条目内容（勿新增硬编码类别）。靛蓝 #4f46e5 / 卡 #fff / 底 #f7f7fa。

---

## 3 · capture

### capture-intro（FI）
- **路径**：`effects/capture-intro.png`
- **尺寸/格式**：9:16 竖屏 · PNG · 53 KB
- **定位作用**：capture 采集页功能介绍。旁注：多模态捕获 / 录音波形实时反馈 / 离线先存断网 AI 入队不丢。
- **prompt**：AiJi capture 采集页功能介绍海报。以该页截图为参考底图：竖屏，采集 sheet 居中，旁注三要点——①多模态捕获（语音转写 + 文字 + 图片）②录音波形实时反馈③离线先存、断网 AI 入队不丢；顶部 ‹ 返回、底部保存按钮呼应。旁注引向波形区与保存按钮。

### capture-uipolish（UP）
- **路径**：`effects/capture-uipolish.png`
- **尺寸/格式**：828×1792 · PNG · 74 KB
- **定位作用**：capture 采集 sheet UI 优化。波形细腻动感、文本区通透、保存按钮质感。
- **prompt**：以该页 capture 截图为参考底图重绘更精致采集 sheet：录音波形更细腻有动感，文本输入区通透留白，保存按钮有质感，mic 状态与 ‹ 返回层级清晰。保留信息架构与采集流程，勿增硬编码类别。靛蓝 #4f46e5 / 卡 #fff / 底 #f7f7fa。

---

## 4 · detail

### detail-intro（FI）
- **路径**：`effects/detail-intro.png`
- **尺寸/格式**：9:16 竖屏 · PNG · 91 KB
- **定位作用**：detail 详情页功能介绍。以 e1 条目原文「地铁里想到如果记一条东西能顺便变提醒就好了」为底，旁注四要点：AI 抽标题/摘要 / 检测类别「想法」+标签+可选侧面（地点·地铁）/ 原文音频时间戳保留 / 可编辑重处理删除。
- **prompt**：AiJi detail 详情页功能介绍海报。以该页截图（条目原文「地铁里想到如果记一条东西能顺便变提醒就好了」）为参考底图：竖屏，旁注四要点——①AI 抽标题/摘要（屏内可见「记一条顺便变提醒」标题与摘要）②检测类别「想法」+标签 AiJi/地铁/侧面 + 可选侧面（地点·地铁）③原文/音频/时间戳保留④可编辑/重处理/删除。旁注引向 AI 面板与底部操作行。

### detail-uipolish（UP）
- **路径**：`effects/detail-uipolish.png`
- **尺寸/格式**：828×1792 · PNG · 83 KB
- **定位作用**：detail 详情页 UI 优化。原文区通透、AI 面板（deepseek-chat/标题/摘要）有层次、类别/标签 chip 精致、底部操作行层级清晰。
- **prompt**：以该页 detail 截图为参考底图重绘更精致详情页：原文区通透，AI 面板（deepseek-chat / 标题「记一条顺便变提醒」/ 摘要）有层次，类别 chip「想法」与标签 chip 精致，地点行克制，底部「编辑/重处理/删除」按钮层级清晰。保留样本内容（想法/地铁/标题/摘要文案），勿新增硬编码类别。靛蓝 #4f46e5 / 卡 #fff / 底 #f7f7fa。

---

## 5 · categories

### categories-intro（FI）
- **路径**：`effects/categories-intro.png`
- **尺寸/格式**：9:16 竖屏 · PNG · 75 KB
- **定位作用**：categories 分类页功能介绍。旁注：类别由内容涌现不预定（样本涌现结果勿当固定枚举）/ 可合并重命名策展 / 计数实时。
- **prompt**：AiJi categories 分类页功能介绍海报。以该页截图（类别卡带强调色边条 + 计数 + 预览条目）为参考底图：竖屏，旁注三要点——①类别由内容涌现、不预定（屏内类别为样本涌现结果，勿当固定枚举）②可合并/重命名/策展③计数实时。旁注引向类别卡强调色边条与计数徽章。

### categories-uipolish（UP）
- **路径**：`effects/categories-uipolish.png`
- **尺寸/格式**：828×1792 · PNG · 87 KB
- **定位作用**：categories 分类页 UI 优化。类别卡有层次（强调色边条/计数徽章/预览），网格通透。
- **prompt**：以该页 categories 截图为参考底图重绘更精致分类页：类别卡有层次（强调色边条/计数徽章/预览条目），网格通透，屏标题「分类」层级清晰，底部 NavBottom+FAB 有质感。保留样本类别（示意涌现结果），勿新增硬编码类别集。靛蓝 #4f46e5 / 卡 #fff / 底 #f7f7fa。

---

## 6 · summary

### summary-intro（FI）
- **路径**：`effects/summary-intro.png`
- **尺寸/格式**：9:16 竖屏 · PNG · 69 KB
- **定位作用**：summary 汇总页功能介绍。旁注：时间维度聚合 / 计数与趋势可视化 / 无强制情绪轴（情绪仅可选侧面）。
- **prompt**：AiJi summary 汇总页功能介绍海报。以该页截图（时间维度选择器 + 计数 + 趋势区）为参考底图：竖屏，旁注三要点——①时间维度聚合（周/月选择器）②计数与趋势可视化③无强制情绪轴（情绪仅可选侧面，不当导航轴）。旁注引向时间选择器与趋势区。

### summary-uipolish（UP）
- **路径**：`effects/summary-uipolish.png`
- **尺寸/格式**：828×1792 · PNG · 66 KB
- **定位作用**：summary 汇总页 UI 优化。聚合卡/趋势区通透有层次、时间选择器精致。
- **prompt**：以该页 summary 截图为参考底图重绘更精致汇总页：聚合卡/趋势区通透有层次，时间选择器精致，计数层级清晰，屏标题「汇总」层级清晰，底部 NavBottom+FAB 有质感。保留信息架构，勿引入情绪轴。靛蓝 #4f46e5 / 卡 #fff / 底 #f7f7fa。

---

## 7 · search

### search-intro（FI）
- **路径**：`effects/search-intro.png`
- **尺寸/格式**：9:16 竖屏 · PNG · 84 KB
- **定位作用**：search 搜索页功能介绍。旁注：全文检索 / 快捷 chip（最近/常用标签）/ 跨条目回溯。
- **prompt**：AiJi search 搜索页功能介绍海报。以该页截图（搜索框 + 快捷 chip 列表 + 结果/空态）为参考底图：竖屏，旁注三要点——①全文检索②快捷 chip（最近/常用标签）③跨条目回溯。旁注引向搜索框与 chip 列表。

### search-uipolish（UP）
- **路径**：`effects/search-uipolish.png`
- **尺寸/格式**：828×1792 · PNG · 90 KB
- **定位作用**：search 搜索页 UI 优化。搜索框通透有焦点、快捷 chip 精致、空态邀请感。
- **prompt**：以该页 search 截图为参考底图重绘更精致搜索页：搜索框通透有焦点，快捷 chip 精致，结果列表层级清晰，空态有邀请感，屏标题「搜索」层级清晰，底部 NavBottom+FAB 有质感。保留信息架构。靛蓝 #4f46e5 / 卡 #fff / 底 #f7f7fa。

---

## 8 · settings

### settings-intro（FI）
- **路径**：`effects/settings-intro.png`
- **尺寸/格式**：9:16 竖屏 · PNG · 82 KB
- **定位作用**：settings 设置页功能介绍。旁注四要点：主题/外观 / 记录位置 / 自备密钥（STT+LLM BYOK，数据落本地）/ 提醒。强调隐私与可控。
- **prompt**：AiJi settings 设置页功能介绍海报。以该页截图（分组列表：外观/记录位置/密钥/提醒/关于）为参考底图：竖屏，旁注四要点——①主题/外观②记录位置③自备密钥（STT + LLM BYOK，数据落本地）④提醒。强调隐私与可控。旁注引向密钥项与开关行。

### settings-uipolish（UP）
- **路径**：`effects/settings-uipolish.png`
- **尺寸/格式**：828×1792 · PNG · 73 KB
- **定位作用**：settings 设置页 UI 优化。分组卡通透、开关/toggle 精致、密钥项克制有安全感。
- **prompt**：以该页 settings 截图为参考底图重绘更精致设置页：分组卡通透，开关/toggle 精致，密钥项克制有安全感，分组标题层级清晰，屏标题「设置」层级清晰，底部 NavBottom+FAB 有质感。保留信息架构与文案。靛蓝 #4f46e5 / 卡 #fff / 底 #f7f7fa。

---

## 备注

- **生成耗时**：16 张顺序 generate→poll→download，约 37 min（00:37–01:24），~2min/张。
- **token 刷新**：本批前 meigen access token 已失效（mtsso moa-local-exchange 不可用），改用 `meigen login --mode ciba --mis-id dongchengqi`（推「大象」App 确认）刷新后重跑。详见 [[proactive-auth-alert]]。
- **批量脚本**：`/tmp/meigen_effects_batch.py`（16 条 IMAGES 数组：name/prompt/config/ref，顺序 generate→poll→download，写 log+summary json）。可作后续图生图批量模板。
- **attribution**（16 张共享，sessionId 1026591）：

  🎨 本图由 美境AI设计师 图生图生成 | [前往美境](https://aidesign.meituan.com/creativeAssistant/1026591)
