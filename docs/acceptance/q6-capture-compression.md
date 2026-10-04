# Q6 采集压缩包（feat/companion-echo）

> 来源：2026-10-04 五路审计 audit-perf 方案，RSI 第 3 波（W0 → P-F 之后）。
> 前置：P-F 陪伴深化包已收口（5/5 验收，ff0c829 已推）。
> 铁律：子代理只写分配文件、不 commit/push、TDD 先红后绿、`npx tsc -p tsconfig.app.json` + `npx vitest run` 双绿才报完成。

## 范围

### ① 图库/拍照图片压缩（adapter 内归一化，零消费方改动）
现代手机图库照片 3–12MB 原图直存 OPFS（webCapture.ts:328 现状），iOS 配额（A2 风险）与
加载流畅度双杀。统一在采集适配器出口归一化：长边 ≤1024、JPEG 0.8（与 VLM classify
的 compressImage 同参数——AI 看到的与库存的一致）。

- `visionMedia.ts`：抽共享核 `drawCompressed(blob): Promise<HTMLCanvasElement | null>`
  （模块内不导出）——createImageBitmap → 等比缩放 → **白底填充**（修 alpha PNG → JPEG
  透明区变黑的潜伏 bug，compressImage VLM 路径与新路径同修）→ drawImage。
  新导出 `compressImageBlob(blob): Promise<Blob | null>`（canvas.toBlob jpeg/0.8）；
  `compressImage` 签名与语义不变（toDataURL 包装共享核）。
- `webCapture.pickMedia` 图片分支：`compressed = await compressImageBlob(file)`；
  `compressed && compressed.size < file.size` → `{blob: compressed, mime: 'image/jpeg'}`；
  否则原始 file 直通（**压缩永不丢媒体**）。抽可测 seam（导出名 lane 自定，行为表钉死如下）。
- `webCapture.capturePhoto` 同款决策（防部分设备 4K 流原帧数 MB）。
- 决策表（钉死）：压缩成功且更小 → 用压缩+mime 改写 / 压缩成功但不更小 → 原始 / 压缩 null → 原始。

### ② 视频 poster 帧（列表滚动零视频解码）
现状 MediaThumb 视频走 `<video #t=0.1 preload="metadata">`（TimelineCard.tsx:93）——
首页滚动每条视频都起一次解码。采集时一次性抽帧存 OPFS，列表直出 <img>。

- 契约（lead commit 已钉）：
  - `src/domain/mediaRef.ts` `posterRefOf(ref) = `${ref}.poster``（纯函数，三层共用；
    不放 mediaCache——它 import di，adapters 引用会成环）。
  - `ports/index.ts` `pickMedia` / `stopVideo` 返回加 `posterBlob?: Blob`（可选，非破坏）。
- `webCapture`：视频分支（pickMedia）与 stopVideo 各 `extractFrame(blob, 0.1)` 得
  posterBlob（0.1s 与旧 `#t=0.1` 对齐首帧观感）；失败 null → 缺省，消费方回落旧路径。
- 存储（store 路）：capture `addMediaPart(part, blob, posterBlob?)`——posterBlob 且
  part 为真视频（durationSec>0）→ `saveMedia(posterRefOf(ref), posterBlob)` best-effort
  （镜像主 blob 的 fire-and-forget + console.error）。`widgets.tsx onPart` 签名同步扩展，
  摄像 video 路径传 `r.posterBlob`，photo 路径不传。
- 清理（adapters 路）：`dexieStorage.removeMediaForEntry` 同步删 `posterRefOf(p.ref)`
  （防硬删后 poster 孤儿泄漏配额）。
- 非目标（记录防 scope creep）：detail 屏全屏播放不用 poster；导出 zip 只遍历 parts ref
  天然不含 poster；同步引擎不上传 poster（他端回落 #t=0.1，可接受降级）。

### ③ OPFS 配额监控（>80% 横幅预警）
- 新 `src/app/storageQuota.ts` `refreshStorageQuota(): Promise<void>`——
  `navigator.storage?.estimate?.()` 不可用 → store.storageQuota=null；否则写
  `{usage, quota}`。纯编排可测（mock estimate）。
- `store.ts`：`storageQuota: {usage: number; quota: number} | null`（缺省 null）。
  hydrate 不调——由 home mount effect 触发（与 weeklyReview 同 fire-and-forget 模式）。
- home 横幅（UI 路）：`storageQuota && usage/quota >= 0.8 && localStorage['aiji.quota.dismissed'] !== 今日`
  → 警示卡（CompanionCard 下、时间线上，bg-catPending/10，12px）：i18n `home.quota.body`
  （zh「本地存储已用 {pct}%……建议清理回收站」/ en 对称）+ 关闭写 `aiji.quota.dismissed`=本地
  YYYY-MM-DD（当日不再出，次日重出）。

## 任务拆分（契约先行 → 3 路并行）

**Lead 契约 commit**：ports/index.ts（posterBlob）+ domain/mediaRef.ts + 本文件。

| Agent | 独占文件 |
|---|---|
| q6-adapters | src/adapters/visionMedia.ts、src/adapters/webCapture.ts、src/adapters/dexieStorage.ts、src/adapters/__tests__/ |
| q6-store | src/ui/screens/capture/index.tsx、src/ui/screens/capture/widgets.tsx、src/ui/screens/capture/__tests__/（若有）、src/app/store.ts、src/app/storageQuota.ts（新）、src/app/__tests__/ |
| q6-ui | src/ui/screens/home/TimelineCard.tsx、src/ui/screens/home/helpers.ts、src/ui/screens/home/index.tsx、src/ui/screens/home/*.test.tsx、src/app/i18n/** |

防撞：capture/* 只 q6-store；home/* 只 q6-ui；i18n 只 q6-ui；ports/domain 只 lead。
store.ts hydrate 区 q6-store 只加字段（不调 refresh）；home mount effect 由 q6-ui 调
`refreshStorageQuota`（q6-store 导出，接口先按本契约写，编译期对齐）。

## 测试要点（TDD）

- adapters：pickFrameTimes 全表（既有）；compressImage/compressImageBlob 失败路径
  （mock createImageBitmap reject → null）；白底填充存在性（mock ctx 断言 fillRect 调用）；
  pickMedia 图片决策表三分支（mock visionMedia + DOM input）；capturePhoto 决策表；
  视频分支/stopVideo posterBlob 存在与失败缺省（mock extractFrame）；
  removeMediaForEntry poster 删除断言（mock navigator.storage.getDirectory）。
- store：storageQuota estimate 三态（有/无/异常）；addMediaPart poster 保存
  （mock di.storage.saveMedia 断言 posterRefOf 键 + 照片 part 不存 poster）；
  widgets onPart 三参透传。
- ui：firstThumb 判定表（mediaType='video' / mime video/* / durationSec>0 / 照片 false /
  seed 老数据无 mime 靠 durationSec）；MediaThumb poster 命中走 <img>、miss 回落 <video>
  （mock mediaCache，守 settled/release 协议——poster acquire 两次则 cleanup release 两次）；
  配额横幅 显示/关闭持久/次日重出/低于阈值不出。
- 既有 624 测试防回归。

## 验收（acceptance agent，静态 review + 浏览器 390×844）

1. 三路报齐 → lead 集成：tsc + vitest 全绿 + diff 逐行过。
2. 用例：
   ① 图库选图（in-page canvas 造 2000×1200 PNG File → setInputFiles）→ OPFS blob
     体积 < 原图且 mime=image/jpeg，part 落库正常。
   ② 图库选视频（in-page MediaRecorder vp9 造 ~2s webm → File）→ OPFS 有
     `${ref}.poster` + 首页该条目 thumb 渲染 <img>（非 <video>）。
   ③ 配额横幅：addInitScript stub `navigator.storage.estimate` 返 85% → 首页横幅出现 →
     关闭 → reload 当日不再出；改 50% → 无横幅。
   ④ 回归：seed 视频条目（e5.webm 无 poster）→ thumb 走 <video> 回落不裂图；
     detail 屏视频区正常。
   ⑤ 硬删带 poster 条目（trash → 永久删除）→ OPFS 主 blob 与 poster 同步清除。
3. 全绿 → lead commit（契约+三路，4 个语义 commit）→ 关单。

---

## 验收记录

验收人：accept agent（独立验收，非实现者）· 日期：2026-10-05 · 分支：feat/companion-echo
范围：`git diff 1c6cfd2` + 未跟踪 src/**（剔除 dbv9.test.ts）静态复核 + 浏览器联合测试。

### 执行方式

- 静态门禁：`npx tsc -p tsconfig.app.json` exit 0（验收方独立复跑）；vitest 676/676（lead 集成阶段报告，验收方未复跑以省预算）；7 项契约不变量逐行人工核对。
- 浏览器：prod build `npm run preview -- --port 4173` + Playwright MCP，视口 390×844。媒体经原生 file chooser 真实上传（浏览器内 canvas/MediaRecorder 生成 → base64 导出落盘 → file_upload）；OPFS/IDB 状态经 `navigator.storage.getDirectory()` / Dexie evaluate 直读；配额用 `navigator.storage.estimate` stub + SPA 导航（nav 链接点击，非 goto）触发 Home remount。

### 静态复核（7 项不变量，全部合规）

1. **normalizeImageBlob 决策表** — `webCapture.ts:72-76`：`compressed && compressed.size < raw.size` 才替换并改写 `image/jpeg`；压缩失败（null）或不更小 → 原始直通。压缩永不丢媒体。✓
2. **extractFrame 失败不抛** — `visionMedia.ts` extractFrame catch-all → null；`webCapture.ts:286`（stopVideo）、`:346`（pickMedia video）`(await extractFrame(...)) ?? undefined`；capturePhoto（`:234-253`）无 poster 路径。✓
3. **addMediaPart poster 守卫** — `capture/index.tsx:240-249`：`posterBlob && part.type==='video' && part.durationSec>0` 三条件齐备才落 `${ref}.poster`；`void ...saveMedia(...).catch()` fire-and-forget。✓
4. **MediaThumb 双 acquire 释放配对** — `TimelineCard.tsx` held 数组 + cancelled 自释放 + cleanup 全量释放，每 ref 恰 acquire/release 各一（mediaThumbPoster.test.tsx 有序列断言）。✓
5. **removeMediaForEntry 同步删 poster** — `dexieStorage.ts:82-85`：主 ref + `posterRefOf(p.ref)` 双删，best-effort 吞错。✓
6. **配额横幅条件** — `home/index.tsx:145-146`：`quota>0` 守卫 + `ratio≥0.8` + 当日 dismiss key（`:132-144`，localStorage `aiji.quota.dismissed`=本地 YYYY-MM-DD）；`storageQuota.ts` 三态（estimate 不可用/抛错 → null 静默降级；成功 → `usage/quota ?? 0`）。✓
7. **i18n 对齐** — zh/en 双有 `home.quota.body`（{pct} 插值）+ `home.quota.dismiss`。✓

### 用例证据表

| # | 用例 | 结果 | 关键证据 |
|---|------|------|---------|
| ① | 相册图片压缩 | **PASS** | 3,291,056B 噪声 PNG 上传 → OPFS blob 235,505B，magic `ff d8 ff e0`（JPEG SOI+JFIF），mime 改写 image/jpeg；photo 无 poster 兄弟文件 |
| ② | 视频 poster | **PASS** | OPFS 同时存在主 ref（EBML magic `1a45dfa3`）与 `${ref}.poster`（1,314B JPEG）；首页卡 `<img>` 无 `<video>`（entryId `6b1c2f64-…`，ref `video-6883963e-…`） |
| ③ | 配额横幅 | **PASS** | stub 85% → `role="alert"` 含「85%」；dismiss 点击 300ms 后消失；SPA remount 保持隐藏（当日 key）；stub 50% → 无横幅 |
| ④ | 无 poster 回落 | **FAIL** | 见 MAJOR-1。双轨：seed e5（无 blob）→ 灰 placeholder 不裂图（契约字面过）；有 blob 无 poster → 首页 `<img>` naturalWidth=0 裂图（brief 用例失败）。detail 屏 video readyState=4、controls、duration≈24.3 正常 |
| ⑤ | 硬删清媒体 | **PASS** | 永久删除后 OPFS 主 ref 与 poster 均 NotFoundError；IDB entries.get → undefined；回收站空 |

### Findings

- **MAJOR-1** `src/ui/screens/home/TimelineCard.tsx:101` — MediaThumb 无 poster 回落分支 `setMedia({ url: r.url, isVideo: r.mime.startsWith('video/') })` 以 OPFS blob MIME 判视频。Chromium OPFS `getFile()` 不持久化 MIME（`type:""`）→ `isVideo=false` → 渲 `<img src={webm blobURL}>`，naturalWidth=0 裂图。触发链：任意「有主 blob、无 poster」的视频条目（Q6 前存量 / extractFrame 失败）首页全部裂图。同函数 71 行已持有 `thumb.isVideo` prop（part 元数据链，helpers.ts firstThumb：mediaType→mime→durationSec），回落应直接用之；58-60 行注释声明的设计意图本就是「回落主 ref 的 `<video #t=0.1>`」。detail 屏不受影响（走 part 元数据）。修复方向：`:101` 改用 `isVideo` prop（一行）。
- **OBS-1** `dexieStorage.ts:85` — audio part 也尝试 `removeEntry(posterRefOf)`：无害（best-effort 吞错），仅多一次空 OPFS 调用。
- **OBS-2** `webCapture.ts:286` — stopVideo 串行 await extractFrame（最坏 3s seek 超时）：设计内取舍，失败静默不阻塞出片。
- **OBS-3** `webCapture.ts:334` — pickMedia 图片分支省略 posterBlob 键（vs video 分支显式 undefined）：两形态均满足类型，消费方 `if (posterBlob && ...)` 无差异。

### 结论（首轮）

**NOT-LGTM**。契约「全绿 → lead commit」不满足：用例 ④ 首页无 poster 回落裂图（MAJOR-1）。①②③⑤ 全过，静态 7 项不变量全合规。修 MAJOR-1 后回归只需重跑用例 ④（有 blob 无 poster 条目首页应渲 `<video #t=0.1>`，seed e5 应保持 placeholder）。

---

### 复验轮（2026-10-05，MAJOR-1 修复后）

修复：`TimelineCard.tsx:101` 回落分支改 `setMedia({ url: r.url, isVideo })`（part 元数据链驱动，不再读 OPFS blob MIME），注释同步改写。q6-ui 红→绿：新增「poster miss + blob MIME 空串 → 断言 `<video>`」回归用例；vitest 677/677、tsc 0（lead 核验）。验收方复跑：`VITE_AIJI_BACKEND=mock npm run build` 重出 prod 包后浏览器复验（旧 SW/caches 已清，确认 bundle hash 换新）。

| 项 | 结果 | 关键证据 |
|----|------|---------|
| ④ 有 blob 无 poster → 首页 `<video #t=0.1>` | **PASS** | legacy 卡（ref `video-q6legacy`，mime video/webm、mediaType video、durationSec 5，OPFS 无 poster）：`<video src="blob:…#t=0.1" preload="metadata">`，readyState=4，无 `<img>` 无 placeholder。修复前同 fixture 为 `<img>` naturalWidth=0 裂图 |
| ④ seed e5（无 blob）保持 placeholder | **PASS** | e5 卡 `hasImg:false, hasVideo:false, hasPlaceholder:true`（字面契约「不裂图」成立） |
| ④ detail 屏复点 | **PASS** | `/detail/q6-legacy-e1`：`<video controls>` readyState=4，duration≈24.3（fixture MediaRecorder duration 漂移，与首轮一致，非应用问题） |
| ② poster 命中快速回归 | **PASS** | 相册上传 45,149B webm（有限 duration 1.97）→ OPFS `video-44d71dfc-…`（45,149B，magic `1a 45 df a3`）+ `….poster`（2,059B，magic `ff d8 ff e0`）双文件；保存后首页新卡 `<img>` naturalWidth=320（poster JPEG 真解码），无 `<video>` |

三卡同屏矩阵（一次 evaluate 同取）：poster 命中卡=`<img>`、无 poster 卡=`<video #t=0.1>`、无 blob 卡=placeholder —— 三分支全部正确分流。

新增观察项：
- **OBS-4** `webCapture.ts:342`（既有代码，非 Q6 引入）— pickMedia duration 探测对无 duration 头的 webm（如部分录屏/合成 webm）探得 `Infinity`，part chip 显示「Infinity:NaN」；此形态下 extractFrame 若为 null 则 poster 缺席但主 blob 仍落库（本轮测试中途实测：Infinity fixture 主 blob 落 OPFS、poster 缺、chip 破文案——fixture 已清，孤儿 blob 已删）。真实手机相册视频带 duration 元数据，触发面窄；建议探测钳制 `Number.isFinite(v.duration) ? v.duration : 0`（顺带让 poster 守卫对坏文件确定性跳过）。

### 结论（复验轮）

**LGTM**。MAJOR-1 修复核验通过：用例 ④ 全量 + 用例 ② 快速回归全绿，首轮 ①③⑤ 结论不受该一行改动影响（改动局限于 TimelineCard MediaThumb 回落分支）。5/5 用例通过、静态 7 项不变量合规、findings 余 4 条 OBS（均不阻塞）。可 commit。
