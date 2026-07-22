// en 片段不带 as const（值类型放宽为 string），en/index.ts 的 Record<I18nKey, string> 强制 key 齐全。
export const detail = {
  // helpers.formatTitle
  'detail.titleFormat': '{m}/{d} {hh}:{mm}',
  // helpers.relativeTime
  'detail.justNow': 'Just now',
  'detail.minutesAgo': '{min} min ago',
  'detail.hoursAgo': '{hr} hr ago',
  'detail.daysAgo': '{day} d ago',
  // helpers.partTypeLabel / PartView.mediaTypeLabel
  'detail.partType.text': 'Text',
  'detail.partType.audio': 'Audio',
  'detail.partType.image': 'Image',
  'detail.partType.video': 'Video',

  // AiPanel: FacetChips
  'detail.facets': 'Facets',
  'detail.facet.mood': 'Mood · {value}',
  'detail.facet.place': 'Place · {value}',
  'detail.facet.project': 'Project · {value}',
  'detail.facet.event': 'Event · {value}',
  'detail.facet.person': 'Person · {value}',
  // AiPanel: ReadyBody labels
  'detail.category': 'Category',
  'detail.tags': 'Tags',
  'detail.title': 'Title',
  'detail.summary': 'Summary',
  'detail.reprocess': 'Reprocess',
  'detail.imageContent': 'Image content: ',
  'detail.videoContent': 'Video content: ',
  // AiPanel: ProcessingBody
  'detail.aiProcessing': 'AI processing…',
  'detail.processingHint': 'Categorizing · transcribed',
  'detail.processingHint2': 'Category / tags / facets emerge via AI',
  // AiPanel: FailedBody
  'detail.fail.noKey': 'AI model key not configured. Set it under Settings → AI model and retry',
  'detail.fail.emptyText': 'No usable text in entry. Tap Manual edit to add transcript, then retry',
  'detail.fail.reason': 'Reason: {error}',
  'detail.fail.network': 'Network or model error. Original entry saved.',
  'detail.failed': 'Processing failed',
  'detail.manualEdit': 'Manual edit',
  'detail.aiPanelTitle': 'AI processing',
  'detail.noAiResult': 'No AI result yet',

  // PartView: media unavailable (sample) + aria
  'detail.aria.zoomImage': 'Zoom image',
  'detail.audioUnavailable': 'Audio unavailable (sample)',
  'detail.aria.pause': 'Pause',
  'detail.aria.play': 'Play',
  'detail.imageUnavailable': 'Image unavailable (sample)',
  'detail.videoUnavailable': 'Video unavailable (sample)',
  'detail.locationNone': 'Location: not recorded (enable in settings)',

  // index.tsx
  'detail.aria.more': 'More',
  'detail.aria.deletePart': 'Delete part',
  'detail.aria.editText': 'Edit text',
  'detail.aria.editReminder': 'Edit reminder',
  // AiEditSheet
  'detail.editAiTitle': 'Edit AI processing',
  'detail.noTitle': 'No title',
  'detail.noSummary': 'No summary',
  'detail.uncategorized': 'Uncategorized',
  'detail.tagsPlaceholder': 'Separate with commas',
  // PartsEditSheet
  'detail.transcript': 'Transcript',
  'detail.noTranscript': 'No transcript',
  'detail.rawMediaNotEditable': 'Original media is not editable',
  // ConfirmDeleteDialog
  'detail.moveToTrash': 'Move to trash',
  'detail.trashConfirmDesc': 'Move to trash? Restorable within 30 days in trash.',
  // formatSaveFeedback
  'detail.exportFailReason': 'Export failed: {error}',
  'detail.exportFail': 'Export failed',
  'detail.shared': 'Shared',
  'detail.savedTo': 'Saved to {path}',
  'detail.savedToDefault': 'Saved to Documents/AiJi/',
  'detail.downloadedToBrowser': 'Downloaded to browser downloads',
  'detail.exported': 'Exported',
  // ExportConfirmSheet
  'detail.exportConfirm': 'Export confirm',
  'detail.aria.exportConfirm': 'Export confirm',
  'detail.exportScope': 'Scope',
  'detail.thisEntry': 'This entry',
  'detail.mediaCount': 'Media',
  'detail.mediaCountValue': '{count}',
  'detail.fileName': 'Filename',
  'detail.saveLocation': 'Save to',
  'detail.locShare': 'System share sheet (save anywhere)',
  'detail.locDocs': 'Documents/AiJi/ (visible in file manager)',
  'detail.locBrowser': 'Browser downloads',
  'detail.confirmExport': 'Confirm export',
  // MoreSheet
  'detail.copiedToClipboard': 'Copied to clipboard',
  'detail.shareFail': 'Share failed',
  'detail.shareWith': 'Share…',
  'detail.moreActions': 'More',
  'detail.export': 'Export',
  'detail.exporting': 'Exporting…',
  // Detail main
  'detail.entryDetail': 'Entry detail',
  'detail.notFoundTitle': 'Entry not found',
  'detail.notFoundSubtitle': 'This entry may have been deleted',
  'detail.backToHome': 'Back to home',
  'detail.viewRecord': 'Record',
  'detail.viewSource': 'Source',
  'detail.reminderSet': 'Reminder set',
}
