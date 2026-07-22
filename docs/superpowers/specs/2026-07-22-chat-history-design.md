# AI 对话历史（多会话）设计

> 日期：2026-07-22 · 状态：用户提需「AI对话增加历史对话记录，不然每次清空历史都没了」，授权 lead 自主推进
> 现状痛点：MVP 单会话 id=1，「清空」直接抹掉全部消息，历史不可找回。

## 1. 目标与非目标

**目标**
- 多会话：可「新会话」，旧会话自动保留（落库即存档，无需显式保存）。
- 历史列表：chat 屏顶栏历史入口 → HistorySheet，按 updatedAt 倒序列出全部会话（首条用户消息摘录作标题 + 相对时间 + 消息数）。
- 点历史会话 → 载入为当前会话，**可继续聊**（不是只读）。
- 可删除单个历史会话（带确认）；删除当前会话 → 回到空新会话。
- 「清空会话」eraser 按钮废除（它的语义就是丢历史）→ 顶栏改为：‹ 返回 · 问 AI · 🕐历史 · ＋新会话。

**非目标（YAGNI）**
- 会话重命名（自动标题=首条用户消息前 24 字，空则「新会话/New chat」）。
- 置顶/搜索/导出会话。
- 跨设备同步（本地 Dexie，账号分区沿用 ownerId）。

## 2. 数据与状态

- `Conversation { id, ownerId?, messages, updatedAt }` 不变；Dexie `conversations` 表已支持多行 + ownerId 分区 + listConversations 倒序（已实装，零 schema 变更）。
- 新会话 id = `crypto.randomUUID()`；旧 id='1' 会话自然成为历史列表一行（无迁移）。
- store 状态：`conversation: Conversation | null`（当前）+ `chatList: Conversation[]`（历史列表缓存，hydrate 载入）。
- **空会话不落库**（messages=[] 的会话不进历史列表）：sendMessage 首条消息 append 后才 saveConversation；loadChatList 过滤空行。

## 3. store 动作（src/app/store.ts）

- `newConversation()`：当前会话有消息则已存档（每次 append 都 save），置 `conversation=null`（lazy-create 语义沿用）→ 下条 sendMessage 建新 uuid 行。chatList 不动（新会话有消息后再刷新）。
- `loadConversation(id)`：`di.storage.getConversation(id)` → set conversation；失败（已删/跨账号）静默 noop。
- `deleteChatConversation(id)`：storage.deleteConversation；若 id==当前会话 → conversation=null；chatList 剔除。
- `refreshChatList()`：`listConversations()` → 过滤 messages.length>0 → set chatList。hydrate / sendMessage 成功后 / delete 后调用。
- `clearConversation` 删除（UI 不再调用；action 一并移除，测试改测新动作）。
- sendMessage 变化：`ensureConversation` 新建时 id=uuid（不再固定 '1'）；append 后照旧 save + refreshChatList（节流：仅当该会话首次入库时刷新列表即可，简单起见每次都刷——列表读一张表，代价可忽略）。
- hydrate：载 chatList（过滤空行），conversation = chatList[0] ?? null（最近会话续聊，替代原 id=1 直读）。
- 「已记住」自动记忆确认消息：沿用当前会话 append（不变）。

## 4. UI（src/ui/screens/chat/）

- 顶栏：`‹` · `问 AI` · 右侧两个图标按钮：History（History 图标）开 HistorySheet；SquarePen/MessageCirclePlus 图标新会话（当前会话为空时禁用或直接 noop）。
- `HistorySheet.tsx`（新组件，仿 settings 的 Sheet 模式）：
  - 列表项：标题（首条 user 消息前 24 字 / 无则「新会话」）· 副行（相对时间「3 小时前」+ 「N 条消息」）· 删除按钮（Trash2，confirm 后删）。
  - 空态：「还没有历史对话」。
  - 点击项 → loadConversation(id) + 关 sheet。
- 相对时间复用 drafts 的插值 pattern（justNow/ago.minutes/hours/days）。
- i18n：新增 key 入 `src/app/i18n/{zh,en}/chat.ts`（chat.history / chat.newChat / chat.historyEmpty / chat.deleteConfirm / chat.msgCount / chat.untitled + ago.*）。

## 5. 测试

- store 单测（新 `storeChatHistory.test.ts`）：newConversation 建 uuid 行且旧会话存档；loadConversation 切换；delete 当前→null；delete 历史→列表剔除；空会话不入列表；hydrate 载最近会话为当前。
- 既有 storeChatMemory.test.ts 适配（clearConversation 移除、CHAT_CONVERSATION_ID 不再固定——mock 断言对齐）。
- reviewer e2e（390×844 双语）：聊两句 → 新会话 → 历史出现第一条 → 点回旧会话消息还在且可继续 → 删除 → 列表消失 → en 态文案英文。

## 6. 风险

| 风险 | 对策 |
|---|---|
| answerChat 的 chatHistory 窗口读当前会话——切会话后上下文自然跟随 | 无需改，窗口逻辑不变 |
| 旧 id=1 会话与新 uuid 并存 | 无迁移，id 只是主键 |
| 历史列表大（几百会话） | MVP 全量渲染；>100 再虚拟化（YAGNI） |
