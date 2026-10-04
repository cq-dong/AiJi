// Q6 采集压缩包（2026-10-05）：poster 帧的 OPFS 引用约定。视频 part 的缩略 poster
// 存为 `${ref}.poster`（JPEG blob）——列表 MediaThumb 优先取它，免每次滚动解码视频；
// 老条目无 poster → 消费方回落 <video #t=0.1>。纯函数零 I/O，adapters/app/ui 三层共用
//（不放 mediaCache：它 import di，adapters 引用会成环）。
export const posterRefOf = (ref: string): string => `${ref}.poster`
