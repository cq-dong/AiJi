# AiJi · 应用图标（用户指定）

> 2026-07-17
> 本文档仅记录用户指定的图标内容，作为应用图标定稿依据。

---

## 指定图标

**源文件**：`/Users/dcq/Downloads/image_1784278236303.png`

**拷贝位置**：
- 原档：`docs/design/generated/aiji-app-icon-specified.png`（512×512，66KB）
- PWA manifest 图标：`public/icon-512.png`（512×512）
- PWA manifest 图标：`public/icon-192.png`（192×192，由 512 用 sips 缩放生成）

**图标内容**：紫色调应用图标，主体为「记」字图形化设计，含 AI 相关元素。

**尺寸状态**：✅ 已是 512×512 高清，满足 PWA manifest（192+512）、apple-touch-icon、各商店应用图标要求。192×192 已由 512 缩放生成。

---

## 已应用的引用点

- `vite.config.ts` VitePWA manifest：`/icon-192.png`（192×192）+ `/icon-512.png`（512×512，any maskable）
- `index.html`：`<link rel="apple-touch-icon" href="/icon-192.png">`

图标已就位，PWA 可安装性所需图标齐备。
