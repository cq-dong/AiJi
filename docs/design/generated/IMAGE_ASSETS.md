# AiJi 视觉资产清单

本批 8 张图（4 UI 插画 + 4 品牌资产），由 **meigen-designer**（美团 美境AI设计师，gpt-image-2）于 2026-07-16 生成。sessionId `1026591`，8/8 成功并已下载至本地。

> 本地 PNG/JPG 是稳定归档；meituan.net 源 URL 带 expiring token，会失效，勿作长期引用。
> C2/C3/C4 含品牌字标「AiJi 记」+ tagline「随手记，AI 帮你理」——gpt-image-2 文字现已能正常渲染，直接出图无需 HTML overlay。
> A1/B1/B2/B3 与 C1 保持 `no text`：插画不该有文字，maskable 图标按 OS 惯例不依赖文字。

落地映射（哪个屏的哪个槽 / 哪个品牌位）依据：UI 层屏目录 `src/ui/screens/{onboarding,home,categories,search}/index.tsx`，共享原语 `EmptyState`（`src/ui/components`），PWA manifest（`vite.config.ts` VitePWA + `public/`）。所有路径相对仓库根。

---

## A. UI 插画（4 张 · 接入 EmptyState icon 槽 / onboarding hero）

### A1 · onboarding-hero
- **路径**：`docs/design/generated/aiji-ui-onboarding-hero.png`
- **尺寸/格式**：4:5 竖屏 · PNG · 470 KB
- **定位作用**：`src/ui/screens/onboarding/index.tsx` 首屏 hero 区。替代当前「记」字 logo + 文案占位，作品牌主视觉，表达产品核心机制「随手捕获异构碎片 → AI 涌现分类」（碎片汇聚成两三个**无标签**的群，呼应"类别不预定、由内容涌现"铁律）。
- **prompt**：
  > AiJi「记」品牌主插画。概念：异构的记录碎片从画面四周向中央汇聚——一个想法气泡、一个项目节点小方块、一段音频波形线、一张照片缩略图、一个生活时刻小图标，形态各异、模态混合。中央是一颗靛蓝四芒 AI 灵感火花，碎片围绕火花自然聚成两三个无标签的群（不写类别名），表达「随手捕获→AI 涌现分类」。主色靛蓝 #4f46e5，底色近白 #f7f7fa，碎片点缀 teal #0d9488 / 琥珀 #d97706 / 红 #dc2626。扁平现代插画，圆润友好，柔和阴影，大量留白。no text, no letters, no words，无文字无字母无标签。竖屏 4:5。

### B1 · home-empty
- **路径**：`docs/design/generated/aiji-ui-home-empty.png`
- **尺寸/格式**：1024×1024 · PNG · 256 KB
- **定位作用**：`src/ui/screens/home/index.tsx` 首次无条目时的 `EmptyState` icon 槽。替代当前 Mic 图标圆，传达「准备记一笔」的起点邀请感。
- **prompt**：
  > AiJi 空状态插画。概念：一颗靛蓝四芒灵感火花悬在中央，下方一支斜置钢笔笔尖轻点，笔尖处散开几粒微小光点，像「准备记一笔」的起点。整体留白充足、安静、邀请感。主色靛蓝 #4f46e5 单色 + 极淡 priS #eeedfd，底色近白 #f7f7fa。扁平现代极简插画，圆润线条，柔和。no text, no letters, no words，无文字无字母。1024x1024。

### B2 · categories-empty
- **路径**：`docs/design/generated/aiji-ui-categories-empty.png`
- **尺寸/格式**：1024×1024 · PNG · 127 KB
- **定位作用**：`src/ui/screens/categories/index.tsx` 首次无类别 EmptyState。替代当前 HubIcon CSS 方块，强化"类别会涌现、不预定"的产品心智（虚线把碎片自然连成无标签的群）。
- **prompt**：
  > AiJi 空状态插画，主题「类别会涌现」。概念：几个异构小碎片（气泡/方块/波形线/小图）散落画面，彼此间几条极淡虚线正自然连接、聚拢成两三个无标签的群，像分类在自动浮现。中央一颗靛蓝 AI 火花作连接核心。强调「不预定、由内容涌现」。主色靛蓝 #4f46e5，碎片点缀 teal #0d9488 / 琥珀 #d97706，底色近白 #f7f7fa。扁平现代插画，圆润，柔和，留白。no text, no letters, no words，无文字无标签。1024x1024。

### B3 · search-initial
- **路径**：`docs/design/generated/aiji-ui-search-initial.png`
- **尺寸/格式**：1024×1024 · PNG · 138 KB
- **定位作用**：`src/ui/screens/search/index.tsx` 首次未搜索 EmptyState，置于快捷 chip 列表上方。传达「先记下，再回找」（放大镜镜片是灵感火花、镜柄连钢笔）。
- **prompt**：
  > AiJi 空状态插画，主题「记一笔，再来找」。概念：一只简化的放大镜，镜片中心是一颗靛蓝灵感火花而非普通镜片，镜柄末端连接一支小钢笔——暗示「先记下，再回找」。主色靛蓝 #4f46e5，底色近白 #f7f7fa，极淡 priS #eeedfd。扁平现代极简插画，圆润线条，留白。no text, no letters, no words。1024x1024。

---

## B. 品牌资产（4 张 · icon / OG / splash / store-hero）

### C1 · app-icon（maskable）
- **路径**：`docs/design/generated/aiji-brand-app-icon.png`
- **尺寸/格式**：1024×1024 · PNG · 230 KB
- **定位作用**：PWA manifest 的 maskable 图标。替代当前 `public/icon-512.png`（"any maskable" 混合版）为**带安全区**的 proper maskable——满版靛蓝渐变 + 中央 60% 安全区内的「记」标记，系统裁切任意形状都不丢主体。
- **prompt**：
  > AiJi app 图标，maskable 带安全区。概念：满版靛蓝渐变背景（#4f46e5 → 略深 #3b3acb），中央居中放抽象「记」标记——一支斜置钢笔笔尖 + 笔尖处一颗四芒 AI 火花，标记占画面中央 60% 安全区内，四周留白背景。满版无圆角（系统裁切）。扁平现代品牌图标。no text, no letters, no words。1024x1024。

### C2 · og-share
- **路径**：`docs/design/generated/aiji-brand-og-share.png`
- **尺寸/格式**：16:9 横屏 · JPEG（源 .jpg，本批脚本存为 .png 扩展，见末注）· 28 KB
- **定位作用**：OG / 社交分享卡（link preview，约 1200×630）。左侧留白排品牌字标 + tagline，右侧碎片 + 火花。
- **prompt**：
  > AiJi 社交分享卡。概念：左下到右上靛蓝 #4f46e5 渐变底，画面右侧散落几颗异构记录碎片（气泡/方块/波形线）+ 一颗四芒 AI 火花。左侧大面积留白渐变上居中排品牌字标「AiJi 记」（AiJi 用拉丁无衬线粗体靛蓝 #4f46e5，记 用 Noto Sans SC 粗体同色），字标下方一行小字 tagline「随手记，AI 帮你理」同色。扁平现代品牌卡，柔和光影。横屏 16:9。

### C3 · splash
- **路径**：`docs/design/generated/aiji-brand-splash.png`
- **尺寸/格式**：9:16 竖屏 · JPEG（源 .jpg，存为 .png 扩展）· 31 KB
- **定位作用**：PWA 启动屏背景。满版靛蓝渐变 + 白色四芒火花 + 白色字标，克制安静。
- **prompt**：
  > AiJi 启动屏。概念：满版靛蓝 #4f46e5 到深靛 #3b3acb 竖向渐变，画面正中偏上一颗白色四芒灵感火花（极简、发光），火花正下方居中排白色品牌字标「AiJi 记」（无衬线粗体）。极简品牌启动视觉，克制、安静。竖屏 9:16。

### C4 · store-hero
- **路径**：`docs/design/generated/aiji-brand-store-hero.png`
- **尺寸/格式**：9:16 竖屏 · JPEG（源 .jpg，存为 .png 扩展）· 45 KB
- **定位作用**：应用商店宣传图竖屏 hero 帧。上半靛蓝实色 + 白色火花/字标/tagline，下半近白留白区留给后叠 UI 截图。
- **prompt**：
  > AiJi 应用商店宣传图，竖屏。概念：上半部靛蓝 #4f46e5 实色区，居中一颗大号白色四芒 AI 火花 + 几粒异构碎片（气泡/方块/波形线）环绕；火花下方居中排白色品牌字标「AiJi 记」（无衬线粗体），再下一行较小白色 tagline「随手记，AI 帮你理」。下半部近白 #f7f7fa 区纯净留白（留给后叠 UI 截图）。扁平现代品牌宣传视觉，柔和。竖屏 9:16。

---

## 备注

- **格式/扩展名**：C2/C3/C4 meigen 源返回 JPEG，本批脚本统一存为 `.png` 扩展（内容是 JPEG）。浏览器一般能 sniff 渲染，但接入 manifest/OG 时若被严格服务器按扩展判 MIME，建议把这三张改回 `.jpg` 再引用。
- **maskable 接入**：C1 入 manifest 时 `purpose: "maskable"`，并保留一张普通版（`purpose: "any"`）供不带 maskable 的场景；manifest 当前 `public/manifest.webmanifest` 与 vite VitePWA 配置存在不一致，接入时一并理顺。
- **源 URL（带 expiring token，失效前可直链）**：见 `/tmp/meigen-ui-summary.json`，本文件不重复，避免失效链接污染文档。
- **attribution**（8 张共享，sessionId 1026591）：

  🎨 本图由 美境AI设计师 生成 | [前往美境](https://aidesign.meituan.com/creativeAssistant/1026591)
