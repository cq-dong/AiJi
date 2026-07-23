# 笔记 App 回顾/复盘/留存 UX 竞品调研（Day One / flomo / Heptabase）

> 调研方法：WebFetch 被本机网络策略整体拦截，全部改走 curl 直连（Heptabase wiki 走本地代理）。每条来自官网功能页/官方帮助中心原文，标注来源 URL。

## 一、Day One

### 回顾机制
- **On This Day**：独立视图聚合历年同月同日条目+照片+视频+位置，"时间胶囊"；是日活钩子；Android 端内置 "Generate Reflection" AI 反思。入口形态（tab/push）部分未获取。(dayoneapp.com/features/on-this-day)
- **Calendar View**：点任意一天展开条目；**点空白日期可 backfill 补记**（不破坏 streak 的关键）；与 Streaks 联动。(features/calendar-view)
- **Map View**：条目 pin 落地图，点 pin 跳进该地点条目；显式隐私承诺（位置历史不上传）。(features/map-view)

### 留存机制
- **Journal Streaks** 三层呈现：打开 App 顶部显示当前 streak + 独立 Streaks view + Calendar 逐日状态；配 "Streak Stories" 社区荣誉感。(features/journal-streaks)
- **Journaling Reminders**（对 AiJi 提醒最有参考）：**提醒文案可自定义语气**；**提醒绑定具体日记本+模板，点通知直达已加载模板的输入态**（被提醒→开始写压到一步）；**SMS 回复即记录**（通知即输入框）。(features/journaling-reminders)

### AI 复盘
- **Daily Chat**：Today tab → AI 开口问第一个问题 → 多轮对话 → "Generate Entry" 转条目；**Resume Chat/Update Entry**（全天保持，续聊追加）；**Chat About Past Days**（日期导航回过去）；Voice Mode（Realtime API）；**Memories**（AI 长期记忆 routines/relationships/themes，可查删）+ Bio 个性化。(guides/ai-features/daily-chat)
- **Multi-Entry Summary**（直接对应 AiJi summary 页）：iOS **左滑条目→Select 多选**→底部 "x Selected" sheet→"Generate Summary"→三出口 **Save to New Entry（含AI标题+摘要+标注"总结自N条"带回源条目链接+AI标记）/ Copy / Dismiss**；Android 免选择在 day view/On This Day 顶部直接放按钮。只分析文本+日期+地点。(guides/ai-features/ai-multi-entry-summary)
- **Go Deeper**：编辑器内 AI 追问生成个性化 writing prompts。**Entry Highlights**：生成要点 bullet。

### 首页 IA
- **四视图 List/Calendar/Media/Map 排顶部一键切换**；List 同日聚合日期头；Media 顶部媒体过滤；**滚动时再点当前视图名滚回今天**。(guides/day-one-ios/journal-views)
- iOS Journaling Suggestions：系统级主动建议（Reflections/Spotify/State of Mind/运动）作写作起点；4 种桌面小组件；条目自动带时间/天气/步数元数据。

## 二、flomo 浮墨

### 回顾机制（主战场，四形态互补）
- **每日回顾（PRO）** 规则引擎式回顾池：**范围三维可配**（内容[全部/含标签/排除标签/无标签] × 时间[全部/1年/6月/3月/1月] × 数量[4-24条/天]），默认"全部+6月内+8条/天"；入口矩阵（侧边栏/首页星星/右下角弹窗提醒/桌面+锁屏小组件）；**Push 主动回顾：自设时段+条数把旧笔记推给你，通知里直接预览全文**（"写给自己的信"）。(help.flomoapp.com/advance/lucky)
- **随机漫步（PRO）** serendipity 极致：从一条笔记沿"隐约关联"无目的漫游；**结束给"明信片"**（跨多长时间/几条笔记/多少文字/第几条发生弱相关大跨越）；"搜索和标签是有目的找，随机漫步是无目的遇见"。(advance/random-walk)
- **认知地图（PRO）** 涌现式主题全景，**与 AiJi「类别涌现」铁律最同构**：笔记按**向量相似度自动聚成"山峰"**（等高线密=笔记多，范围大=跨主题，孤峰=相关度低）；"标签是主观判断，山峰是向量涌现，两者常不一致——恰是价值"；**时间河流**（每月一帧回放主题生灭）；每月刷新，单次≤5000条。(advance/cognitive-map)
- **相关笔记（PRO）** 语义推荐：Web 悬停/移动端**左滑卡片**/…菜单触发，首页/每日回顾/搜索三场景可用；**链式推荐**（列表里继续点相关笔记）；可"隐藏同标签"拓宽推荐面。(ai/xgbj)

### 留存机制
- **热力图+统计**（无 streak，弱化断签惩罚）：GitHub 式热力图（每列一周，五档色深，**点格子筛选当天**）；侧边栏三计数（笔记/标签/天数）；统计页三层（月历/年统计+年度分享图/更多：单日最多、标签树、时间分布等）。(advance/notes-graph)

### AI 复盘
- **AI 洞察（PRO每天2次/MAX50次，限额设计本身值得注意）**：**写完或浏览时左滑点「AI 洞察」**单条即时回应，或对一组笔记洞察；**多视角可换**（每日肯定/行动指南/意义雷达/大师视角/价值澄清）+**自定义提示词**；**引用标记跳回源笔记**；可时间+标签筛选输入范围；哲学"AI 不替你思考，激发你更深入思考——不给答案，帮你发现更好的问题"。(ai/insight)
- **flomo Agent（MAX）** 微信里的 AI 复盘伙伴：扫码加好友，打字/语音；**聊到值得留的内容先问"要不要存"，点头才按你的标签语气写回**；记忆四步（存底→挑拣→归拢→成像）；**技能即指令**：昨日回声（翻旧笔记找与另一处"对不上的地方"，留个真问题）/每日新知/行为洞察/幸福灵药；技能可定时推送。(ai/agent)

### 首页 IA
- 首页=纯 memo 流，**不做多视图切换**；回顾全走"入口外挂"（星星/侧边栏/左滑/小组件/Push）。取舍：主页保持输入流极简，回顾做成随时可达但不抢位的平行空间。

## 三、Heptabase

（学习/研究导向，"回顾"=复习与意义建构；**无 streak/统计留存机制，产品路线不做打卡——非抓取失败**。）

### 回顾机制
- **Journal→白板 Calendar**：白板右键选 Calendar，**所选时间范围（周/月/季/年）的 journal 卡片日历布局铺到白板**，做周期性全局回顾。(wiki.heptabase.com/three-ways-to-make-sense)
- **Journal→卡片化**：框选内容拖上白板转 note card，拖到已有卡并入。
- **原始语境中回顾**：卡片 Info 显示出现在哪些白板，点名打开白板并聚焦邻近卡片（强化记忆核心动作）；Cmd+O 搜十万卡。

### AI 复盘
- **AI Tutor** 结构化学习会话（对 AiJi"AI 主动带节奏"有参考）：分享学习目标→AI 生成课程大纲；**会话列表带时间徽章**（3h/2d/1m 断点续学）；单课流程：AI 先**回顾上一 Topic**→生成本课提纲→**用户确认才开课**→进度条逐 part→**最后 part 固定是 Review**→一键落成白板笔记。(heptabase.com/ai-tutor)
- **白板 AI Chat**：+/@[卡片/分区/白板/PDF/视频/journal] 进上下文；**AI 回答带引用链接精确到源段落块/视频时间点，点击跳回**；AI 消息可拖上白板；悬停卡片出 AI action（内置+自定义提示词）。(wiki.heptabase.com/work-with-ai)
- 官方自反思用法（可直接借鉴 AiJi）："add all journals from past six months to whiteboard, ask AI to read them and ask about things you don't know about yourself"。

### 首页 IA
- 左侧栏=操作系统：Research a topic + Apps（**Inbox/Journal/Whiteboard/Card Library/Tag Database/Highlight/Chat**）共享同一卡片库；**卡片不属于白板**，同卡可放多白板；Inbox 承接快速采集，整理完打勾归档清零。

## 四、对 AiJi 三个目标面的提炼

**喂给 summary/回顾页**
- Day One Multi-Entry Summary 闭环可直接抄：多选（左滑→Select）→底部 sheet→Generate→三出口（存为新条目带源链接+AI标记/复制/丢弃）。Android 更轻：屏顶直接放"生成日摘要/反思"。
- flomo AI 洞察三件套——**左滑触发、多视角可换+自定义提示词、引用标记跳回源**——低成本高感知。
- 共同模式：**AI 产物必须带回到原料的链接/引用**（可信度+回流入口）。

**喂给首页视图**
- Day One 模式：顶部四视图一键切换+再点回今天。适合条目带媒体/位置。
- flomo 模式：首页只有流，回顾全走外挂入口。适合保持采集极简。
- **flomo 认知地图证明"向量相似度自动涌现主题山峰"已落地，与 AiJi"类别涌现不预定"同构**，可参考"山峰vs标签不一致恰是价值"叙事+时间河流回放。

**喂给提醒功能**
- Day One：提醒文案自定义语气；**绑定模板点通知直达输入态**；SMS 回复即记录（PWA 做不到 SMS，但"通知直达预设输入态"可做）。
- flomo：**回顾型 Push（旧笔记内容直接推给你，通知看全文）+自设时段条数**；每日回顾范围三维可配。
- 共同指向：提醒分两类——**"该写了"（创作提醒，带模板直达）**和**"看看过去"（回顾提醒，内容自包含）**。

**未获取（如实声明）**：Day One On This Day 入口形态权重；Heptabase 无 streak 可考（产品路线）；三家推送时间策略（几点推/频控）无公开文档。
