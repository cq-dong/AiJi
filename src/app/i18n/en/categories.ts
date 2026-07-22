// en 片段不带 as const（值类型放宽为 string），en/index.ts 的 Record<I18nKey, string> 强制 key 齐全。
export const categories = {
  // 6 lens labels (shared by ViewSwitcher / CategoryDetail groups / FacetLens)
  'categories.lens.category': 'Category',
  'categories.lens.time': 'Time',
  'categories.lens.mood': 'Mood',
  'categories.lens.project': 'Project',
  'categories.lens.person': 'People',
  'categories.lens.place': 'Place',

  // Main screen (index.tsx)
  'categories.empty.title': 'Categories will emerge as you write',
  'categories.empty.subtitle': 'Write a few entries and AI will sort them for you',
  'categories.empty.action': 'Write an entry',
  'categories.title': 'Category Map',
  'categories.counts.emergedSuffix': 'emerged categories',
  'categories.counts.itemsSuffix': 'items',
  'categories.counts.llmHint': 'Auto-discovered by LLM',

  // PinnedCards
  'categories.pinned.drafts': 'Drafts',
  'categories.pinned.draftsHint': '{count} unfinished',
  'categories.pinned.trash': 'Trash',
  'categories.pinned.trashHint': '{count} deleted',

  // CategoryDetail
  'categories.detail.empty.title': 'No entries in this category yet',
  'categories.detail.empty.subtitle': 'Write a few related entries and AI will sort them here',
  'categories.detail.grouped.empty.title': 'No {facet} facet yet',
  'categories.detail.grouped.empty.subtitle': 'No entries in this category have that facet',

  // Export confirm sheet (shared by CategoryDetail / CategoryEditSheet)
  'categories.export.sheet.title': 'Export',
  'categories.export.sheet.scopeLabel': 'Scope',
  'categories.export.sheet.scopeValue': 'Category "{label}"',
  'categories.export.sheet.entryCount': 'Entries',
  'categories.export.sheet.mediaCount': 'Media',
  'categories.export.sheet.mediaUnit': '{count} media',
  'categories.export.sheet.filename': 'Filename',
  'categories.export.sheet.locationLabel': 'Save to',
  'categories.export.sheet.location.share': 'System share sheet (save anywhere)',
  'categories.export.sheet.location.native': 'Documents/AiJi/ (visible in file manager)',
  'categories.export.sheet.location.browser': 'Browser downloads',
  'categories.export.sheet.location.shareShort': 'System share sheet',
  'categories.export.sheet.location.nativeShort': 'Documents/AiJi/',
  'categories.export.sheet.location.browserShort': 'Browser downloads',
  'categories.export.sheet.confirm': 'Export',

  // Export feedback toast (shared by formatSaveFeedback in detail + edit)
  'categories.export.failWith': 'Export failed: {error}',
  'categories.export.fail': 'Export failed',
  'categories.export.shared': 'Shared',
  'categories.export.savedTo': 'Saved to {path}',
  'categories.export.savedDefault': 'Saved to Documents/AiJi/',
  'categories.export.downloaded': 'Downloaded to browser downloads',
  'categories.export.done': 'Exported',

  // CategoryEditSheet
  'categories.edit.title': 'Edit category',
  'categories.edit.name': 'Name',
  'categories.edit.namePlaceholder': 'Category name',
  'categories.edit.color': 'Color',
  'categories.edit.exporting': 'Exporting…',
  'categories.edit.export': 'Export category',
  'categories.edit.delete': 'Delete category',
  'categories.edit.deleteConfirm.title': 'Delete "{label}"?',
  'categories.edit.deleteConfirm.hint': '{count} entries in this category will move to "Uncategorized".',
  'categories.edit.deleteConfirm.confirm': 'Delete',

  // FacetLens
  'categories.facet.empty.title': 'No entries with {facet} yet',
  'categories.facet.empty.subtitle': 'Write a few entries with this facet and AI will cluster them',

  // TimeLens
  'categories.time.empty.title': 'Nothing written yet',
  'categories.time.empty.subtitle': 'Write a few entries and they will line up by time',

  // EntryRow
  'categories.entry.untitled': 'Untitled',

  // helpers.ts date / modality (today/yesterday reuse common.date.*, tomorrow here)
  'categories.date.tomorrow': 'Tomorrow',
  'categories.date.monthDay': '{m}/{d}',
  'categories.date.weekday.sun': 'Sun',
  'categories.date.weekday.mon': 'Mon',
  'categories.date.weekday.tue': 'Tue',
  'categories.date.weekday.wed': 'Wed',
  'categories.date.weekday.thu': 'Thu',
  'categories.date.weekday.fri': 'Fri',
  'categories.date.weekday.sat': 'Sat',
  'categories.date.weekday.unknown': '?',
  'categories.modality.multi': 'Mixed',
  'categories.modality.text': 'Text',
  'categories.modality.audio': 'Voice',
  'categories.modality.video': 'Video',
}
