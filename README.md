# AiJi · AI 记

AI 辅助的「记」——多模态随手记（文本/语音/视频），云端 LLM（BYOK）自动涌现分类与聚合，本地优先存储。

移动优先 PWA，视口 390×844。详见 `docs/superpowers/specs/2026-07-15-aiji-design.md`。

## 开发

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc -b
npm run build
```

## 技术栈

React + Vite + TypeScript + Tailwind + Zustand + TanStack Query + Dexie（IndexedDB）+ react-router。
分层 + 端口架构（PRD §7.3）：UI 层 / 应用层 / Domain / Port / 适配层。UI 层阶段端口走 mock 适配器。
