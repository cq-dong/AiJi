# A1 Android 壳三件套（feat/companion-echo）

> RSI 第 4 波（W0 → P-F → Q6 之后）。来源：2026-10-04 五路审计 audit-ux/debt 方案 +
> Q6 验收后链路盘点。目标：APK 实机体验流畅度——键盘遮输入、返回键行为、状态栏隐形
> 三个原生壳硬伤一次修齐。
> 铁律：子代理只写分配文件、不 commit/push、TDD 先红后绿、`npx tsc -p tsconfig.app.json`
> + `npx vitest run` 双绿才报完成。a1-native 无 vitest，门禁 = gradle 编译 + 静态 review。

## 现状（2026-10-05 lead 链路盘点，逐行核实）

- MainActivity 已有 D1/D2 edge-to-edge + D26 systemBars insets ÷ density 注入
  `--safe-top/--safe-bottom`，D12 splash，mixed-content 放行。**未注入 IME insets**
  → 软键盘顶起时 WebView 不 resize（decorFits=false），底部输入面被遮。
- `@capacitor/app@8.1.1` 已装，**全仓无 `App.addListener('backButton')`** → 任意屏按
  返回直接退 app（sheet 不收、路由不退）。
- styles.xml / MainActivity **均未设 `windowLightStatusBar` /
  `setAppearanceLightStatusBars`** → edge-to-edge 后浅色 app 背景（#f7f7fa）衬白图标，
  状态栏时间/电量不可见。导航栏同理。
- 输入面盘点：chat composer（BareLayout 内 `flex h-full flex-col` 底部 textarea，
  chat/index.tsx:788）；capture 文本区 + 浮动操作条；Sheet 面板（ReminderCreator /
  CategoryEditSheet / feedback 等含输入，面板 `pb-4` 硬编码，Sheet.tsx:63）。
- BareLayout `<main>` 现 `paddingBottom: var(--safe-bottom, 0px)`（AppShell.tsx:110）。

## 范围（三件，契约钉死）

### ① 键盘避让（IME insets 注入 + 两个消费点）

**a1-native**（MainActivity.java，沿用 D26 模式）：
- 同一 `setOnApplyWindowInsetsListener` 内增取 `WindowInsetsCompat.Type.ime()` 的
  bottom，÷ density 得 imeCss，注入 `--safe-ime`（键盘收起时系统报 0，天然回落）。
- 一行 JS 同帧设三个变量（--safe-top/--safe-bottom/--safe-ime），不新增 listener。

**a1-ui**（消费点，CSS `max()` 字符串，web 端 var 缺省 0 → 零行为变化）：
- `AppShell.tsx` BareLayout `<main>`：
  `paddingBottom: 'max(var(--safe-bottom, 0px), var(--safe-ime, 0px))'`
  （一处改动覆盖 chat/capture/detail/全部裸路由——in-flow 底部输入面随 main 内缩顶起）。
- `Sheet.tsx` 面板 `pb-4` → style
  `paddingBottom: 'max(16px, var(--safe-bottom, 0px), var(--safe-ime, 0px))'`。
- **非目标（钉死防 scope creep）**：MainLayout 不动（主路由无底部输入面；键盘遮
  NavBottom 是系统常态，搜索框在顶部不受影响）；visualViewport PWA 路径不做
  （PWA 浏览器自 resize，var 缺省 0 无回归）。

### ② 硬件返回键（LIFO 栈 + 路由回退 + 首页双击退出）

**a1-app** 新 `src/app/backButton.ts`：
```ts
export function initBackButton(): void        // main.tsx 调，native-only（isNativePlatform 守卫）
export function pushBackHandler(fn: () => void): () => void  // 注册=返 unregister
```
- 模块级 `stack: (() => void)[]`；`App.addListener('backButton', cb)` 策略（钉死顺序）：
  1. `stack.length > 0` → pop 栈顶 fn 执行（LIFO，后开先收）→ return。
  2. `location.pathname !== '/'` → `window.history.back()` → return。
  3. 首页：双击退出——首按 `useUiStore.setState({ exitArmed: true })` + 2s 后自动
     复位 false；2s 窗内再按 → `App.exitApp()`。
- **栈语义不用 CustomEvent/preventDefault**（多 sheet 并存时事件序不确定；栈 LIFO
  确定性语义，Sheet 是唯一 v1 消费者）。
- `src/app/store.ts` UiState 加 `exitArmed: boolean`（缺省 false，只 setState 不落库）。
- `main.tsx` native 块调 `initBackButton()`（import 静态即可，函数内自守卫）。
- i18n `common.exitConfirm`：zh「再按一次退出」/ en「Press back again to exit」。

**a1-ui**：
- `Sheet.tsx`：`useEffect(() => pushBackHandler(dismiss), [])`——dismiss 已含下拉
  动画 + onClose 回调；unmount 自动 unregister。**每个 Sheet 实例各注册一份**
  （多开时栈顶=最后挂载的，天然 LIFO）。
- AppShell 两个 layout（MainLayout + BareLayout）仿 `FiringReminderPopup` 模式渲染
  退出 Toast：`<AnimatePresence>{exitArmed && <Toast message={t('common.exitConfirm')}
  ok onDismiss={...} />}</AnimatePresence>`。Toast 3.5s 自动消 vs 2s 武装窗的 1.5s
  视觉尾巴无害（窗外再按只重置武装不退出），记录在案不另做。

### ③ 浅色状态栏 + 导航栏图标

**a1-native**（MainActivity.java onCreate，decorFits 之后）：
```java
WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
ic.setAppearanceLightStatusBars(true);      // 深图标衬浅色 app 背景
ic.setAppearanceLightNavigationBars(true);
```
- app 仅浅色主题（无 dark mode），常量 true 即可；splash 期（品牌紫底）短暂深底白图标
  属系统 splash 行为，不管。
- import `androidx.core.view.WindowInsetsControllerCompat`。

## 任务拆分（契约先行 → 3 路并行）

**Lead 契约 commit**：本文件。跨路接口钉死：`--safe-ime` 变量名、
`initBackButton`/`pushBackHandler` 签名、`exitArmed` 字段名、`common.exitConfirm` key。

| Agent | 独占文件 |
|---|---|
| a1-native | android/app/src/main/java/com/cqdong/aiji/MainActivity.java |
| a1-app | src/app/backButton.ts（新）、src/app/store.ts、src/main.tsx、src/app/__tests__/backButton.test.ts（新）、src/app/i18n/zh/common.ts、src/app/i18n/en/common.ts |
| a1-ui | src/ui/components/Sheet.tsx、src/ui/layout/AppShell.tsx、src/ui/components/__tests__/（新测试放这）、src/ui/layout/__tests__/（若已有目录沿用） |

防撞：android/** 只 a1-native；store.ts/main.tsx/i18n 只 a1-app；components//layout/ 只 a1-ui。
a1-ui import `pushBackHandler`（a1-app 导出）按契约签名写，集成期 tsc 对齐（Q6 先例）。
a1-app 不 import a1-ui 任何东西；AppShell 渲染 Toast 读的 `exitArmed` 由 a1-app 加进 store。

## 测试要点（TDD）

- a1-app：mock `@capacitor/app`（addListener 捕获 cb / exitApp spy）+
  `@capacitor/core`（isNativePlatform true/false）。
  非 native 不注册；栈空 + 非首页 → history.back；栈非空 → LIFO 只弹栈顶（两个
  handler 注册，一次 back 只调后者）；unregister 后不再调；首页首按 → exitArmed=true
  且不 exitApp；2s 内再按 → exitApp；2s 后再按 → 重新武装（fake timers）。
- a1-ui：Sheet 挂载 → 模拟硬件返回（经 backButton 栈 pop）→ onClose 被调；卸载后
  再触发 → onClose 不再调。Sheet 面板 style 含 `max(16px, var(--safe-bottom` +
  `--safe-ime`。BareLayout main style 含 `max(var(--safe-bottom, 0px), var(--safe-ime`。
  exitArmed=true 时两 layout 各渲出 exitConfirm 文案。
- a1-native：`cd android && ./gradlew :app:compileDebugJavaWithJavac` 通过；
  diff 静态 review（insets 三变量同帧注入、ime 取 Type.ime()、density 除法、
  appearance 两行）。
- 既有 677 测试防回归。

## 验收（acceptance agent，静态 review + 浏览器 390×844）

1. 三路报齐 → lead 集成：tsc + vitest 全绿 + diff 逐行过。
2. 用例（browser 可验部分）：
   ① Sheet 打开（如 categories 编辑）→ `window` 上模拟 backButton cb（经测试桥或直接
     调 backButton 内部栈）→ sheet 关闭且路由不变。
   ② 非首页（/settings）模拟 back → 回退到 /。
   ③ 首页模拟 back ×1 → Toast「再按一次退出」出现；×2（2s 内）→ exitApp 被调
     （webview 环境 mock 观察）。
   ④ 注入 `--safe-ime: 300px`（documentElement style）→ chat 屏 composer 区域
     bottom padding ≥300px（getComputedStyle）；Sheet 面板 paddingBottom ≥300px。
   ⑤ MainActivity diff 静态复核：ime inset + density 换算 + appearanceLight 两行 +
     既有 systemBars 注入不破坏。
3. 全绿 → lead commit（契约+三路+验收记录，4-5 个语义 commit）→ 关单。
4. 实机验证留给用户：APK rc 出包后键盘/返回/状态栏三项手测（记录在验收文档「待实机」节）。

## 验收记录

验收人：accept-a1（独立验收，非实现者）· 日期：2026-10-05 · 分支：feat/companion-echo
范围：`git diff 6562513^`（9 文件）+ 未跟踪 A1 新增 4 文件静态复核 + 浏览器联合测试。

### 执行方式

- 静态门禁（验收方独立复跑）：`npx tsc -p tsconfig.app.json` exit 0；`npx vitest run`
  **77 文件 698/698**；`cd android && ./gradlew :app:compileDebugJavaWithJavac`
  **BUILD SUCCESSFUL**（Temurin 21 @ /tmp/jdk21，AGENTS.md §4 命令）；7 项不变量逐行人工核对。
- 浏览器：**vite dev server**（非 prod preview）+ Playwright MCP，视口 390×844。
  选 dev 的理由：用例 ①②③ 需触达模块级 backButton 栈与 Capacitor 对象——prod bundle
  无模块寻址能力，dev 下经 `import('/src/app/backButton.ts')` 拿到与 app 同实例的模块图。
  桥接设计：`Capacitor` 是普通对象（非 freeze）→ `isNativePlatform=()=>true` 直改生效；
  `App` 是 `new Proxy({},{get})`（get trap 拦截一切读，**赋值静默无效**）→ 改打
  `WebPlugin.prototype.addListener`（捕获 backButton cb）+ `WebPlugin.prototype.unimplemented`
  （计数 = exitApp 触达证据，测试窗内唯一 App 调用）；随后真调 `initBackButton()` 注册。
  每用例前清 SW + localStorage + IndexedDB；`aiji:onboarded=1` + 游客「开始记」进首页。

### 静态复核（7 项不变量，全部合规）

1. **MainActivity** — `MainActivity.java:55` ime 取 `Type.ime().bottom`；`:58`
   `Math.round(ime / density)`；`:59-61` 一条 JS 同帧注入 --safe-top/--safe-bottom/--safe-ime
   三变量（未新增 listener）；`:39-41` appearance 两行在 `:35` decorFits 之后，import
   `WindowInsetsControllerCompat`（`:9`）；既有 D26 systemBars 取值/换算/`return insets`
   未破坏（`:49-50,:56-57,:65`），D12 splash / mixed-content / 插件注册原样。✓
2. **backButton 三层顺序** — `backButton.ts:54-58` 栈顶 pop 执行 return → `:60-63` 非首页
   `history.back()` return → `:65-79` 首页双击退出（armed+2s 定时器 / 窗内 exitApp），与契约
   钉死顺序一致；`pushBackHandler:38-47` unregister 靠 `active` 标志幂等，back 键 pop 后
   Sheet 卸载时的 unregister 命中 `indexOf=-1` no-op（配对不错乱）。✓
3. **Sheet dismissRef 模式** — `Sheet.tsx:41-43`：`useRef` + 每渲染 `dismissRef.current = dismiss`
   （latest-ref，无旧闭包；render 期赋值幂等，StrictMode 双渲染安全）；effect 空依赖
   `useEffect(() => pushBackHandler(() => dismissRef.current()), [])`，cleanup=unregister。✓
4. **AppShell** — `AppShell.tsx:69` MAIN_BOTTOM_CLEARANCE `calc(161px + var(--safe-bottom, 0px))`
   未动（契约非目标 ✓）；BareLayout `:137` main 与 `:139` PageTransition bottomPad 两处
   `max(var(--safe-bottom, 0px), var(--safe-ime, 0px))` 字符串完全一致；ExitToast 私有组件
   MainLayout `:117` + BareLayout `:144` 双挂。✓
5. **store** — `store.ts:65,511` exitArmed 初始 false，仅 backButton.ts/AppShell setState
   （grep 全仓无第三写入点），hydrate 路径不涉及（Dexie 载入字段枚举不含 exitArmed）。✓
6. **i18n** — zh `common.exitConfirm`「再按一次退出」+ en「Press back again to exit」双有。✓
7. **越界检查** — diff 9 文件全在契约任务拆分表内（AGENTS.md +11 行为 lead 集成 JDK 21
   命令记录，排除项已申报）；新增 4 文件（backButton.ts + 3 测试）归属 a1-app/a1-ui 独占
   目录。`src/data/__tests__/dbv9.test.ts`（8月8日遗留未跟踪，非 A1）见 OBS-3。✓

### 用例证据表

| # | 用例 | 结果 | 关键证据 |
|---|------|------|---------|
| ① | Sheet 返回键 | **PASS** | /chat 点「历史」开 HistorySheet（共享 Sheet，`role=dialog`「历史对话」）→ `__fireBack()` → 400ms 轮询内 dialog 卸载（dismiss 弹簧下滑 + AnimatePresence 退出），路由仍 `/chat`，exitCalls=0 |
| ② | 非首页回退 | **PASS** | 栈空 + `/chat` → back → `history.back()` 落 `/settings`；再按 → 落 `/`；exitCalls=0（未误触退出层） |
| ③ | 首页双击退出 | **PASS** | `/` back×1 → `[role=status]`「再按一次退出」出现、exitCalls=0；2s 窗内 ×2 → exitCalls=1，`lastUnimplemented="Not implemented on web."`，console error 调用栈 `AppWeb.exitApp → CapacitorException`（**web 限制**：真退出留实机，触达即证据）；2.2s 后 ×1 → Toast 再现（重新武装）、exitCalls 仍 1 |
| ④ | IME 消费 | **PASS** | `/chat` main 基线 `0px` → 注入 `--safe-ime:300px` → computed `300px`；Sheet 面板 computed `300px`；设回 `0px` → main 回落 `0px`、面板回落 `16px`（max(16px,…) 基线，键盘收起天然回落） |
| ⑤ | native 静态 | **PASS** | 同不变量 ①（独立复核结论一致）+ gradle 编译验收方复跑 BUILD SUCCESSFUL |

### Findings

- **OBS-1（观察，契约范围外）** `src/ui/screens/settings/MemorySheet.tsx:45` — MemorySheet 是
  手搓 `fixed inset-0` overlay（无 role=dialog、未接 pushBackHandler）；同类手搓弹层还有
  语言切换 sheet（settings/index.tsx:1134 注释自证「仿 MemorySheet」）。native 下这些弹层
  打开时按返回不会先收弹层，而是直落路由回退（弹层随路由卸载）。契约钉死「Sheet 是唯一 v1
  消费者」，故非缺陷；建议后续波把这些手搓弹层归一到共享 Sheet 或各自接 pushBackHandler。
  （验收用例 ① 因此改走 HistorySheet——契约允许自选稳定路径。）
- **OBS-2（观察，契约语义内）** `backButton.ts:54` — pop-then-execute：Sheet dismiss 弹簧
  动画窗口（~0.5s）内栈已空，此间再按 back 会落路由/退出层。快速双击返回理论上「收 sheet +
  退一屏」二连；单测已钉死 pop-first 语义（契约本意），触发面窄，记录不另做。
- **OBS-3（housekeeping）** `src/data/__tests__/dbv9.test.ts` — 8月8日遗留未跟踪文件（早于
  本波两月，v9 schema 测试），非 A1 产物；建议 lead 顺带决定 commit 或删除。
- 用例 ③ Toast 3.5s 自消 vs 2s 武装窗的 1.5s 视觉尾巴：契约 §范围② 已记录在案不另做，实测
  无碍（窗外再按只重新武装不退出，已验）。

### 结论

**LGTM**。7 项不变量全合规、5 用例全 PASS、门禁三绿（tsc 0 / vitest 698/698 / gradle
BUILD SUCCESSFUL，均为验收方独立复跑）。满足契约「全绿 → lead commit」。

### 待实机（用户手测，APK rc 出包后）

1. 键盘：/chat composer、Sheet 内输入（ReminderCreator/CategoryEditSheet）弹起软键盘 →
   输入面被顶起不遮；收起键盘 → 回落。
2. 返回键：Sheet 开着 → 先收 Sheet；非首页 → 退一屏；首页 → Toast → 2s 内再按真退出。
3. 状态栏/导航栏：浅色背景下时间/电量/手势条为深色图标、清晰可读（splash 期短暂白图标
   属系统行为，契约已免责）。
