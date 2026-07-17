# AiJi · 开屏图（用户指定）

> 2026-07-17
> 本文档仅记录用户指定的开屏图内容，作为后续实现依据。**不改代码，仅记录。**

---

## 指定素材

**源文件**：`docs/design/generated/aiji-ui-onboarding-hero.png`

**图信息**：
- 尺寸：1024 × 1280（4:5 竖屏）
- 格式：PNG，8-bit RGB
- 内容：AiJi UI onboarding hero 图

**用户意图**：用作「开屏」，包含两种用途（用户确认「两者都要」）：
1. **启动闪屏 Splash**：App 启动时短暂显示，1-2 秒后进入 App
2. **Onboarding 引导页 hero**：首次运行的 onboarding 页（`/onboarding`）顶部 hero 图

---

## 用途 1：启动闪屏 Splash

**现状**：项目当前无 splash 机制。需后续实现，记录如下：

- **PWA splash**：浏览器无原生 splash，但 PWA manifest 的 `icons`（已配 192/512）+ `theme_color`/`background_color` 决定「添加到主屏」后的启动外观。可选加 `screenshots` 字段增强。
- **iOS splash**：需在 index.html 加 `<link rel="apple-touch-startup-image">`（多尺寸，对应不同设备）。1024×1280 可作为源图裁切各尺寸。
- **安卓/鸿蒙原生 splash**（未来上架）：需 Capacitor/原生壳配置启动图，或鸿蒙的启动页配置。

**尺寸适配建议**（从 1024×1280 裁切/缩放）：
- iOS 需多套 startup image（iPhone 各分辨率，如 1170×2532、1242×2688 等）
- 安卓需 adaptive icon + 启动图（建议 1080×1920）

---

## 用途 2：Onboarding 引导页 hero

**现状**：`src/ui/screens/onboarding/index.tsx` 当前是纯文字引导（welcome + FEATURES 列表 + API Key 输入 + 权限），无 hero 图。

**记录的实现方向**（后续做，不改代码）：
- 在 onboarding 页顶部 welcome 区上方/下方插入此 hero 图
- 移动端视口 390×844，hero 图按宽度适配（`w-full` + 保持比例），高度自适应
- 1024×1280 源图可直接用于竖屏展示，无需裁切

---

## 待后续实现（记录，不执行）

- [ ] index.html 加 iOS apple-touch-startup-image（多尺寸）
- [ ] PWA manifest 加 screenshots 字段
- [ ] onboarding 页插入 hero 图
- [ ] 安卓/鸿蒙原生壳的 splash 配置（上架时）
