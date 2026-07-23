# AI 原生笔记竞品「捕捉与组织 UX」调研（MyMind / Mem.ai / Capacities / Reflect）

> 调研日期 2026-07-23。方法：curl 直抓官网+官方帮助中心（WebFetch 被本机拦截，helpscout/docs 子域走代理）。四款均获取有效信息。

## 1. MyMind —— 零整理全自动流派
- **捕捉**：share sheet 全程不开 App，存完弹确认浮层（双击卡片加批注 Mind Note）；智能书签按内容类型落不同版式卡（文章/产品/书/菜谱/Quote/Todo）；Quick Note 默认单行，点进去才"温柔展开"避免创建文档的心理负担；`/` 快捷格式；写长一键入 Focus Mode。
- **组织呈现**：全自动打 auto-tags（展开可见+追加手动标签，右键加标，SHIFT 批量）；**AI 打错不给逐条编辑 UI，纠错转嫁反馈表单**；卡片类型可用 `#todo/#quote/#highlight` 强制覆盖；**Smart Spaces=把搜索存成动态集合**（命名+选色，匹配条件卡自动流入，可手动增删+拖拽排序）；语义搜索操作符 `object:/text:/format:/site:/tag:` + 逐词回车叠加 Deep Search；常用搜索一键转 Space。
- **详情**：TLDR 区（AI 摘要，笔记类随编辑重算）；**Same Vibe 一键找同氛围图聚 moodboard**；Mind Links `[[` 双链；**Notes Bump** 最近编辑卡浮顶。
- **主动（再发现）**：**Serendipity** 手动 2 分钟仪式——翻旧卡逐张选 keep/discard，误删 30 天 Trash 搜回；**Top of Mind** 拖到搜索栏下置顶（移动端横滑浏览）。
- **移动手势**：share sheet 不离开当前 App；TOM 横滑；OCR 全图文字可搜。

## 2. Mem.ai —— Workspace+主动Agent 双产品（agent 化最激进）
- **捕捉**：四通道（语音/会议日历/网页/移动）；**Voice Mode** 录+实时转写+实时组织，结束生成结构化笔记后 **Accept 直接收 / Refine 给一句指令再打磨**，原音+逐字稿作附件可回放对照+二次回填；日历联动只显≥2人会议（降噪），会前通知一键入会，**ad-hoc 通话也检测推送"要录音吗"**；**agentic Web Clipper** 存页自动摘要+自动归 Collection，弹窗指令框自然语言控制归档，`#`指定 collection `@`追加笔记。
- **组织**：**Collections 人机共治**（"Your structure stays visible and editable"，AI 批量整理但结构可见可改）；可对 Chat 说"基于最近笔记该建什么 collections"AI 提案确认应用；编辑器内 **Clean Up** 凌乱草稿一键整理。
- **详情 Heads Up 右侧情境栏**：打开笔记瞬间浮现相关笔记，分 **Timeline**（某人/系列会议历史串线）+ **Related Topic bundle**（主题相关旧剪藏/大纲/草稿）；**Find More** 扩召回；一键切 Mem Chat 深查（"Heads Up 是拍肩，chat 是深潜"）；**Briefings** 会前自动生成简报可点赞/踩训练；**Heads Up Live** 录音中边说边浮相关旧笔记。
- **主动 Agent（最详尽样本）**：一对一私聊窗口（非通知流）；**晨间简报**（从笔记+日历捞"今天需注意"）；**提醒升级纪律**：挑会议间隙首提→**忙时忍住不打扰**→换角度重试**附带已备好草稿**→完成即停；对话即捕捉（承诺/拍照白板识别to-do/甩链接存+摘要）；关联洞察（承诺与日历并置指出窗口期）。
- **移动手势**：右缘内滑唤 Heads Up；底部箭头开 Chat；Voice Mode 仅录麦克风定位路上 brain dump。

## 3. Capacities —— 对象化+结构化AI（最克制，"建议-批准"模式）
- **捕捉**：**Daily note 即收件箱**（"No pressure to organize. Just capture and link as you go"）；IM 捕捉（WhatsApp/Telegram/Email 入当天 daily note）；命令面板**可粘贴万物**；移动 Quick Action Palette（新建对象/Quick note/拍照/相册/文件/粘贴/AI助手）。
- **组织（建议-批准）**：AI auto-tagging **只从已有标签集挑**、结果可编辑；AI collection selection **只选已有绝不新建**；Contextual suggestions **You approve or ignore**；**AI Property Auto-Fill**（建 Book 自动补作者/出版年/摘要，每属性可写自定义指令）；**Queries 代替手动整理**（存条件成永远鲜活的动态视图，可嵌 dashboard）。
- **详情相关内容**：**Backlinks + Unlinked Mentions 分层**（提到标题但没显式链接的 Mentions 区，高亮→@→升级为 backlink；**官方劝策展而非全链**"linking all dilutes meaningful connections"；纯本地离线不依赖AI）；**Related Content** 扫描"写过但未链接"浮现；**Media analysis** 手动触发析标题/描述/OCR/色板（**只改通用名的图，用户起过的不动**）；**AI Chat** `/`命令 12 个，回答下 Copy/Replace/Append，**聊天记录自动存为对象**可搜可backlink；选中弹浮动 AI Panel。
- **主动 agent**：未获取到 check-in 型；最接近=会前自动聚合"与这些人历史会议+相关项目+未结任务"。
- **移动手势**：底栏（日历点一次回上次日记、点两次回今天）；**任意屏左滑开搜索**；**长按进块选择模式**批量操作；AI 悬浮钮常驻；移动能力明示削减"companion not replacement"。

## 4. Reflect —— 本地优先+AI写作伙伴
- **捕捉**：**行内语音转写**（光标停哪转哪，按两下 Option）；**Audio memos 转进当天 daily note**（iOS 锁屏 widget 一键录音+Action Button）；Chrome/Safari 扩展；Kindle/Readwise 集成。
- **组织**：主轴手动双链+AI 辅助 **"Decorate my writing with backlinks"**（选段落→AI 自动插双链）；**AI link summaries**（存链接自动摘要+喂养语义搜索）；自定义 prompt 模板；任务聚合视图（散落 checkbox 收进统一 task 视图 Current/Overdue）。
- **详情**：**Similar notes**（**客户端本地 embedding** 建语义索引，隐私卖点）；**AI chat with citations** 跨笔记问答引用跳回源；**Chat with search results**（"总结我上周写的"）；语义搜索可 Mac 本地跑。
- **主动 agent**：未获取（纯 on-demand palette/chat）。
- **移动**：搜索栏叠过滤器（Pinned/Tags/Created…）；选中文字→✨→prompt；Daily notes 横滑日历；**"Private"标记笔记永不发给 AI**。

## 5. 跨产品模式提炼（对 AiJi 直接启示）
| 模式 | 代表 | 可借鉴点 |
|---|---|---|
| 保存即走+事后浮层 | mymind share sheet 浮层、Mem clipper 指令框 | 捕捉零跳转；浮层是唯一"轻策展"时机 |
| AI 整理但结构可见可改 | Mem Collections、Capacities approve-or-ignore | AI 提案+用户批准，比全自动更建信任 |
| 搜索即集合 | mymind Smart Spaces、Capacities Queries | **类别"涌现"落地=自动聚类成可保存/命名/改色的动态搜索** |
| 详情页右侧情境栏 | Mem Heads Up（Timeline+Related+Find More） | 相关条目 inline 分两层：时间线+主题包 |
| 录音双阶段确认 | Mem Voice Accept/Refine+原音逐字稿 | STT 结果不当终稿，原文永远可回溯 |
| 主动 check-in | Mem Agent 晨间简报/忙时退避/重试带草稿/闭环自停 | 主动打扰三纪律：挑时机、带增量、完成即停 |
| 本地语义索引 | Reflect similar notes、Capacities unlinked mentions | 相关推荐可无云无 LLM，隐私叙事成立 |
| 纠错出口 | Capacities 可编辑 AI 标签 vs mymind 只给反馈 | 涌现分类要策展，合并/重命名入口必须一等公民 |

**信息缺口**：Capacities/Reflect 均无主动 check-in；Reflect 移动端细节主要来自 changelog/blog。
