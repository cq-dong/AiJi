// P-F ② 周回顾（2026-10-05，spec: docs/acceptance/pf-companion-pack.md §②）。
// home mount 惰性触发：每周最多重算一次上周 aggregate（localStorage rate key），
// 开关关 / 上周范围内无条目 → skip 不烧 quota；失败不写 key（下次 home mount 重试）。
// 纯编排模块（镜像 src/app/proactive.ts 风格），零 React——entries/settings/
// recomputeAggregate 全读 useUiStore live state；localStorage 可注入（测试/非 web）。

import { scopeRange, shiftRef } from '@/domain/dateRange'
import { useUiStore } from './store'

// rate key：'aiji.wr.{range}'（如 aiji.wr.2026-W40）——存在 = 本周已跑过（每周最多一次）。
export const WR_RATE_PREFIX = 'aiji.wr.'
// seen key：'aiji.wr.seen.{range}'——home 周回顾卡「已读」标记（home/index.tsx 写/读）。
export const WR_SEEN_PREFIX = 'aiji.wr.seen.'

// 上周 ISO 周 range key（dateRange.ts 现成助手：shiftRef 退一周 → scopeRange 取周 key）。
export function lastWeekRange(now: Date = new Date()): string {
  return scopeRange('week', shiftRef('week', now, -1))
}

export interface WeeklyReviewDeps {
  // 可注入存储（测试 / 非 web 环境）；缺省 window.localStorage。
  store?: Pick<Storage, 'getItem' | 'setItem'>
  warn?: (msg: string, err: unknown) => void
}

// 周回顾编排。任一 skip 路径都不烧 quota（不调 recomputeAggregate）：
// rate key 在 → 本周已跑；开关关 → 用户停用；上周零条目 → 无料可摘要。
// recomputeAggregate 自带 skip-when-fresh 守卫（aggregate fresh 时秒回不打 LLM）
// 与 in-flight 去重，此处只管「每周最多触发一次」的频控与成败记账。
export async function maybeRunWeeklyReview(now: Date = new Date(), deps: WeeklyReviewDeps = {}): Promise<void> {
  const store = deps.store ?? window.localStorage
  const warn = deps.warn ?? ((msg: string, err: unknown) => console.warn(msg, err))
  const range = lastWeekRange(now)

  // 频控：本周已跑 → skip。
  try {
    if (store.getItem(WR_RATE_PREFIX + range) !== null) return
  } catch {
    // private mode / 配额异常 —— 当作未跑过（写不进也只是失去频控）
  }

  const { settings, entries, recomputeAggregate } = useUiStore.getState()
  // 开关关（缺省 true，仅显式 false 停用）→ skip。
  if (settings.weeklyReviewEnabled === false) return
  // 上周范围内无条目 → skip（无料不烧 quota）。
  const hasEntry = entries.some((e) => scopeRange('week', new Date(e.createdAt)) === range)
  if (!hasEntry) return

  try {
    await recomputeAggregate('week', range)
  } catch (err) {
    // 失败不写 rate key —— 下次 home mount 重试。
    warn('[weeklyReview] 上周回顾生成失败，下次进首页重试', err)
    return
  }
  // 成功才写 rate key。
  try {
    store.setItem(WR_RATE_PREFIX + range, now.toISOString())
  } catch {
    // 写不进只失去频控，不影响本次结果
  }
}
