# AiJi · AGENTS.md — 跨 Agent CLI 协作指令

> 本文件是给 Codex 及任何遵循 AGENTS.md 规范的 agent CLI 的项目指令。
> **CLAUDE.md 是承重约定的事实源**；本文件不复制其内容，只引用 + 补充 +
> 建立两个文件之间的联动协议，使不同 agent CLI 的改动可同步、不漂移。

## 0. 联动协议（核心）

- **CLAUDE.md** = 产品身份铁律 / 架构 / 目录布局 / 设计 tokens / 共享 API /
  TS 严格性 / 布局契约 / 协作铁律 / Figma / 待验假设 —— **唯一事实源**。
- **AGENTS.md（本文件）** = agent 协作元层 + CLAUDE.md 未覆盖的补充
  （后端 / i18n / 测试 / git 工作流 / 质量门 / 同步清单）。
- **同步规则**：改了 CLAUDE.md 里的承重约定 → 检查本文件是否引用同一处并同步；
  改了本文件里的协作流程 → 检查 CLAUDE.md §8（协作铁律）是否需对齐。
  两个文件同一 commit 改时，commit message 注明联动原因。
- **任何 agent CLI 开工前必读**：先 `CLAUDE.md`，再本文件，再按需读 §1 列表。

## 1. 开工前必读

| 文件 | 内容 |
|------|------|
| `CLAUDE.md` | 工程自述：铁律 / 架构 / tokens / TS / 布局 / 协作（§2-9） |
| `README.md` | 产品功能全景 + 安装 + 八屏说明 |
| `docs/superpowers/specs/2026-07-15-aiji-design.md` | PRD（8 节，产品 spec） |

## 2. 技术栈速查（补充 CLAUDE.md §2）

**前端**（根目录）：React 19 + Vite 8 + TypeScript strict + Tailwind v3 +
react-router-dom 7 + Zustand + TanStack Query + Dexie(IndexedDB) + Capacitor。

**后端**（`server/`）：Hono + better-sqlite3 + jose(JWT) + bcryptjs +
ffmpeg-static，Node ≥22。独立 `package.json` / `node_modules` / `tsconfig.json`。

**测试**：Vitest。前端 jsdom + fake-indexeddb；后端 node 环境。

## 3. 双仓库结构

```
/                     前端 PWA（src/ 分层见 CLAUDE.md §3）
  src/ui/screens/     各屏实现（home/capture/detail/categories/summary/search/
                      chat/settings/onboarding/drafts/trash/reminders/login/feedback）
  src/app/            router/store/query/di/i18n/session/accountStore/quotaStore
  src/domain/         types/account/plan/quota/dateRange（零 I/O）
  src/ports/          5 端口接口
  src/adapters/       PWA + Capacitor 适配（dexieStorage/webCapture/builtinLlm/...）
  src/data/           db.ts(Dexie schema) + seed.ts(样例)
server/               后端 API（独立包）
  src/routes/         auth/stt/vlm/llm/geocode/quota/plan/health
  src/lib/            jwt/password/refresh/rateLimit/quota/http
  src/middleware/     auth/cors
  src/db/index.ts     SQLite 连接
  db/schema.sql       建表 DDL
  data/aiji.db        SQLite 数据文件（gitignored）
docs/                 设计稿 / spec / 截图
```

## 4. 常用命令

```sh
# 前端（根目录）
npm run dev            # http://localhost:5173（视口 390×844）
npm run build          # tsc -b && vite build
npm run typecheck      # tsc -b（仅 lead 集成阶段用）
npm run test           # vitest（watch）
npm run test:run       # vitest run（CI / 一次性）
npm run lint           # oxlint

# 后端（server/）
cd server && npm run dev        # tsx watch src/index.ts
cd server && npm run build      # tsc → dist/
cd server && npm run typecheck  # tsc --noEmit
cd server && npm run test       # vitest run
```

## 5. 后端约定（CLAUDE.md 未覆盖）

- `server/src/routes/*.ts`：Hono 路由，按资源拆分。新增 API 加新路由文件并在
  `server/src/index.ts` 挂载。
- `server/src/lib/*.ts`：业务工具（JWT 签发/校验、密码哈希、刷新令牌、限流、配额、
  HTTP 错误响应）。
- `server/src/middleware/auth.ts`：JWT 校验中间件，受保护路由 `use(auth)`。
- `server/src/db/index.ts`：better-sqlite3 单例 + schema 初始化。
- `server/db/schema.sql`：DDL 事实源；改表结构先改这里。
- `server/.env`：环境变量（gitignored），`server/.env.example` 为模板。
- 后端 TS 配置独立（`server/tsconfig.json`，TS ~5.6），不受前端 strict 选项约束，
  但同样遵守 `import type` 等良好实践。
- **部署**（腾讯云 106.54.26.195，平铺 `/opt/aiji`，pm2 `aiji-api`）：**严禁远端
  `npm ci`**（会挂且先删 node_modules）→ 本机 `cd server && npm run build` →
  `sshpass rsync -az dist/ root@106.54.26.195:/opt/aiji/dist/` → `pm2 restart aiji-api`。
  详见 CLAUDE.md §12。

## 6. i18n 体系（CLAUDE.md 未覆盖）

- `src/app/i18n/{zh,en}/`：按屏拆分翻译文件（home/capture/detail/categories/
  summary/search/chat/settings/onboarding/drafts/trash/reminders/login/feedback/common）。
- `src/app/i18n/useT.ts`：翻译 hook，`const t = useT()` → `t('key')`。
- `src/app/i18n/index.ts`：聚合导出 + 语言切换。
- **铁律**：新增 UI 文案必须同时加 zh + en 两个文件，缺一会导致运行时缺词。
- `src/app/i18n/errorText.ts`：错误消息双语化。

## 7. TypeScript 自检（重申 CLAUDE.md §6）

- **前端并行自检**：`npx tsc -p tsconfig.app.json`（不写共享 tsbuildinfo，无竞态）。
  **不要**用 `npm run typecheck` / `tsc -b` 做并行自检（写共享缓存会竞态）。
- **后端自检**：`cd server && npx tsc --noEmit`。
- `verbatimModuleSyntax: true` → 类型 import 必须 `import type`。
- `erasableSyntaxOnly: true` → 禁 enum / 构造函数参数属性 / namespace。
- `noUnusedLocals` / `noUnusedParameters: true` → 无未用变量。

## 8. Git 工作流与发版

- 主开发分支：`v2.5`（当前）。功能分支 `feat/*` 开发 → 发版分支 `vX.Y` 承载发布。
- **发版流程（APK）**：`npm pkg set version=X.Y.Z` → commit → `git tag vX.Y.Z` →
  push 分支 + tag → CI 出 `aiji.apk`。**tag 触发时 CI 断言 tag == package.json，
 必须先 bump 再打 tag**。`-rc` tag = debug 签名 + prerelease（测试包）；
 正式 tag = release 签名 + Latest release。详见 CLAUDE.md §12（事实源）。
- **push 坑（本机必用）**：github.com smart-HTTP 在本机挂，统一：
  ```sh
  git -c http.version=HTTP/1.1 -c http.proxy=http://127.0.0.1:7897 \
    push "https://cq-dong:$(gh auth token)@github.com/cq-dong/AiJi.git" <branch> <tag>
  ```
- leader 负责 commit/push；子智能体写完代码 + 自测只回报「完成」，不自行 commit/push。
- commit message 风格：`type(scope): 描述`（见 git log：feat/fix/chore/docs）。
- **不入库**：`release/`（本地 APK 产物）、`.codex/`、`server/.env`、前端 `.env.local`。

## 9. 质量门（改完必跑）

| 改动范围 | 自检命令 |
|----------|----------|
| 前端 TS | `npx tsc -p tsconfig.app.json` |
| 前端 lint | `npm run lint` |
| 前端测试 | `npm run test:run` |
| 后端 TS | `cd server && npx tsc --noEmit` |
| 后端测试 | `cd server && npm run test` |
| 截图验收 | 存 `.e2e_shots/`，**禁止**丢仓库根目录 `/*.png`（CLAUDE.md §8） |

## 10. Agent CLI 同步清单（改完自查）

- [ ] 新增/修改了**产品铁律或承重工程约定** → 写进 `CLAUDE.md`，检查本文件引用。
- [ ] 新增/修改了**agent 协作流程 / 命令 / 后端 / i18n / git** → 写进本文件，检查
      `CLAUDE.md` §8 是否需对齐。
- [ ] 新增了**屏 / 路由** → 更新 CLAUDE.md §3 目录布局 + §7 布局契约 + 本文件 §3。
- [ ] 新增了**i18n 文案** → 确认 zh + en 双语都加（本文件 §6）。
- [ ] 新增了**后端 API** → 更新本文件 §5 路由列表。
- [ ] 两个文件都改 → 同一 commit，message 注明联动。

## 11. 环境变量（补充 CLAUDE.md）

前端 `.env.local`（gitignored）：`VITE_LLM_KEY` / `VITE_STT_KEY`（BYOK 必填）+
`VITE_FEEDBACK_GITHUB_TOKEN` / `VITE_FEEDBACK_GITHUB_REPO`（反馈功能）。
模板见 `.env.example`。

后端 `server/.env`（gitignored）：模板见 `server/.env.example`。
