// detail 屏文案。key 前缀 detail.
// helpers.ts 的格式化函数（formatTitle/relativeTime/partTypeLabel）也读本片段——
// 它们是非组件，用 t()（@/app/i18n）而非 useT()；组件渲染时调用它们会随 useT 重渲刷新。
export const detail = {
  // helpers.formatTitle：月日 时:分（数值经插值传入）。
  'detail.titleFormat': '{m}月{d}日 {hh}:{mm}',
  // helpers.relativeTime
  'detail.justNow': '刚刚',
  'detail.minutesAgo': '{min}分钟前',
  'detail.hoursAgo': '{hr}小时前',
  'detail.daysAgo': '{day}天前',
  // helpers.partTypeLabel / PartView.mediaTypeLabel 共用
  'detail.partType.text': '文本',
  'detail.partType.audio': '语音',
  'detail.partType.image': '图片',
  'detail.partType.video': '视频',

  // AiPanel：FacetChips
  'detail.facets': '侧面',
  'detail.facet.mood': '情绪·{value}',
  'detail.facet.place': '地点·{value}',
  'detail.facet.project': '项目·{value}',
  'detail.facet.event': '事件·{value}',
  'detail.facet.person': '人物·{value}',
  // AiPanel：ReadyBody 标签
  'detail.category': '类别',
  'detail.tags': '标签',
  'detail.title': '标题',
  'detail.summary': '摘要',
  'detail.reprocess': '重处理',
  'detail.imageContent': '图片内容：',
  'detail.videoContent': '视频内容：',
  // AiPanel：ProcessingBody
  'detail.aiProcessing': 'AI 处理中…',
  'detail.processingHint': '正在分类 · 已转写',
  'detail.processingHint2': '类别 / 标签 / 侧面 由 AI 自动涌现',
  // AiPanel：FailedBody（.includes 检查的是原始 error 文本，不本地化；仅输出文案本地化）
  'detail.fail.noKey': 'AI 模型未配置 Key，去「设置 → AI 模型」填写后重试',
  'detail.fail.emptyText': '条目无可用文本，点「手动编辑」补转写文本后重试',
  'detail.fail.reason': '原因：{error}',
  'detail.fail.network': '网络或模型异常，原始条目已保存',
  'detail.failed': '处理失败',
  'detail.manualEdit': '手动编辑',
  'detail.aiPanelTitle': 'AI 处理',
  'detail.noAiResult': '暂无 AI 处理结果',

  // PartView：媒体不可用（样例）态 + aria
  'detail.aria.zoomImage': '缩放图片',
  'detail.audioUnavailable': '音频不可用（样例）',
  'detail.aria.pause': '暂停',
  'detail.aria.play': '播放',
  'detail.imageUnavailable': '图片不可用（样例）',
  'detail.videoUnavailable': '视频不可用（样例）',
  'detail.locationNone': '地点：未记录（设置中可开启）',

  // index.tsx
  'detail.aria.more': '更多',
  'detail.aria.deletePart': '删除片段',
  'detail.aria.editText': '编辑文本',
  'detail.aria.editReminder': '编辑提醒',
  // AiEditSheet
  'detail.editAiTitle': '编辑 AI 处理',
  'detail.noTitle': '无标题',
  'detail.noSummary': '无摘要',
  'detail.uncategorized': '未分类',
  'detail.tagsPlaceholder': '用逗号分隔',
  // PartsEditSheet
  'detail.transcript': '转写文本',
  'detail.noTranscript': '无转写',
  'detail.rawMediaNotEditable': '原始媒体不可编辑',
  // ConfirmDeleteDialog
  'detail.moveToTrash': '移到回收站',
  'detail.trashConfirmDesc': '移到回收站？30 天内可在回收站恢复。',
  // formatSaveFeedback（非组件函数，用 t()）
  'detail.exportFailReason': '导出失败：{error}',
  'detail.exportFail': '导出失败',
  'detail.shared': '已分享',
  'detail.savedTo': '已保存到 {path}',
  'detail.savedToDefault': '已保存到 文档/AiJi/',
  'detail.downloadedToBrowser': '已下载到浏览器下载目录',
  'detail.exported': '已导出',
  // ExportConfirmSheet
  'detail.exportConfirm': '导出确认',
  'detail.aria.exportConfirm': '导出确认',
  'detail.exportScope': '导出范围',
  'detail.thisEntry': '本条目',
  'detail.mediaCount': '媒体数',
  'detail.mediaCountValue': '{count} 个',
  'detail.fileName': '文件名',
  'detail.saveLocation': '保存位置',
  'detail.locShare': '系统分享面板（可选保存到任意位置）',
  'detail.locDocs': '文档/AiJi/（文件管理器可见）',
  'detail.locBrowser': '浏览器下载目录',
  'detail.confirmExport': '确认导出',
  // MoreSheet
  'detail.copiedToClipboard': '已复制到剪贴板',
  'detail.shareFail': '分享失败',
  'detail.shareWith': '分享…',
  'detail.moreActions': '更多操作',
  'detail.export': '导出',
  'detail.exporting': '导出中…',
  // Detail 主屏
  'detail.entryDetail': '条目详情',
  'detail.notFoundTitle': '条目不存在',
  'detail.notFoundSubtitle': '该条目可能已被删除',
  'detail.backToHome': '返回首页',
  'detail.viewRecord': '记录',
  'detail.viewSource': '原态',
  'detail.reminderSet': '已设提醒',
} as const
