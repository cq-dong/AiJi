// categories 屏文案。key 前缀 categories.
// 类别名/标签名是用户数据（Dexie 涌现）→ 不入字典，照常渲染。
// 这里只放 UI chrome：视图切换、lens 标签、编辑 sheet、导出 sheet、空态、计数后缀、日期/模态兜底。
export const categories = {
  // 6 个 lens 标签（ViewSwitcher / CategoryDetail 分组 / FacetLens 共用）
  'categories.lens.category': '类别',
  'categories.lens.time': '时间',
  'categories.lens.mood': '心情',
  'categories.lens.project': '项目',
  'categories.lens.person': '人物',
  'categories.lens.place': '地点',

  // 主屏 index.tsx
  'categories.empty.title': '类别会随你记的内容自动涌现',
  'categories.empty.subtitle': '先记几条，AI 会帮你归类',
  'categories.empty.action': '记一笔',
  'categories.title': '类别地图',
  // 带样式数字 span 的后缀（数字单独 styled span，故只用后缀词）
  'categories.counts.emergedSuffix': '个涌现类别',
  'categories.counts.itemsSuffix': '条',
  'categories.counts.llmHint': 'LLM 自动发现',

  // PinnedCards
  'categories.pinned.drafts': '草稿',
  'categories.pinned.draftsHint': '{count} 条未完成',
  'categories.pinned.trash': '回收站',
  'categories.pinned.trashHint': '{count} 条已删',

  // CategoryDetail
  'categories.detail.empty.title': '该类别下还没有条目',
  'categories.detail.empty.subtitle': '记几条相关内容，AI 会自动归到这个类别',
  'categories.detail.grouped.empty.title': '暂无{facet}侧面',
  'categories.detail.grouped.empty.subtitle': '该类别下的条目尚未识别该侧面',

  // 导出确认 sheet（CategoryDetail / CategoryEditSheet 共用）
  'categories.export.sheet.title': '导出确认',
  'categories.export.sheet.scopeLabel': '导出范围',
  'categories.export.sheet.scopeValue': '类别「{label}」',
  'categories.export.sheet.entryCount': '条目数',
  'categories.export.sheet.mediaCount': '媒体数',
  'categories.export.sheet.mediaUnit': '{count} 个',
  'categories.export.sheet.filename': '文件名',
  'categories.export.sheet.locationLabel': '保存位置',
  'categories.export.sheet.location.share': '系统分享面板（可选保存到任意位置）',
  'categories.export.sheet.location.native': '文档/AiJi/（文件管理器可见）',
  'categories.export.sheet.location.browser': '浏览器下载目录',
  'categories.export.sheet.location.shareShort': '系统分享面板',
  'categories.export.sheet.location.nativeShort': '文档/AiJi/',
  'categories.export.sheet.location.browserShort': '浏览器下载',
  'categories.export.sheet.confirm': '确认导出',

  // 导出反馈 toast（CategoryDetail / CategoryEditSheet 的 formatSaveFeedback 共用）
  'categories.export.failWith': '导出失败：{error}',
  'categories.export.fail': '导出失败',
  'categories.export.shared': '已分享',
  'categories.export.savedTo': '已保存到 {path}',
  'categories.export.savedDefault': '已保存到 文档/AiJi/',
  'categories.export.downloaded': '已下载到浏览器下载目录',
  'categories.export.done': '已导出',

  // CategoryEditSheet
  'categories.edit.title': '编辑类别',
  'categories.edit.name': '名称',
  'categories.edit.namePlaceholder': '类别名称',
  'categories.edit.color': '颜色',
  'categories.edit.exporting': '导出中…',
  'categories.edit.export': '导出该类别',
  'categories.edit.delete': '删除类别',
  'categories.edit.deleteConfirm.title': '确定删除「{label}」？',
  'categories.edit.deleteConfirm.hint': '该类别下的 {count} 条将移至「未分类」。',
  'categories.edit.deleteConfirm.confirm': '确认删除',

  // FacetLens
  'categories.facet.empty.title': '暂无{facet}相关条目',
  'categories.facet.empty.subtitle': '记几条带该侧面的内容，AI 会自动聚合',

  // TimeLens
  'categories.time.empty.title': '还没有记下任何东西',
  'categories.time.empty.subtitle': '记几条，这里会按时间排列',

  // EntryRow
  'categories.entry.untitled': '未命名',

  // helpers.ts 日期 / 模态兜底（今天/昨天复用 common 片段的 date.today/yesterday，明天在此）
  'categories.date.tomorrow': '明天',
  'categories.date.monthDay': '{m}月{d}日',
  'categories.date.weekday.sun': '周日',
  'categories.date.weekday.mon': '周一',
  'categories.date.weekday.tue': '周二',
  'categories.date.weekday.wed': '周三',
  'categories.date.weekday.thu': '周四',
  'categories.date.weekday.fri': '周五',
  'categories.date.weekday.sat': '周六',
  'categories.date.weekday.unknown': '周?',
  'categories.modality.multi': '多模态',
  'categories.modality.text': '文本',
  'categories.modality.audio': '语音',
  'categories.modality.video': '视频',
} as const
