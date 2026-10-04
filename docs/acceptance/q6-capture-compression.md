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

（待验收后回填）
