# 2025-2026 移动 App 交互设计模式目录（React PWA 落地版）

> 来源实际抓取验证：NN/g 12 篇全文、Apple HIG 6 篇、M3 6 页、Laws of UX。趋势节以 M3 Expressive(2025-05)+Apple(2025-09)+NN/g 2025-2026 新文为准。

## 1. 微交互
- **trigger-feedback 对**；按钮无反馈不构成微交互。三用途：传达状态、防错(undo)、品牌个性。(nngroup.com/articles/microinteractions)
- **按钮五态**：enabled/disabled/hover(延迟150-200ms)/focus(描边100-150ms)/pressed(100-150ms内必须反馈否则重复点)；长任务 loading 态 spinner→check。(/button-states-communicate-interaction, 2026-03)
- **状态切换 ~100ms**（M3 toggle 位移+变色+光晕100ms）；动画即状态信号+天然 undo。
- **完成确认+Undo toast**（Asana）；强化 Peak-End 正向结尾。(lawsofux.com/peak-end-rule)

## 2. 手势设计与 Discoverability
- **标准手势语义不可重定义**：tap=激活/swipe=露操作/drag=移动/long-press=上下文菜单/double-tap=缩放/pinch=缩放。自定义手势必须可发现+非唯一入口+避开系统手势区；快捷手势只补充不替代可见按钮。(Apple HIG gestures)
- **列表 contextual swipe 六则(NN/g)**：①滑动保持内容可见 ②破坏性动作二次确认或显著Undo ③只放破坏性操作 ④全app语义一致 ⑤不与导航滑动冲突 ⑥无signifier是先天缺陷需可见入口兜底。(/contextual-swipe)
- **long-press**：500ms定时器+10px容差，触发haptic，菜单从按压点浮出；务必同时给"更多"按钮。
- **触控目标 ≥44-48dp(1cm)**，主CTA/移动中场景放大到2cm；图标按钮用 padding 撑大 hit-area。(/touch-target-size, Fitts's Law)

## 3. 触觉反馈 Haptics
- **三类语义**：Notification(成败)/Impact(物理隐喻 light/medium/heavy)/Selection(值变化)。
- **克制七则**：语义固定/与视觉同步/宁少勿多/离散用短transient/必须可关/别干扰传感器/系统控件别重复。
- **PWA 现实**：web 仅 `navigator.vibrate`(Android Chrome)；**iOS Safari PWA 不支持 Vibration API**→封装 `haptic()` 门面：原生壳走 Capacitor Haptics，浏览器探测 vibrate，失败 no-op。适用：开关/long-press/swipe过阈/删除成功/刷新完成。

## 4. 动效与缓动
- **时长标尺(NN/g)**：总区间100-500ms，宁短勿长；简单反馈~100ms；大幅变化(modal/抽屉)200-300ms；≥500ms显拖；**进场比离场略长**；频率越高越短越淡。(/animation-duration)
- **缓动**：进场 ease-out(快起缓停)、离场 ease-in；M3 precise: Standard `cubic-bezier(0.2,0,0,1)`、decelerate(进场)`cubic-bezier(0,0,0,1)`、accelerate(离场)`cubic-bezier(0.3,0,1,1)`、Emphasized decelerate `cubic-bezier(0.05,0.7,0.1,1)`。M3时长token: short1-4=50-200ms、medium1-4=250-400ms、long1-4=450-600ms。
- **弹簧物理(2025 M3 Expressive)**：spring(stiffness/damping)取代duration+easing，分spatial(可overshoot)/effects(不可)。**Web换算曲线**：fast spatial `cubic-bezier(0.42,1.67,0.21,0.90)` 350ms、default spatial `cubic-bezier(0.38,1.21,0.22,1.00)` 500ms、slow spatial `cubic-bezier(0.39,1.29,0.35,0.98)` 650ms；fast/default/slow effects 150/200/300ms。framer-motion `type:'spring'` 适合跟手可中断动画。
- **路由转场六模式(M3)**：①container transform共享元素(卡片→详情、FAB→撰写，framer-motion layoutId) ②forward/backward水平滑动 ③lateral同级tabs ④top level底部tab淡出淡入 ⑤enter/exit组件从近边缘展开 ⑥skeleton loaders脉冲(左上→右下)+内容快速淡入覆盖。空间一致性：进出方向=它住在哪。
- **Apple总则**：动效有目的简短；高频交互别加自定义动效；可打断；方向合直觉。
- **reduced-motion(硬要求)**：`@media(prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important}}` 或 framer-motion `useReducedMotion()` 降级spring→fade。
- **滚动触发动画慎用**：任务型产品别用；只饰次要内容；只播一次；禁scroll-jacking。(/scroll-animations)

## 5. Bottom Sheet 与 FAB
- **Bottom sheet 红线(NN/g)**：①必须有可见Close按钮(grab handle易忽略+swipe ambiguity) ②支持Back关闭 ③禁止叠sheet ④只承载短交互不替代页面流。(/bottom-sheet)
- **M3**：modal≤50%屏高，超可上拉全屏；四种关闭路径(条目/scrim/下滑/close)；scrim点击=关闭；桌面换side sheet。React用 vaul 或 framer-motion `drag="y"`+吸附；接管 history Back。
- **Apple modality**：模态简单短单路径，不做"app里的app"，明显退出，一次一层。
- **FAB(M3)**：只放最重要建设性动作；一屏一个；medium默认；滚动时extended收缩为圆形；container transform展开为菜单/整屏；路由切换隐没-重现。

## 6. 骨架屏/加载态/空态
- **加载选型**：<1s什么都不放；1-10s整页→骨架、局部→spinner；>10s必须determinate进度条。骨架三型：静态线框(推荐)/脉冲/仅框架(禁用)。内容就绪快速淡入覆盖骨架。(/skeleton-screens)
- **进度准则(Apple)**：能determinate不用indeterminate；推进均匀诚实；保持动；不circular↔bar互换；附准确描述文字。
- **空态三职责**：①传达系统状态(空≠没反应，严禁先报无记录再替换) ②教学线索(pull revelation教功能) ③直达路径(放主操作CTA)。(/empty-state-interface-design)
- **反馈分级(Apple)**：状态信息被动就近嵌入；重要任务完成才确认；可预期结果不警告，意外不可逆损失才警告。

## 7. 下拉刷新 / 无限滚动 / 虚拟列表
- **Pull-to-refresh**：拖动露指示器→松手触发→留驻→完成收回；同时要有周期自动刷新；标题仅增量信息。PWA坑：Android原生下拉刷新会整页重载，需`overscroll-behavior-y:contain`接管自实现；阈值64-80px；iOS橡皮筋内部实现。
- **无限滚动**：适用同质内容流无目标浏览；六大坑(找不到旧内容/到底错觉/footer摸不到/可达性/页面重/SEO)；缓解=**Load More按钮**(附"已看N/共M")/整合分页/`role="feed"`。
- **滚动位置保存(生死细节)**：pogo sticking往返必须保存scroll位置；react-router `<ScrollRestoration>`或sessionStorage；长列表`@tanstack/react-virtual`虚拟化(先恢复数据再恢复scrollTop)。(/saving-scroll-position, 2025-07)

## 8. 2025-2026 趋势（有据）
1. **弹簧物理动效主流(M3 Expressive 2025-05)**：spring取代duration/easing，带overshoot，官方Web曲线。
2. **Apple Liquid Glass(2025-09)**：材质/半透明/流动系统语言(细节未深研)。
3. **移动交互收敛(NN/g 2025-06 State of Mobile UX)**：long-press取代3D Touch、边缘滑动返回统一；PWA与原生模糊；反面=overlay滥用+in-app browser。跟平台惯例(Jakob's Law)，控制弹层层级。
4. **状态系统化(NN/g 2026-03)**：按钮状态成设计系统一级公民。
5. **克制滚动叙事**：scroll动画只播一次只饰次要。
6. **AI界面**：NN/g AI交互研究(chatbot指南、AI解释、sparkles图标滥用)——可二轮。

## UX 定律速查
Doherty(<400ms响应)/Fitts(目标大近)/Hick(选项分层)/Jakob(跟惯例)/Goal-Gradient(进度促完成)/Peak-End(峰值结尾)/Zeigarnik(未完成挂心→草稿外显)/Aesthetic-Usability(美观=更好用)
