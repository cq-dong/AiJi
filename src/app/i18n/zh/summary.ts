// summary 屏文案。key 前缀 summary.
// 摘要正文是 LLM 生成的用户数据，不翻译；此处只翻译屏标题、时间范围切换、
// 详细度档位、生成/重新生成按钮、空态、加载态、aggregate.ts 期间导航标签。
// 期间导航的今日/昨日/本周/上周/本月/上月用屏级 key（保留「今日」书面语），
// 不复用 date.today（「今天」口语）——与「本周/上周」书面语一致。
// 月份范围「2026年7月」由 aggregate.ts 用 Intl.DateTimeFormat 格式化，不在此列。
export const summary = {
  // 屏标题 / 区段
  'summary.title': '时间摘要',
  'summary.detailLevel': '详细度',
  // 详细度档位 1~5
  'summary.detailLevel.1': '极简',
  'summary.detailLevel.2': '简洁',
  'summary.detailLevel.3': '标准',
  'summary.detailLevel.4': '详细',
  'summary.detailLevel.5': '详尽',
  // scope 分段：日/周/月
  'summary.scope.day': '日',
  'summary.scope.week': '周',
  'summary.scope.month': '月',
  // 期间导航短标签
  'summary.period.today': '今日',
  'summary.period.yesterday': '昨日',
  'summary.period.thisWeek': '本周',
  'summary.period.lastWeek': '上周',
  'summary.period.thisMonth': '本月',
  'summary.period.lastMonth': '上月',
  // DigestCard 状态文案
  'summary.empty': '暂无内容',
  'summary.recalculating': '正在重新生成{label}摘要…',
  'summary.noSummary': '暂无摘要内容。',
  'summary.collapse': '收起',
  'summary.expand': '展开',
  'summary.entryCount': '{count} 条 · 挂链',
  'summary.stale': '已过期',
  'summary.generatedAt': '生成于 {time} · {model}',
  'summary.regenerate': '重新生成',
} as const
