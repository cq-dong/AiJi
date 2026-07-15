# AiJi UI 验收缺陷日志

迭代循环（lead 编排，subagent 执行）：
**全量验收 → lead 整理/分诊 → fan-out 修复（按屏并行，共享文件串行）→ 全量端到端复验（重点核已修 bug 是否真修好 + 无回归）→ 重复至验收报告 LGTM。**

本文件是 fix/verify subagent 之间的共享状态（subagent 无 per-member 记忆，唯一持久的真相源是代码 + 本文件）。fix subagent 修完置 🟢，verify subagent 复验通过置 ✅，未过重开 🔴。

## 状态约定
- 🔴 open · 🟡 fixing · 🟢 fixed（待复验）· ✅ verified · ⚪ wontfix（刻意偏差，见下）

## 刻意偏差（勿报为 bug，不进缺陷表）
- home：卡标题/预览取 seed（非 Figma 占位）；今天计数=seed 真实条数（2，非 "12"）；星期按 ISO 实算；"AI 已分类" 圆点用 Figma 紫 `#7c3aed`；头像 pri 内圆保白字可读。
  - 注：曾把"真实保存后头部日期跳到真今天"列为刻意偏差——**iter1-verify 证伪**：实际并不跳（D4 时区 bug 所致）。D4 修好后才会跳，届时属正确行为。
- detail：顶栏标题=条目日期（非"条目详情"占位）；返回 ‹ 26px/light/t2；transcript 在 player 上方 ink 色；ready+errand/event 显 TodoConfirm 卡。
- search：空态用 Figma 布局（最近+建议）非居中 EmptyState；SearchBar 自动聚焦显 focus ring。
- settings：微信/QQ 用品牌色 `#12ac50`/`#1f7ccc`（spec）。
- categories：卡点击跳 `/`（过滤视图留 v2）。

## 缺陷表
| ID | 严重度 | 屏 | file:line | 描述 | 状态 | 修迭代 | 复验 |
|----|--------|----|-----------|------|------|--------|------|
| D1 | major | home/capture | src/app/store.ts:47-65; src/ui/screens/home/index.tsx:24-55 | golden path 断裂：`finishSave` 旧实现只清草稿、不落库、不置 justSaved；首页 toast 仅 `?demo=justsaved` 门控。 | ✅ verified | iter1-fix | iter1-verify |
| D2 | minor | home | src/ui/screens/home/helpers.ts:29-32 | 月份 off-by-one：`monthDayLabel` 直接打印 0-indexed `m` → 7月 seed 显示"6月"。 | ✅ verified | iter1-fix | iter1-verify |
| D3 | major | summary | src/ui/screens/summary/index.tsx:22 | scope tab 只改按钮高亮，`seedAggregates.map` 始终渲染全部聚合。 | ✅ verified | iter1-fix | iter1-verify |
| D4 | minor | home | src/ui/screens/home/helpers.ts:5-23,58-63; src/ui/screens/home/index.tsx:53 | 时区日期 bug：新条目 `createdAt=new Date().toISOString()`（UTC `Z`）vs seed `+08:00`；旧 `todayKeyFrom`/`dateKey`/`timeLabel` 裸 `slice` → UTC↔本地偏移窗口内 todayKey 取 UTC 日期、头部不跳真今天、新卡并入昨日。修：三函数改走 `new Date(iso)` 取本地年月日/时分；`todayKeyFrom` 的 max 比较由字符串改为 `getTime()` 时序（字符串比较在跨时区 ISO 上非时序，是同根第二处）；`home/index.tsx` `sorted` 同改 `getTime()` 差。store.ts 不动（存 UTC ISO 是正确的绝对瞬时）。 | ✅ verified | iter2-fix | iter2-verify |

## 迭代报告
- **iter1-verify (2026-07-16, 完成, LGTM)**: 全量端到端验收。3 修复全部确认（硬证据：toast 3.49s 自收、计数 2→3、卡置顶；月份"7月15日 周三"；scope 日/周/月切换 + tap-flip）。3 遗漏屏全过（search 空/匹配/过滤/无果/清空/→detail；settings 主题/定位 switch/AI 行/导出；onboarding 欢迎/key/权限/CTA→/）。回归无（home 5 变体、detail e1/e6/e7/DemoToggle/e8/不存在、categories）。控制台 0 错 0 警。token 经 `getComputedStyle` 逐项精确匹配。新增 1 minor：D4 时区日期。截图存 `.e2e_shots/`。
- **iter1-fix (2026-07-16, 完成)**: `fix` agent 修 D1/D2/D3，`npx tsc -p tsconfig.app.json` EXIT=0。lead 已读改后源码确认 3 处修复属实。变更文件：store.ts / home/index.tsx / home/helpers.ts / summary/index.tsx。未 commit/push。
- **iter2-fix (2026-07-16, 完成)**: lead 直接修 D4（单屏 2 文件 ~12 行，不值得 round-trip 子代理）。`todayKeyFrom`/`dateKey`/`timeLabel` 改 `new Date(iso)` 本地解析；补修 `todayKeyFrom` 的 max 比较与 `home/index.tsx` `sorted` 的字符串比较→`getTime()` 时序（同根第二处，iter1-verify 未单列）。`npx tsc -p tsconfig.app.json` EXIT=0。待 iter2-verify 复验。
- **iter2-verify (2026-07-16, 完成, LGTM)**: D4 复验通过（核心）。**D4 核验**：golden path 保存后头部跳到浏览器本地真今天"7月16日 周四"（TZ Asia/Shanghai +08，实测 01:56/02:00 存盘——正是 iter1 D4 触发的 UTC↔本地偏移窗口，UTC `2026-07-15T18:00Z`）；新条目并入"今天"分组（计数 1），seed 7/15 并入"昨天"，7/14 并入"7月14日 周二"绝对日期。**组内排序**：`sorted` 改 `getTime()` 后跨 +08/Z 格式时序正确——新 Z-ISO 条目置顶（旧 `localeCompare` 会误排到 e1 后，已验证）。**timeLabel**：逻辑复现 fixed 对 Z-ISO 返回 "2:00"（本地=localHM），旧裸 slice 返回 "18:00"（UTC，错）；+08 seed 两者同"8:12"无回归。**D1 无回归**：in-page click+poll 精测 toast appeared 1330ms / dismissed 4869ms / duration 3539ms ≈ 3.5s。**隔离确认**：grep 证实无他屏 import home/helpers（detail/search/categories 各有自带 helpers），D4 影响面仅 home。**回归全扫 8 屏通过**：home 5 变体（empty/justsaved/refresh/failed/offline）+ post-save；capture 录/停/存；detail e1/e6/nonexistent+DemoToggle；categories 5 卡+演示空态；summary 周/日/月 scope+tap-flip（top→正在重新生成）；search 空/匹配(地铁→e1+e9)/无果/清空+autofocus+filter chips；settings 主题亮→暗→跟随系统 active 切换+record-location switch aria-checked false→true→false+AI 行+导出；onboarding 请求权限→已授权+CTA→/。**运行时**：控制台 0 错 0 警；网络 0 4xx/5xx（1 GET 200）。**token**：getComputedStyle 逐项精确匹配（page #f7f7fa / card #fff / ink #14141a / pri #4f46e5 / priS #eeedfd / brd #ececef / Noto Sans SC / radii card 16 / fab 28）。D1-D4 全 ✅，无新缺陷、无回归。截图 `.e2e_shots/iter2_*`。

## 已知限制（非活跃，后续数据接入时修，勿在当前验收报为 bug）
- `search/helpers.ts:82` 与 `categories/index.tsx:14` 用 `createdAt.localeCompare` 排序/取最新。当前只操作 `seedEntries`（全 `+08:00` 同偏移，字符串序=时序），**非活跃**。后续 Dexie StoragePort 把这两屏接到 runtime store entries（`+08:00`/`Z` 混合）时，须一并改 `getTime()` 差，否则重现 D4 类时序错乱。
