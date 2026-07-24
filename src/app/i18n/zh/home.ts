// home 屏文案。key 前缀 home.（屏内）；comp.（共享原语）；nav.reminders（common 缺，补在此）。
export const home = {
  // 首页 H1 大标题（品牌字，与 nav.home「时间线」不同键）
  'home.title': '记',

  // 首页空态
  'home.empty.title': '还没有记下任何东西',
  'home.empty.subtitle': '点下方的麦克风，记一笔',
  'home.empty.action': '记一笔',

  // 首页头部（「今天 X 条」的量词，数字单独 span 加粗）
  'home.header.unit': '条',

  // 时间线卡片
  'home.card.untitled': '未命名',
  'home.card.status.failed.left': '已转写 · 分类失败',
  'home.card.status.failed.right': '处理失败',
  'home.card.status.offline.left': '已保存 · 待联网补跑',
  'home.card.status.offline.right': '离线·待补跑',
  'home.card.status.processing.left': 'AI 正在分类 · 已转写',
  'home.card.status.processing.right': '处理中',

  // 首页顶部瞬态横幅
  'home.banner.saved': '已保存 · AI 正在分类…',
  'home.banner.fail.title': 'AI 处理失败',
  'home.banner.fail.subtitle': '网络或模型异常，原始条目已保存',
  'home.banner.offline': '离线 · 待联网补跑',
  'home.banner.refresh': 'AI 已分类 · 正在刷新',

  // 下拉刷新指示器（Batch 8 进度环文案）
  'home.ptr.pull': '下拉刷新',
  'home.ptr.release': '松开刷新',

  // 底部导航第 5 tab（common 未收 nav.reminders，补在此屏片段）
  'nav.reminders': '提醒',

  // 共享原语 · 相对日期词（common 只有 today/yesterday）
  'comp.rel.tomorrow': '明天',
  'comp.rel.dayAfter': '后天',
  'comp.rel.saturday': '周六',

  // 共享原语 · 条目模态标签（TimelineCard + helpers 复用）
  'comp.modality.multi': '多模态',
  'comp.modality.text': '文本',
  'comp.modality.audio': '语音',
  'comp.modality.image': '图片',
  'comp.modality.video': '视频',

  // 共享原语 · 头像占位
  'comp.avatar.me': '我',

  // 共享原语 · FAB
  'comp.fab.startCapture': '开始采集',

  // 共享原语 · 顶栏（AppShell）
  'comp.topbar.askAi': '问 AI',

  // 共享原语 · 提醒创建器/弹窗/触发弹窗
  'comp.reminder.header.create': 'AI 检测到 · 待办',
  'comp.reminder.header.edit': '编辑提醒',
  'comp.reminder.submit.create': '创建待办',
  'comp.reminder.submit.edit': '保存修改',
  'comp.reminder.contentLabel': '提醒内容',
  'comp.reminder.timeLabel': '提醒时间',
  'comp.reminder.custom': '自定义',
  'comp.reminder.ignore': '忽略',
  'comp.reminder.popup.aria': '提醒确认',
  'comp.reminder.firing.aria': '提醒触发',
  'comp.reminder.firing.title': '提醒',
  'comp.reminder.firing.snooze': '稍后 10 分钟',
} as const
