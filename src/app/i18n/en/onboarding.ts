// en 片段不带 as const（en/index.ts 的 Record<I18nKey, string> 强制 key 与 zh 齐全）。
// 三屏 key（onboarding./reminders./feedback.）同放本文件。
export const onboarding = {
  // 首启语言选择控件（各选项以其本语显示，故 zh/en 两值相同）
  'onboarding.lang.zh': '中文',
  'onboarding.lang.en': 'English',

  // 欢迎区
  'onboarding.brandMark': '记',
  'onboarding.tagline': 'An AI notebook for everything',
  'onboarding.welcomeSub': 'Life moments, stray ideas, project progress — jot it down, AI tidies up',
  'onboarding.feature.multimodal': 'Multimodal quick capture',
  'onboarding.feature.autocategorize': 'AI auto-emerges categories',
  'onboarding.feature.localfirst': 'Local-first + BYOK',

  // 功能宣传页（营销轮播：捕捉 / 整理 / 找回）
  'onboarding.slide.capture.title': 'Capture in seconds',
  'onboarding.slide.capture.desc':
    'Hold the mic and talk — speech becomes text. Photos, images, or plain typing work too. Ideas don’t wait; capture is effortless.',
  'onboarding.slide.organize.title': 'No filing — AI organizes',
  'onboarding.slide.organize.desc':
    'Categories emerge from what you write, with an AI summary and tags on every entry. You just capture; AI does the rest.',
  'onboarding.slide.recall.title': 'Find it. Get reminded.',
  'onboarding.slide.recall.desc':
    'Search by meaning, not just keywords. AI spots to-dos in your notes and reminds you. Periodic summaries help you look back.',

  // 宣传页插画 mock 文案
  'onboarding.mock.transcribing': 'Voice → text',
  'onboarding.mock.catIdea': 'Ideas',
  'onboarding.mock.catProject': 'Project',
  'onboarding.mock.tags': '#ideas #work',
  'onboarding.mock.summary': 'AI summary',
  'onboarding.mock.searchPh': 'Search by meaning…',
  'onboarding.mock.todo': 'Send the proposal by Fri',
  'onboarding.mock.reminderSet': 'Reminder set',

  // 免责声明（首屏可见）
  'onboarding.disclaimer':
    'AiJi · AI Journal — Open source at github.com/cq-dong/AiJi · For learning and exchange only · AI-generated content (categories/summaries/answers) may be inaccurate — verify important decisions yourself · Using this app means accepting this disclaimer',

  // BYOK
  'onboarding.byok.label': 'API Key',
  'onboarding.byok.placeholder': 'Paste your DeepSeek / OpenAI API Key',
  'onboarding.byok.hint':
    'You can take notes without a key; AI features will degrade. Capture and storage still work.',

  // 权限卡
  'onboarding.permission.title': 'Allow microphone and camera',
  'onboarding.permission.desc': 'Capturing audio/video needs permission',
  'onboarding.permission.denied':
    'Permission denied. Capture will be limited. Re-grant it in browser settings.',
  'onboarding.permission.granted': 'Granted',
  'onboarding.permission.request': 'Request permission',

  // 示例数据卡
  'onboarding.sample.title': 'Import sample data',
  'onboarding.sample.desc': '12 sample entries to help you explore the app',
  'onboarding.sample.importing': 'Importing…',
  'onboarding.sample.imported': 'Imported',
  'onboarding.sample.import': 'Import',

  // CTA
  'onboarding.start': 'Start',

  // 多步向导（Batch 7：单页堆叠改分步轮播）
  'onboarding.step.next': 'Next',
  'onboarding.step.back': 'Back',
  'onboarding.step.skip': 'Skip',
  'onboarding.aria.stepDot': 'Step {n}',

  // reminders 屏
  'reminders.title': 'Reminders & tasks',
  'reminders.subtitle': 'View and manage reminders · {count} items',
  'reminders.section.pending': 'Upcoming',
  'reminders.section.fired': 'Triggered',
  'reminders.section.missed': 'Missed',
  'reminders.empty.pending': 'No upcoming reminders',
  'reminders.empty.fired': 'No triggered reminders',
  'reminders.empty.missed': 'No missed reminders',
  'reminders.status.pending': 'Upcoming',
  'reminders.status.fired': 'Triggered',
  'reminders.status.snoozed': 'Snoozed',
  'reminders.status.missed': 'Missed',
  'reminders.action.snooze': 'Snooze',
  'reminders.action.clear': 'Clear',

  // feedback 屏
  'feedback.title': 'Feedback',
  'feedback.success.title': 'Feedback submitted, thank you!',
  'feedback.success.desc':
    'Your suggestions are posted to a GitHub Issue and will be handled soon.',
  'feedback.success.viewIssue': 'View Issue',
  'feedback.item.label': 'Suggestion {n}',
  'feedback.item.deleteAria': 'Delete this suggestion',
  'feedback.item.placeholder': 'Share your suggestions, problems, or ideas…',
  'feedback.image.alt': 'Feedback image',
  'feedback.image.removeAria': 'Remove image',
  'feedback.image.add': 'Add image',
  'feedback.image.processing': 'Processing…',
  'feedback.addSuggestion': 'Add suggestion',
  'feedback.submit.action': 'Submit',
  'feedback.submit.submitting': 'Submitting…',
  'feedback.error.imageFailed': 'Image processing failed: {err}',
  'feedback.error.parseFailed': 'Image parse failed',
  'feedback.error.compressFailed': 'Compression failed',
}
