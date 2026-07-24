// en/home.ts — keys must match zh/home.ts exactly (Record<I18nKey,string> enforced in en/index.ts).
export const home = {
  // home H1 brand title (distinct from nav.home "Timeline")
  'home.title': 'Journal',

  // home empty state
  'home.empty.title': 'Nothing here yet',
  'home.empty.subtitle': 'Tap the mic below to jot something',
  'home.empty.action': 'Jot',

  // home header (the count stays in its own styled span)
  'home.header.unit': 'items',

  // timeline card
  'home.card.untitled': 'Untitled',
  'home.card.status.failed.left': 'Transcribed · classify failed',
  'home.card.status.failed.right': 'Failed',
  'home.card.status.offline.left': 'Saved · retry when online',
  'home.card.status.offline.right': 'Offline · pending',
  'home.card.status.processing.left': 'AI classifying · transcribed',
  'home.card.status.processing.right': 'Processing',

  // home top banners
  'home.banner.saved': 'Saved · AI classifying…',
  'home.banner.fail.title': 'AI processing failed',
  'home.banner.fail.subtitle': 'Network or model error. Entry saved.',
  'home.banner.offline': 'Offline · retry when online',
  'home.banner.refresh': 'AI done · refreshing',

  // 下拉刷新指示器（Batch 8 进度环文案）
  'home.ptr.pull': 'Pull to refresh',
  'home.ptr.release': 'Release to refresh',

  // 5th nav tab (common has no nav.reminders)
  'nav.reminders': 'Reminders',

  // shared · relative day words (common only has today/yesterday)
  'comp.rel.tomorrow': 'Tomorrow',
  'comp.rel.dayAfter': 'Day after',
  'comp.rel.saturday': 'Saturday',

  // shared · entry modality labels
  'comp.modality.multi': 'Mixed',
  'comp.modality.text': 'Text',
  'comp.modality.audio': 'Audio',
  'comp.modality.image': 'Photo',
  'comp.modality.video': 'Video',

  // shared · avatar placeholder
  'comp.avatar.me': 'Me',

  // shared · FAB
  'comp.fab.startCapture': 'Start capture',

  // shared · top bar (AppShell)
  'comp.topbar.askAi': 'Ask AI',

  // shared · reminder creator / popup / firing popup
  'comp.reminder.header.create': 'AI detected · to-do',
  'comp.reminder.header.edit': 'Edit reminder',
  'comp.reminder.submit.create': 'Create to-do',
  'comp.reminder.submit.edit': 'Save changes',
  'comp.reminder.contentLabel': 'Reminder',
  'comp.reminder.timeLabel': 'Time',
  'comp.reminder.custom': 'Custom',
  'comp.reminder.ignore': 'Ignore',
  'comp.reminder.popup.aria': 'Confirm reminder',
  'comp.reminder.firing.aria': 'Reminder firing',
  'comp.reminder.firing.title': 'Reminder',
  'comp.reminder.firing.snooze': 'Snooze 10 min',
}
