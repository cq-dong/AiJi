# AiJi 前端实现现状调研报告

> 调研对象：`/Users/dcq/Desktop/AionUiSpace/AiJi`（v2.5.1-rc3，React 19 + Vite 8 + Tailwind 3.4 + Capacitor 8 + Zustand + Dexie）。纯只读分析，未改动任何文件。

## 0. 一句话总览

设计 token 与组件原语已相当成熟、但动效/手势层几乎全靠 CSS 类 + 偶发 PointerEvent 的移动端 PWA/壳应用。视觉精致度（阴影、圆角、渐变、深色模式）已打磨到位；**缺失的是"连续性交互动效"**（页面转场、卡片 swipe、下拉刷新、共享元素、列表退场、触感反馈）。全局**没有任何动画/手势/虚拟列表第三方库**。

## 1. design-system 组件清单（`src/ui/components/`）

共 14 个导出。全部为函数组件 + Tailwind class + cn()，无一个用动画库。

| 组件 | Props | 动效/手势 |
|---|---|---|
| Button | variant/size | transition-all + active:scale，无入场/ripple |
| Card | padded | 无 |
| Chip | tone(5色) | 无 |
| Skeleton | className/rounded | animate-shimmer |
| Spinner | size | animate-spin |
| EmptyState | icon/title/subtitle/action | animate-fade-in-up |
| Fab | 无 | transition-all + active:scale-90，无长按/拖拽 |
| NavBottom | 无 | 激活 pill 独立背景，无共享指示器/手势 |
| Statusbar | 无 | 无 |
| Sheet | title/onClose/children/footer | backdrop fade-in + panel slide-up，**无拖拽关闭/spring/exit** |
| ReminderCreator | entryId/title/suggestion/onDone/existing | fade-in-up |
| ReminderPopup | 无 | fade-in + slide-up |
| FiringReminderPopup | 无 | 红点 pulse，**无振动/触感** |
| cn | ...ClassValue | clsx+tailwind-merge |

**关键结论**：原语层齐全，但没有任何组件内置可复用手势或 spring 动画。Sheet 是最值得升级的原语。

## 2. 设计 tokens

- **颜色**：CSS 变量驱动双主题（page/card/ink/t2/t3/pri/priS/brd）+ 品牌静态色（catIdea/catProject/catPending/catFail）
- **圆角**：screen 32 / card 16 / chip 11 / btn 12 / fab 28
- **字号**：未自定义 scale，全用任意值 text-[11..34px]；Noto Sans SC
- **阴影**：sm/md/lg/sheet/card/cardHover/glowPri/glowPriSm/pop，深色提级
- **transition**：fast 150/base 200/slow 280ms；ease out/in
- **keyframes**：slide-up/fade-in/fade-in-up/scale-in/shimmer/indeterminate + 运行时注入 aji-wave/aji-pulse（capture）
- **animate-* 使用 76 处**；`prefers-reduced-motion` 已全局降级
- **safe-area**：`--safe-top/--safe-bottom` 原生注入（Android WebView 不支持 env()），PWA fallback 0；无 @supports 兜底

## 3. 布局骨架

- **MainLayout**：Statusbar + TopBar（问AI+搜索）+ main + Fab + NavBottom + ReminderPopup + FiringReminderPopup
- **BareLayout**：Statusbar + main + FiringReminderPopup
- **路由**：主路由 `//categories/summary/search/reminders/settings`；裸路由 `capture/detail/onboarding/login/drafts/trash/chat/feedback`；全 lazy+Spinner fallback；AccountGate+OnboardingGate 两层门
- **路由切换无转场动画**（无 AnimatePresence/View Transitions）

## 4. 逐屏现状（🟩丰富/🟨中等/🟥简陋）

- 🟩 **capture**：最丰富。compose/camera 双视图、AutoGrowTextarea、FlowPart 多媒体流、VoiceBar 自定义波形、InterimBubble、CameraView、SaveBar、Toast。缺：快门动效、真实音频采样波形、haptic
- 🟩 **detail**：record/source 双视图、AiPanel 三态、ImageZoomable 自写拖拽缩放、AudioPlayer、多个 Sheet/Toast。缺：swipe 切条目、共享元素转场、swipe 删除
- 🟨 **home**：TimelineCard stagger 入场（前8张延迟45ms）、JustSavedToast、OfflineBanner、RefreshIndicator。缺：**下拉刷新**、**swipe-to-archive/delete**、list 退场、虚拟化
- 🟨 **categories**：6 lens ViewSwitcher、CategoryCard 自写 long-press（500ms+10px容差）、PinnedCards、CategoryDetail。缺：长按无触感、无 swipe、网格无 stagger
- 🟨 **summary**：日/周/月 scope + 5档详细度、DigestCard 展开（max-height hack）、stale chip。缺：下拉刷新、height auto 测量、stagger
- 🟨 **chat**：UserBubble/AiBubble、CitationChips、TracePanel、LoadingBubble 三阶段、语音输入。缺：消息入场、打字机流式、swipe 删消息、历史删除用 confirm
- 🟨 **settings**（1560行）：iOS grouped-list、Toggle、SelectDropdown、多 sheet、ping 测试、导出。缺：sheet 转场、列表动画、Toggle spring
- 🟨 **feedback**：建议卡+textarea+图片上传（canvas压缩）。缺：拖拽排序、上传进度、stagger 退场
- 🟨 **search**：SearchBar 自动聚焦、5行 ChipRow 横向滚动、EmptySearch。缺：**debounce 动画、结果骨架、stagger、高亮匹配、最近搜索持久化**（recentEmpty 恒空）
- 🟥 **reminders**：最简陋。纯静态三段列表+按钮。缺：**swipe 完成/稍后**、倒计时动效、按时间分组、missed 重设
- 🟥 **drafts**：最简陋。纯列表+删除按钮+confirm。缺：**swipe 删除**、stagger、拖拽排序、预览
- 🟥 **trash**：最简陋。纯列表+恢复/删除按钮+倒计时文字。缺：**swipe 恢复/删除**、倒计时进度环、分组
- 🟥 **login**：简陋。品牌头+注册/登录卡。缺：密码可见切换、表单校验动效、品牌头动效
- 🟥 **onboarding**：简陋。单页堆叠所有内容。缺：**多步引导/轮播**、进度指示、特性动画

## 5. 全局交互基础设施

| 能力 | 现状 |
|---|---|
| 动画库 | ❌ 无 framer-motion/react-spring/GSAP |
| 手势库 | ❌ 无 @use-gesture/react-swipeable/hammerjs |
| 虚拟列表 | ❌ 无 react-window/@tanstack/virtual |
| 自写手势 | ✅ 仅 2 处 PointerEvent（CategoryCard long-press、PartView 图片缩放） |
| CSS 动效 | ✅ 6 keyframes + 76 处 animate-* |
| 触感反馈 | ❌ 无 haptics/vibrate |
| 下拉刷新 | ❌ 无 |
| swipe 手势 | ❌ 无（删除全靠按钮+confirm） |
| 路由转场 | ❌ 无 |
| 共享元素 | ❌ 无 |

- **store.ts**：UI 状态（hydrated/online/justSaved/pendingReminder/firingReminder/recalculating/capture/chatLoading/settings），**无动画/转场/全局 UI 状态机切片**
- **i18n**：✅ 完整 zh/en 双语，16 命名空间，useT() hook
- **PWA**：vite-plugin-pwa 手动注册，manifest 齐，**无 offline fallback 页/install prompt/skip-to-update UI**
- 已有：@tanstack/react-query、dexie、react-markdown、lucide-react、chinese-s2t

## 6. 样式实现方式

纯 Tailwind utility class + 大量任意值；唯一全局 CSS `src/index.css`（126行）；无 CSS Modules/styled-components/emotion；运行时 CSS 仅 capture 一处；Dark mode 完整（class + CSS 变量 + system 监听）

## 7. 交互美化机会点排序（收益/成本）

### Tier 1 — 全局基础设施（一次投入，所有屏受益）
1. 引入 framer-motion + @use-gesture/core
2. 路由级页面转场（AnimatePresence）
3. Sheet 原语升级（drag-to-dismiss + spring + exit）
4. SwipeableCard 原语（左滑删除/归档、右滑恢复）
5. haptics 适配器（Capacitor Haptics / navigator.vibrate）

### Tier 2 — 高频屏改造
6. home 下拉刷新 + 列表退场
7. reminders swipe 完成/稍后
8. drafts/trash swipe 删除/恢复 + trash 倒计时进度环
9. search 骨架 + stagger + 高亮 + 最近搜索
10. chat 流式打字机 + 入场动画

### Tier 3 — 中低频低成本高观感
11. capture 真实音频采样波形 + 快门动效
12. onboarding 多步轮播 + 进度点
13. login 表单动效
14. NavBottom 共享指示器滑动（layoutId）
15. settings Toggle spring + 触感
16. summary DigestCard height auto + stagger
17. 全局 Toast 统一（当前 3 份重复）

### Tier 4 — 锦上添花
18. FAB 长按快捷菜单
19. home 头像环点击 + 下拉过头动画
20. detail 图片双指缩放 + 双击复位

## 总结判断

设计层已打磨到位，**瓶颈在交互连续性**：切页硬切、Sheet 无拖拽、列表无 swipe、无下拉刷新、无触感、无路由转场、无虚拟列表、Toast 三份重复。落地优先级：**先 Tier 1 基建（杠杆最大），再 Tier 2 四个列表屏，search/chat 流式次之，onboarding/login 收尾**。
