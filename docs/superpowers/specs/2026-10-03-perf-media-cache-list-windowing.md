# P-A 性能：媒体 blob 缓存 + 主页列表窗口化（2026-10-03）

> 问题（代码实锤）：
> 1. `TimelineCard.MediaThumb` / `detail/PartView` 的 AudioPlayer、VideoThumb 每次挂载都
>    `di.storage.getMedia(ref)`（IndexedDB 读）+ `URL.createObjectURL(blob)`，无共享缓存。
>    主页滚动回弹、切 tab、进出详情都会全量重读重解码——条目一多就掉帧、内存抖动。
> 2. 主页 `home/index.tsx` 一次性渲染全部条目（无分页/虚拟化），且 `sorted`/`groups`/
>    `catMap`/`aiMap` 每次 render 重算（无 useMemo）。

## 1. 媒体 URL 缓存 `src/app/mediaCache.ts`（新模块）

模块级缓存，`mediaRef → { url, mime, refs, lastUsed }`，引用计数 + LRU：

```ts
acquireMediaUrl(mediaRef: string): Promise<{ url: string; mime: string } | null>
releaseMediaUrl(mediaRef: string): void
```

- **并发去重**：同一 ref 的并发 acquire 共享一个 in-flight Promise（只读一次 IndexedDB）。
- **引用计数**：acquire 成功 refs+1，release refs-1。组件 useEffect cleanup 调 release。
- **LRU 淘汰**：容量 CAP=60。acquire 新条目超容时，按 lastUsed 淘汰 **refs===0** 的最旧条目
  并 `revokeObjectURL`；refs>0 的条目永不淘汰（在屏媒体不会裂图）。全表 refs>0 超容则
  不淘汰（宁可超容不裂图）。
- **null 也缓存**（seed 条目无 blob）：避免每次挂载重复打 IndexedDB。null 条目不占 CAP。
- 返回 `mime`（blob.type）：MediaThumb 靠它判别 video/* vs image/*（现逻辑不变）。

**消费方改造**（行为逐字节不变，仅取数路径换缓存）：
- `home/TimelineCard.tsx` MediaThumb：getMedia→acquire / revoke→release。
- `detail/PartView.tsx` AudioPlayer、VideoThumb：同上。
- 不动：capture 预览（blob 是刚录的本地对象，非存储读）、feedback 压缩预览（同上）、
  syncEngine（后台批量，无 UI 挂载语义）。

## 2. 主页窗口化（哨兵增量渲染，非虚拟列表）

不定高卡片 + 下拉刷新 + AnimatePresence 退场的组合下，真虚拟化（react-window）复杂度高、
退场动画会撕。选**哨兵式增量渲染**（移动端信息流标准做法）：

- `useMemo` 包 sorted / groups / catMap / aiMap（依赖 entries/categories/aiByEntry）。
- `const [limit, setLimit] = useState(PAGE)`，PAGE=30。按组顺序累计渲染，到 limit 截断
  （组内截断允许——该组剩余条目下页再出）。
- 列表底部渲染哨兵 `<div ref>`：IntersectionObserver 进入视口 → `setLimit(l => l + PAGE)`。
- **无 IntersectionObserver 环境**（老 WebView / jsdom）：渲染「加载更多」按钮兜底，
  点击同效。jsdom 测试走按钮路径。
- entries 变化不重置 limit（新条目 prepend，limit 只增不减，已展开的保持展开）。

## 3. 测试（TDD）

- `src/app/__tests__/mediaCache.test.ts`：
  并发 acquire 只读一次存储；release 到 0 才可淘汰；超容淘汰最旧零引用条目并 revoke；
  refs>0 不淘汰；null 结果缓存（二次 acquire 不再读存储）；淘汰后重新 acquire 重新读。
- `src/ui/screens/home/homeWindowing.test.tsx`：
  45 条 → 首渲 30 卡 + 加载更多按钮（jsdom 无 IO）；点按钮 → 45 卡；
  ≤30 条 → 无按钮无哨兵。既有 home 相关测试零改动绿。
- 既有 `mediaThumb.test.tsx` 三用例适配 acquire/release 签名后保持语义。

## 4. 非目标

- 不动 store.entries 全量加载（条目文本体积小，瓶颈在渲染与媒体，不在数据）。
- 不动 detail 页整体结构、capture、chat。
- 不引入 react-window 等依赖。
