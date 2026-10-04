# D1 eng-debt 收尾波（feat/companion-echo）

> RSI 第 5 波（W0 → P-F → Q6 → A1 之后）。来源：Q6 OBS-4 + P-F MINOR-1 + A1 OBS-1
> 三条验收遗留 + perf 尾巴（W0 F1 + bundle 瘦身 + chat 窗口化）。目标：修齐存量缺陷
> 观察项 + 主 chunk 瘦身 + 长会话渲染性能，一波收尾不混功能。
> 铁律：子代理只写分配文件、不 commit/push、TDD 先红后绿、`npx tsc -p tsconfig.app.json`
> + `npx vitest run` 双绿才报完成。基线：**698/698（77 文件）+ tsc 0**。

## 现状（2026-10-05 lead 逐行核实）

### ① 视频时长探测 Infinity 泄漏（Q6 OBS-4）

- `src/adapters/webCapture.ts:342`：`resolve(Math.max(0.1, v.duration || 0))`——
  `Infinity || 0` 结果是 **Infinity**（Infinity 为 truthy），钳制失效。部分容器
  （无 duration 元数据的流式封装）Chromium 报 `duration=Infinity`。
- 下游：`capture/widgets.tsx:821` `Math.round(Infinity)` → durationSec=Infinity 落库；
  chip 渲染 `fmtDur(Infinity)`：`Math.floor(Infinity/60)`→"Infinity"，
  `Math.floor(Infinity)%60`→NaN → 屏上显示 **"Infinity:NaN"**。
- `fmtDur`（widgets.tsx:33-39）对非有限输入零守卫。

### ② P-F MINOR-1：新 op done 卡重复文案

- 验收记录（pf-companion-pack.md:101）：createReminder/deleteEntry 的 done 卡内嵌回执
  与 store 追加的独立回执消息渲染**同一句话**（同 key 同源），屏上出现两遍。
- 现场：`chat/index.tsx:554-559`（reminder done 渲 `chat.action.reminder.done` 全句）、
  `:560-565`（delete done 渲 `chat.action.delete.done` 全句）；对照 changeCategory done
  （`:546-553`）是紧凑式「✓ 《label》→「分类」」（纯数据无整句，与回执消息句子互补）。

### ③ 手搓弹层未接硬件返回（A1 OBS-1 扩编）

共享 `Sheet.tsx` 已接 `pushBackHandler`（A1 波）。以下手搓 `fixed inset-0` overlay
**全部未接**，native 下弹层开着按返回会直落路由回退（弹层随路由卸载）：

| 文件 | 行 | 形态 |
|---|---|---|
| settings/MemorySheet.tsx | :46 | 底部弹层 |
| settings/SearchSheet.tsx | :22 | 底部弹层 |
| settings/index.tsx | :344 / :482 / :598 | 三处手搓弹层（语言切换等，lane 自查逐一手搓 overlay 组件） |
| categories/CategoryEditSheet.tsx | :95（主）+ :239（嵌套确认，z-110） | 全屏编辑 + 嵌套确认 |
| categories/CategoryDetail.tsx | :92 | 底部弹层 |
| trash/index.tsx | :47 | 居中确认 dialog（role=dialog） |

### ④ perf 尾巴

- **seedSettings 静态导入**（W0 F1）：`store.ts:9` + `devSeed.ts:3` 静态
  `import { seedSettings } from '@/data/seed'` → 整个 seed.ts（全部样例条目）进主 chunk。
  `dexieStorage.ts:175` 已是动态导入；全仓非测试静态引用仅此两处。
- **openAiCompatLlm 静态导入**：`di.ts:3` 静态导入 → 全部 prompt 构建代码进主 chunk。
  `builtinLlm.ts:31` 也静态复用 openAiCompatLlm 的 prompt builder → **只动态化一个
  无效，两个都必须动态**。全仓非测试引用：di.ts（openAiCompatLlm+builtinLlm）+
  builtinLlm.ts（openAiCompatLlm），settings/chat/store 均不直接 import。
- **无 manualChunks**：vite.config.ts 无 build 配置，react-dom/framer-motion/dexie 等
  vendor 与业务代码混 chunk，缓存粒度差。
- **chat 无窗口化**：`chat/index.tsx:714-743` 全量 messages 一把渲染（对照 home
  P-A 已 PAGE=30 窗口化）。长会话（数百条）DOM 爆炸。分隔条派生 IIFE、seenIds、
  streamLen、贴底滚动逻辑都在 :629-656。

## 范围（四件，契约钉死）

### ① duration 钳制 + fmtDur 守卫（d1-fix）

- `webCapture.ts:342` 改为：
  `resolve(Number.isFinite(v.duration) ? Math.max(0.1, v.duration) : 0)`
  （保留 0.1 下限语义；Infinity/NaN → 0 = 探测失败缺省，与 onerror 路径一致）。
- `fmtDur`（widgets.tsx:33）函数体首行加：
  `if (!Number.isFinite(sec)) return '00:00'`。
- **非目标**：widgets.tsx:821 `Math.max(1, Math.round(...))` 不动（源已钳有限值）；
  detail/helpers.ts 不动（mediaType 优先判定）。

### ② 新 op done 卡紧凑化（d1-chat）

对齐 changeCategory done 的「紧凑式 + 句子互补」（卡=紧凑数据，回执句只由 store 的
独立消息承载）：
- createReminder done（:554-559）：改为 `✓ {reminderLabel ?? entryHint} · {dueText}`
  （Check 图标保留，纯数据，**不再渲 `chat.action.reminder.done` 全句**）。
- deleteEntry done（:560-565）：改为 `✓ 《{label}》→「{t('chat.action.delete.bin')}」`
  （新增 i18n key：`chat.action.delete.bin` zh「回收站」/ en「Trash」，与
  changeCategory 的「→「分类」」完美平行；**不再渲 `chat.action.delete.done` 全句**）。
- cancelled/notFound/pending/ambiguous 各态零改动；store 侧回执消息零改动。

### ③ chat 窗口化（d1-chat）

- 常量 `CHAT_WINDOW = 50`（模块级 export 供测试）；`const [limit, setLimit] = useState(CHAT_WINDOW)`；
  `visibleMessages = messages.length > limit ? messages.slice(-limit) : messages`。
- 分隔条派生 IIFE 的输入从 `messages` 改 `visibleMessages`（窗口首条 prevDay=null
  天然补分隔条 ✓）；seenIds/streamLen/hasStreamingMsg/自动滚动 effect 仍读**全量**
  messages（流式跟底不受窗口影响）。
- 顶部「加载更早」按钮：`messages.length > limit` 时渲染在分隔条列表最上方，文案
  `t('chat.loadEarlier', { count: messages.length - limit })`（新 key zh「加载更早的
  {count} 条消息」/ en「Load {count} earlier messages」），点击 `setLimit(l => l + CHAT_WINDOW)`。
- **滚动锚定**：点击瞬间记 `prevHeightRef = scrollHeight - scrollTop`，useLayoutEffect
  （deps=[limit]）恢复 `scrollTop = scrollHeight - prevHeightRef`——视口内容不跳。
- 会话切换重置：`useEffect(() => setLimit(CHAT_WINDOW), [conversation?.id])`。
- **非目标**：虚拟列表/IntersectionObserver 自动加载不做（按钮已够，YAGNI）；
  home 窗口化不动；HistorySheet 不动。

### ④ 手搓弹层接返回键（d1-sheets）

- 新 `src/ui/components/useBackDismiss.ts`：
  ```ts
  export function useBackDismiss(onClose: () => void): void
  ```
  实现镜像 Sheet.tsx:41-43 的 latest-ref 模式：
  `const ref = useRef(onClose); ref.current = onClose; useEffect(() => pushBackHandler(() => ref.current()), [])`。
- `Sheet.tsx` 重构为用此 hook（行为零变化，既有 sheetBackIme 测试防回归）。
- 上表 6 文件全部手搓 overlay 组件逐个 `useBackDismiss(onClose)`：
  - CategoryEditSheet 主层 + 嵌套确认层（:239）**都接**——嵌套后挂载居栈顶，LIFO
    天然先收确认层 ✓。
  - settings/index.tsx 三处 overlay 组件逐个接（lane 先确认各自 onClose prop 名）。
  - trash 确认 dialog 接（back = 取消 = onClose）。
- **非目标**：视觉/动画不改（不归一到共享 Sheet，零视觉回归风险）；web 端零行为
  变化（initBackButton native 自守卫，栈永不消费）。

### ⑤ perf 三件套（d1-perf）

**a. seedSettings 独立成模块**：
- 新 `src/data/defaultSettings.ts`：把 `seedSettings` 对象字面量从 seed.ts **剪切**
  过去（内容逐字不动），`export const seedSettings = {...} as const`→ 保持原类型。
- `seed.ts` 改 `export { seedSettings } from './defaultSettings'`（re-export，既有
  动态导入方零改动）。
- `store.ts:9` / `devSeed.ts:3` 改从 `@/data/defaultSettings` 导入。
- 验收证据：build 后主 chunk 不再含 seedEntries 样例文本（grep dist 产物）。

**b. di.ts llm 双动态导入**：
- 删 `di.ts:3` + `:18` 两行静态导入；加私有 helper：
  ```ts
  async function pickLlm(): Promise<LlmPort> {
    return (await readKeySource()) === 'builtin'
      ? (await import('@/adapters/builtinLlm')).builtinLlm
      : (await import('@/adapters/openAiCompatLlm')).openAiCompatLlm
  }
  ```
- llmProxy 每个方法改 `pickLlm().then((l) => l.xxx(...))`（透传参数个数逐字保持，
  既有 diProxy.test 的透传断言是防回归网）；`embed` 保持 builtin→null /
  byok→`l.embed?.(texts) ?? null` 语义。
- **stt 不动**（paraformer 在录音热路径外但本波 scope 只钉 llm）。
- diProxy.test.ts 若因静态 import 消失需调整 mock 方式，允许改测试文件，但既有
  断言（透传/builtin 路由/embed null）必须全保留。

**c. manualChunks**（vite.config.ts）：
```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        react: ['react', 'react-dom', 'react-router-dom'],
        motion: ['framer-motion'],
        data: ['dexie', '@tanstack/react-query', 'zustand'],
      },
    },
  },
},
```
- 门禁：`npm run build` 绿 + dist 出现 react/motion/data 三 vendor chunk。
- **非目标**：PWA workbox 配置不动（默认 glob 已覆盖新 chunk）；不做 prefetch 微调。

## 任务拆分（契约先行 → 4 路并行）

**Lead 契约 commit**：本文件。跨路接口钉死：`chat.action.delete.bin` /
`chat.loadEarlier` 两个 i18n key 命名、`useBackDismiss` 签名、`CHAT_WINDOW` 常量名、
`defaultSettings.ts` 路径。

| Agent | 独占文件 |
|---|---|
| d1-fix | src/adapters/webCapture.ts、src/adapters/__tests__/（既有 webCapture 测试文件内加用例）、src/ui/screens/capture/widgets.tsx、src/ui/screens/capture/__tests__/ |
| d1-chat | src/ui/screens/chat/index.tsx、src/ui/screens/chat/__tests__/、src/app/i18n/zh/chat.ts、src/app/i18n/en/chat.ts |
| d1-sheets | src/ui/components/useBackDismiss.ts（新）、src/ui/components/Sheet.tsx、src/ui/components/__tests__/、settings/MemorySheet.tsx、settings/SearchSheet.tsx、settings/index.tsx、categories/CategoryEditSheet.tsx、categories/CategoryDetail.tsx、trash/index.tsx、相关 screens __tests__/ |
| d1-perf | src/data/defaultSettings.ts（新）、src/data/seed.ts、src/app/store.ts（仅 :9 import 行）、src/app/devSeed.ts（仅 :3 import 行）、src/app/di.ts、vite.config.ts、src/app/__tests__/ |

防撞：四路文件集零交集（已逐路核对）。d1-chat 的 i18n 只碰 chat.ts；
d1-sheets 不碰 i18n（弹层无新文案）；d1-perf 的 store.ts 只许改 import 行。

## 测试要点（TDD）

- d1-fix：createElement('video') spy 造 `duration=Infinity` 的 fake element 触发
  onloadedmetadata → durationSec=0（有限）；duration=63.7 → Math.max(0.1,63.7)。
  `fmtDur(Infinity)`→'00:00'、`fmtDur(NaN)`→'00:00'、`fmtDur(65)`→'01:05' 防回归。
- d1-chat：构造 >CHAT_WINDOW 条消息的会话 → 只渲尾部窗口 + 顶部按钮显剩余数；
  点击 → limit 增加、更多消息渲染；窗口首条仍有 DateSeparator；流式消息（在全量
  尾部）不受窗口截断；会话切换 limit 复位。done 卡紧凑：op=createReminder/deleteEntry
  status=done 渲染 → 断言**不含** `chat.action.reminder.done`/`chat.action.delete.done`
  全句文案、含紧凑数据（label·time / 《label》→「回收站」）。i18n 双新 key zh+en。
- d1-sheets：useBackDismiss hook 单测（注册/unmount unregister/最新闭包——onClose
  换引用后触发调新引用）；Sheet 既有 4 测试防回归；代表性 overlay 各 1 用例
  （MemorySheet back→onClose；CategoryEditSheet 嵌套 LIFO——确认层先收；trash dialog
  back→onClose）。
- d1-perf：defaultSettings 导出形状与既有 seedSettings 字段一致（快照或键枚举断言）；
  seed.ts re-export 恒等（`seedSettings === (await import('./defaultSettings')).seedSettings`
  或 toBe）；di 动态：mock 两适配器模块，断言 byok/builtin 路由与既有透传断言全绿。
- 既有 698 测试防回归；全量绿才报完成。

## 验收（acceptance agent，静态 review + 浏览器 390×844）

1. 四路报齐 → lead 集成：tsc + vitest 全绿 + diff 逐行过 + `npm run build` 绿。
2. 用例：
   ① fmtDur 守卫 + 钳制：单测层证据复核（浏览器难复现 Infinity duration，静态 review
      webCapture diff + 测试记录）。
   ② done 卡紧凑：浏览器造一条 deleteEntry 确认卡走完全程 → done 态屏上只出现一次
      回执句（store 消息），卡片为紧凑式。
   ③ 窗口化：无现成 50+ 条会话时以单测为主 + 浏览器 smoke（chat 收发正常、
      分隔条正常、流式跟底正常）。
   ④ 弹层返回：dev server + WebPlugin 桥（A1 验收先例）→ MemorySheet /
      CategoryEditSheet（含嵌套确认 LIFO）/ trash dialog 各 back 一次 → 弹层收、
      路由不变。
   ⑤ perf：`npm run build` 后 `ls dist/assets`——react/motion/data vendor chunk 存在；
      主 chunk 不含 seedEntries 样例文本（grep 一条样例独有字符串）；
      openAiCompatLlm 的 prompt 文本（如 intent schema 特征串）不在主 chunk。
      浏览器 preview 起 app → 首页/chat/capture 冒烟正常（动态导入链路真实走通）。
3. 全绿 → lead commit（契约+四路+验收记录，~6 个语义 commit）→ 关单。

## 验收记录

（验收后由验收 agent 回填本节）
