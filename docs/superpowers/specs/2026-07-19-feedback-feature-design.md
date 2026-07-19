# AiJi 使用反馈功能 · 设计

> 2026-07-19。设置 → 「使用反馈」→ 进入 `/feedback`（裸路由）→ 写 N 条建议（每条 = 可选图片 + 文字）→ 提交 → 建 GitHub Issue（label `feedback`）→ Claude Code 用 `gh issue list --label feedback` 读取后改。

## 1. 目标与非目标

- **目标**：App 内一键反馈；一次可提交多条建议；每条可附相册图片；提交后自动到 GitHub Issue。
- **非目标**：不做用户填写 key 的 UI（token 内置）；不做匿名身份；不内置 Claude Code 消费循环（那是用法，不是 App 功能）。

## 2. 目的地决策

**选 BYOK GitHub PAT + 内置（开发期）**：
- token + repo 走 `.env.local`（gitignored，`*.local`）→ Vite 构建时 inline 进包 → APK 自带，终端用户零配置。
- 适配器直接读 `import.meta.env.VITE_FEEDBACK_GITHUB_TOKEN` / `VITE_FEEDBACK_GITHUB_REPO`（不走 SecretStorePort，无可编辑 UI）。
- **安全约束（开发者必须遵守）**：fine-grained PAT，授 `issues:write` + `contents:write`，限定 AiJi 仓库，90 天过期，不勾 admin/pulls/security_events。（contents:write 用于往孤儿分支 `feedback-assets` 提交图片；早期版本用 `gists:write`，但 gist raw 返 `text/plain` 致图片不渲染——issue #2 实测 `naturalWidth=0`，已弃用。）
- **代价**：token 可从 APK 反编译提取。开发期接受（泄露即吊销重发）。
- **TODO(pre-release)**：正式版前迁移到 Cloudflare Worker 代理（token 存 worker secret），代码留 `TODO(pre-release)` 标记。

## 3. 架构（端口模式）

```
FeedbackPort (src/ports/index.ts)
  submit(items: FeedbackItem[]): Promise<{ issueUrl: string }>
FeedbackItem = { text: string; images: Blob[] }   // Blob 已由 UI 压缩
```

适配器 `src/adapters/githubFeedback.ts`：
1. 校验 token + repo 存在，否则抛「反馈未配置」。
2. 若本次有图片，幂等确保孤儿分支 `feedback-assets` 存在（GET `/branches/feedback-assets`；404 则建 `.gitkeep` 空 blob → 单条目树 → 无父根提交 → 建 ref——GitHub 拒 `tree:[]` 返 422 Invalid tree info，须至少一条目），模块级缓存免每次提交都探。
3. 收集本次提交所有图片 → 串行 `PUT /repos/{repo}/contents/feedback-assets/{ts}-{i}-{rand}.{ext}`（`branch=feedback-assets`，base64 `content`）→ 取每文件 `download_url`（`raw.githubusercontent.com/{repo}/feedback-assets/{path}`，按 .ext 返 `image/*`）。串行免同分支并发提交撞 HEAD。
4. 拼 markdown body：`> 来自 AiJi App 使用反馈 · {ts}` + 每条 `## 建议 N` + 文字 + `![](download_url)`。
5. `POST /repos/{owner}/{repo}/issues`，title = 首条文字前 40 字，labels=`['feedback']`。
6. 返回 `html_url`。

**图片外链选 repo 孤儿分支（非 gist）**：gist raw URL 经实测返 `text/plain`，浏览器拒渲（issue #2 实测 `naturalWidth=0`）。`raw.githubusercontent.com` 按扩展名返 `image/jpeg`，camo 正常渲染。**1 次提交 = 1 Issue**，body 内 N 段（不刷屏，Claude Code 按段处理）。孤儿分支只存图片，不污染 main 历史。

DI：`di.feedback = githubFeedback`。

## 4. UI

- `src/ui/screens/settings/FeedbackSection` 不单独建文件——直接在 `settings/index.tsx` 的「关于」行上方加 `<ChevronRow label="使用反馈" onClick={() => navigate('/feedback')} />`。
- `src/ui/screens/feedback/index.tsx`（新）：
  - 顶栏：`ChevronLeft` 返回 + 标题「使用反馈」。
  - 建议卡片列表（至少 1 条）：每条 = textarea + 图片缩略图（带删除 X）+ 「添加图片」按钮（`<input type=file accept=image/* multiple>` hidden，Capacitor 上触发原生相册）。
  - 「+ 添加建议」按钮加更多条。
  - 底栏「提交」（disabled 当全空）。
  - 状态：idle / submitting（Spinner） / success（显 issue URL + 「完成」回设置） / error（msg + 重试）。
- 图片前端压缩：canvas 降到 ≤1600px / JPEG 0.8，免 gist 爆 size。复用 AccountSection 的 canvas 模式（非 square，保比例）。

## 5. Claude Code 消费

```
gh issue list --repo <repo> --label feedback --state open
gh issue view <n>
```

读 → 改 → `gh issue close <n>`。用法模式，不内置进 App。

## 6. 测试

- Vitest 单测：`buildBody`（分段+图链）、`blobToBase64`、`ensureAssetsBranch`（404→建树/根提交/ref）+ `uploadImage` payload 构造（mock fetch）。
- E2E（390×844）：`/feedback` → 2 条建议各带 1 图 → mock `fetch`（branch probe + contents PUT × 2 + issue POST）→ 断言成功态显 URL + issue body 含两段+图链。
- 真实提交验证（开发者填 `.env.local` 后手测一次）：图片在 GitHub Issue 内可见。

## 7. 改动文件

- `docs/superpowers/specs/2026-07-19-feedback-feature-design.md`（本文件）
- `.env.example`：加 `VITE_FEEDBACK_GITHUB_TOKEN` + `VITE_FEEDBACK_GITHUB_REPO`
- `src/domain/types.ts`：加 `FeedbackItem`
- `src/ports/index.ts`：加 `FeedbackPort`
- `src/adapters/githubFeedback.ts`（新）
- `src/app/di.ts`：注入 `feedback`
- `src/ui/screens/feedback/index.tsx`（新）
- `src/ui/screens/settings/index.tsx`：加「使用反馈」行
- `src/app/router.tsx`：加 `/feedback` 裸路由 + lazy import
