// onboarding 屏文案 + reminders + feedback（三屏 key 同放本文件）。
// key 前缀 onboarding. / reminders. / feedback.（zh/reminders.ts、zh/feedback.ts 保持空壳）。
export const onboarding = {
  // 首启语言选择控件（各选项以其本语显示，故 zh/en 两值相同）
  'onboarding.lang.zh': '中文',
  'onboarding.lang.en': 'English',

  // 欢迎区
  'onboarding.brandMark': '记',
  'onboarding.subtitle': '随手记，AI 帮你整理，数据留在本地',
  'onboarding.feature.multimodal': '多模态随手记',
  'onboarding.feature.autocategorize': 'AI 自动涌现分类',
  'onboarding.feature.localfirst': '本地优先 + BYOK',

  // 免责声明（首屏可见）
  'onboarding.disclaimer':
    'AiJi · AI 记 — 开源址 github.com/cq-dong/AiJi · 仅供学习交流 · AI 生成内容（分类/摘要/问答）可能不准确，重要决策请自行核实 · 使用本应用视为接受此声明',

  // BYOK
  'onboarding.byok.label': 'API Key',
  'onboarding.byok.placeholder': '粘贴你的 DeepSeek / OpenAI API Key',
  'onboarding.byok.hint': '没有 key 也能记，AI 功能会降级；采集和存储照常可用。',

  // 权限卡
  'onboarding.permission.title': '允许麦克风与摄像头',
  'onboarding.permission.desc': '采集语音/视频需要授权',
  'onboarding.permission.denied': '未授权，采集功能将受限。可在浏览器设置中重新授权。',
  'onboarding.permission.granted': '已授权',
  'onboarding.permission.request': '请求权限',

  // 示例数据卡
  'onboarding.sample.title': '导入示例数据',
  'onboarding.sample.desc': '12 条原型记录帮你快速了解 App',
  'onboarding.sample.importing': '导入中…',
  'onboarding.sample.imported': '已导入',
  'onboarding.sample.import': '导入',

  // CTA
  'onboarding.start': '开始记',

  // 多步向导（Batch 7：单页堆叠改分步轮播）
  'onboarding.step.next': '下一步',
  'onboarding.step.back': '上一步',
  'onboarding.step.skip': '跳过',
  'onboarding.aria.stepDot': '第 {n} 步',

  // reminders 屏
  'reminders.title': '提醒与待办',
  'reminders.subtitle': '查看与管理提醒事项 · 共 {count} 条',
  'reminders.section.pending': '待提醒',
  'reminders.section.fired': '已提醒',
  'reminders.section.missed': '已错过',
  'reminders.empty.pending': '暂无待提醒事项',
  'reminders.empty.fired': '暂无已提醒记录',
  'reminders.empty.missed': '暂无错过记录',
  'reminders.status.pending': '待提醒',
  'reminders.status.fired': '已提醒',
  'reminders.status.snoozed': '已稍后',
  'reminders.status.missed': '已错过',
  'reminders.action.snooze': '稍后提醒',
  'reminders.action.clear': '清除',

  // feedback 屏
  'feedback.title': '使用反馈',
  'feedback.success.title': '反馈已提交，谢谢！',
  'feedback.success.desc': '建议已发到 GitHub Issue，会尽快处理。',
  'feedback.success.viewIssue': '查看 Issue',
  'feedback.item.label': '建议 {n}',
  'feedback.item.deleteAria': '删除该建议',
  'feedback.item.placeholder': '说说你的建议、遇到的问题或想法…',
  'feedback.image.alt': '反馈图片',
  'feedback.image.removeAria': '移除图片',
  'feedback.image.add': '添加图片',
  'feedback.image.processing': '处理中…',
  'feedback.addSuggestion': '添加建议',
  'feedback.submit.action': '提交',
  'feedback.submit.submitting': '提交中…',
  'feedback.error.imageFailed': '图片处理失败：{err}',
  'feedback.error.parseFailed': '图片解析失败',
  'feedback.error.compressFailed': '压缩失败',
} as const
