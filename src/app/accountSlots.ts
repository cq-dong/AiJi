// 账号切换回调槽（破环专用）——独立成**零依赖**模块。
//
// 背景：accountStore 不能静态 import store/quotaStore（成环 accountStore→store→di→
// builtinLlm→accountStore），故用「槽注册」：store/quotaStore 模块加载时把 rehydrate/reset
// 注册进来，accountStore 账号切换时调槽。
//
// 为什么槽不能放 accountStore.ts：dev 原生 ESM 严格按求值序——若 accountStore 先开始求值，
// 停在 `import { di }` 行等 di 链求值，链上 quotaStore 顶层调 registerQuotaReset → 访问
// accountStore 里尚未执行到的 `let quotaResetFn` → TDZ「Cannot access before initialization」
//（prod Rollup 打包提升遮掩了它，dev 必现白屏）。槽放进零依赖模块后，任何消费者 import 它时
// 它必然已完整求值，与环无关、与求值序无关。
export const accountSlots = {
  storeRehydrate: null as null | (() => Promise<void>),
  quotaReset: null as null | (() => Promise<void>),
}
