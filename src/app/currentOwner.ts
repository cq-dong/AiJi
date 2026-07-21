// 当前数据 owner（账号分区键）。local-first：条目按 ownerId 分区存储在 IndexedDB。
// 未登录 → 'local'；登录网络账号 → account.id。accountStore 在 hydrate/login/logout 时切换。
// dexieStorage 的 list/get/save/adopt 全部读它做分区过滤/盖章。
//
// 零依赖（防循环 import）：dexieStorage ↔ accountStore 都依赖它，它不依赖任何业务模块，
// 故不会把 currentOwner 拉进既有的循环引用链。模块级 let 是有意为之的进程内单例——
// 同一 JS realm 内 owner 全局唯一（单用户手机语义，多用户共用设备不在本期）。
let current: string = 'local'

export function getCurrentOwner(): string {
  return current
}

export function setCurrentOwner(id: string): void {
  current = id
}
