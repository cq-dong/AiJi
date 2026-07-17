import type { Aggregate, Category, Entry, EntryAi, Reminder, Tag } from '@/domain/types'

// Prototype sample data — heterogeneous entries (life fragments / stray ideas /
// project progress), per AiJi identity ("记", not diary). "Today" = 2026-07-15.

const t = (iso: string) => iso

export const seedCategories: Category[] = [
  { slug: 'idea', label: '想法', aliases: [], usageCount: 18, accent: 'catIdea', createdAt: '2026-07-01' },
  { slug: 'project', label: '项目进展', aliases: [], usageCount: 12, accent: 'catProject', createdAt: '2026-07-02' },
  { slug: 'life', label: '生活片段', aliases: [], usageCount: 9, accent: 'catPending', createdAt: '2026-07-03' },
  { slug: 'reading', label: '阅读笔记', aliases: [], usageCount: 5, accent: 'catIdea', createdAt: '2026-07-05' },
  { slug: 'errand', label: '待办', aliases: [], usageCount: 7, accent: 'catFail', createdAt: '2026-07-06' },
]

export const seedTags: Tag[] = [
  { slug: 'aiji', label: 'AiJi', usageCount: 8, createdAt: '2026-07-04' },
  { slug: 'stt', label: 'STT', usageCount: 3, createdAt: '2026-07-04' },
  { slug: 'design', label: '设计', usageCount: 6, createdAt: '2026-07-05' },
  { slug: 'reflection', label: '反思', usageCount: 4, createdAt: '2026-07-06' },
  { slug: 'subway', label: '地铁', usageCount: 2, createdAt: '2026-07-08' },
  { slug: 'whisper', label: 'Whisper', usageCount: 2, createdAt: '2026-07-09' },
]

export const seedEntries: Entry[] = [
  {
    id: 'e1', createdAt: t('2026-07-15T08:12:00+08:00'), updatedAt: t('2026-07-15T08:14:00+08:00'),
    status: 'ready', aiId: 'ai1',
    parts: [{ type: 'audio', ref: 'e1.opus', durationSec: 32, transcript: '地铁里想到如果记一条东西能顺便变成提醒就好了' }],
  },
  {
    id: 'e2', createdAt: t('2026-07-15T07:40:00+08:00'), updatedAt: t('2026-07-15T07:42:00+08:00'),
    status: 'ready', aiId: 'ai2', moodSelf: '专注',
    parts: [{ type: 'text', content: '把 CapturePort 抽成接口，PWA 和 Capacitor 各实现一个，UI 层不动。' }],
  },
  {
    id: 'e3', createdAt: t('2026-07-14T22:30:00+08:00'), updatedAt: t('2026-07-14T22:31:00+08:00'),
    status: 'ready', aiId: 'ai3',
    parts: [{ type: 'text', content: '今天跑步的时候在想：人记不住所有事是因为没把记忆外包，工具应该替你记。' }],
  },
  {
    id: 'e4', createdAt: t('2026-07-14T19:05:00+08:00'), updatedAt: t('2026-07-14T19:07:00+08:00'),
    status: 'ready', aiId: 'ai4',
    parts: [{ type: 'audio', ref: 'e4.opus', durationSec: 48, transcript: '读到一篇讲 second brain 的文章，核心是不要整理只要捕获，整理交给后端。' }],
  },
  {
    id: 'e5', createdAt: t('2026-07-14T14:20:00+08:00'), updatedAt: t('2026-07-14T14:21:00+08:00'),
    status: 'ready', aiId: 'ai5', moodSelf: '开心',
    parts: [{ type: 'video', ref: 'e5.webm', durationSec: 22, transcript: '楼下咖啡店新出的桂花拿铁，拍了一段。' }],
  },
  {
    id: 'e6', createdAt: t('2026-07-14T10:00:00+08:00'), updatedAt: t('2026-07-14T10:02:00+08:00'),
    status: 'processing',
    parts: [{ type: 'text', content: 'AiJi 的分类要涌现，不预定大类——让 LLM 看内容自己发现类别，用户再策展。' }],
  },
  {
    id: 'e7', createdAt: t('2026-07-13T21:15:00+08:00'), updatedAt: t('2026-07-13T21:16:00+08:00'),
    status: 'failed',
    parts: [{ type: 'audio', ref: 'e7.opus', durationSec: 60, transcript: ' Whisper 把这段转坏了，重试一下。' }],
  },
  {
    id: 'e8', createdAt: t('2026-07-13T16:30:00+08:00'), updatedAt: t('2026-07-13T16:31:00+08:00'),
    status: 'ready', aiId: 'ai8',
    parts: [{ type: 'text', content: '要记得周三给设计稿反馈，别拖到周末。' }],
  },
  {
    id: 'e9', createdAt: t('2026-07-13T09:45:00+08:00'), updatedAt: t('2026-07-13T09:46:00+08:00'),
    status: 'offline-pending',
    parts: [{ type: 'text', content: '地铁里没信号记的，回家联网补跑分类。' }],
  },
  {
    id: 'e10', createdAt: t('2026-07-12T20:10:00+08:00'), updatedAt: t('2026-07-12T20:11:00+08:00'),
    status: 'ready', aiId: 'ai10',
    parts: [
      { type: 'text', content: '多模态一条：先打字又补了语音。' },
      { type: 'audio', ref: 'e10.opus', durationSec: 18, transcript: '就是想试试混合模态记一条。' },
    ],
  },
  {
    id: 'e11', createdAt: t('2026-07-12T13:00:00+08:00'), updatedAt: t('2026-07-12T13:01:00+08:00'),
    status: 'ready', aiId: 'ai11',
    parts: [{ type: 'text', content: '《卡片笔记写作法》重点：原子化、链接、不分类。和 AiJi 的涌现思路一致。' }],
  },
  {
    id: 'e12', createdAt: t('2026-07-11T18:22:00+08:00'), updatedAt: t('2026-07-11T18:23:00+08:00'),
    status: 'ready', aiId: 'ai12', moodSelf: '疲惫',
    parts: [{ type: 'text', content: '连续改了三天 bug，今天该早睡。明天再啃 STT 那块。' }],
  },
]

export const seedEntryAi: EntryAi[] = [
  { id: 'ai1', entryId: 'e1', version: 1, category: 'idea', tags: ['aiji', 'subway'], facets: { place: '地铁' }, titleSuggestion: '记一条顺便变提醒', summary: '希望记录时能顺带生成提醒', modelUsed: 'deepseek-chat', createdAt: '2026-07-15T08:14:00+08:00' },
  { id: 'ai2', entryId: 'e2', version: 1, category: 'project', tags: ['aiji', 'design'], facets: { project: 'AiJi' }, titleSuggestion: 'CapturePort 接口化', summary: '抽 CapturePort 为接口，PWA/Capacitor 各实现', modelUsed: 'deepseek-chat', createdAt: '2026-07-15T07:42:00+08:00' },
  { id: 'ai3', entryId: 'e3', version: 1, category: 'idea', tags: ['reflection'], facets: { mood: '平静' }, titleSuggestion: '记忆外包', summary: '记不住是因为没把记忆外包给工具', modelUsed: 'deepseek-chat', createdAt: '2026-07-14T22:31:00+08:00' },
  { id: 'ai4', entryId: 'e4', version: 1, category: 'reading', tags: ['reflection'], facets: {}, titleSuggestion: 'Second brain', summary: '只捕获不整理，整理交给后端', modelUsed: 'deepseek-chat', createdAt: '2026-07-14T19:07:00+08:00' },
  { id: 'ai5', entryId: 'e5', version: 1, category: 'life', tags: [], facets: { mood: '开心', place: '咖啡店' }, titleSuggestion: '桂花拿铁', summary: '楼下咖啡店新品桂花拿铁', modelUsed: 'deepseek-chat', createdAt: '2026-07-14T19:08:00+08:00' },
  { id: 'ai8', entryId: 'e8', version: 1, category: 'errand', tags: [], facets: { event: '给设计稿反馈' }, titleSuggestion: '周三反馈设计稿', summary: '周三给设计稿反馈，别拖', modelUsed: 'deepseek-chat', createdAt: '2026-07-13T21:16:00+08:00' },
  { id: 'ai10', entryId: 'e10', version: 1, category: 'idea', tags: ['aiji'], facets: {}, titleSuggestion: '混合模态测试', summary: '文本+语音混合记一条', modelUsed: 'deepseek-chat', createdAt: '2026-07-12T20:11:00+08:00' },
  { id: 'ai11', entryId: 'e11', version: 1, category: 'reading', tags: ['reflection'], facets: {}, titleSuggestion: '卡片笔记写作法', summary: '原子化+链接+不分类，与涌现一致', modelUsed: 'deepseek-chat', createdAt: '2026-07-12T13:01:00+08:00' },
  { id: 'ai12', entryId: 'e12', version: 1, category: 'life', tags: ['reflection'], facets: { mood: '疲惫', project: 'AiJi' }, titleSuggestion: '该早睡了', summary: '连续改 bug 三天，今天早睡', modelUsed: 'deepseek-chat', createdAt: '2026-07-11T18:23:00+08:00' },
]

export const seedReminders: Reminder[] = [
  // e8: "要记得周三给设计稿反馈，别拖到周末。" — pending reminder for tomorrow morning.
  {
    id: 'rm1', entryId: 'e8', dueAt: '2026-07-16T10:00:00+08:00',
    label: '给设计稿反馈', status: 'pending', createdAt: '2026-07-13T21:16:00+08:00',
  },
  // e12: "明天再啃 STT 那块。" — overdue, marked missed (Q3: >1h overdue → missed).
  {
    id: 'rm2', entryId: 'e12', dueAt: '2026-07-12T09:00:00+08:00',
    label: '啃 STT 那块', status: 'missed', createdAt: '2026-07-11T18:23:00+08:00',
  },
]

export const seedAggregates: Aggregate[] = [
  {
    id: 'ag-w28', scope: { type: 'week', range: '2026-W28' }, summary: '本周以 AiJi 项目推进为主轴：抽象端口、涌现分类、STT 方案逐步成形；穿插两次生活片段（跑步、咖啡）与一篇阅读笔记（second brain / 卡片笔记）。情绪整体偏专注，周末略疲惫。',
    entryIds: ['e2', 'e3', 'e4', 'e6', 'e10', 'e11', 'e12'], modelUsed: 'deepseek-chat', createdAt: '2026-07-15T09:00:00+08:00', stale: false, detailLevel: 3,
  },
  {
    id: 'ag-d715', scope: { type: 'day', range: '2026-07-15' }, summary: '今天记了两条：地铁里的想法（记一条顺便变提醒）和 CapturePort 接口化的项目进展。情绪专注。',
    entryIds: ['e1', 'e2'], modelUsed: 'deepseek-chat', createdAt: '2026-07-15T09:01:00+08:00', stale: false, detailLevel: 3,
  },
  {
    id: 'ag-w27', scope: { type: 'week', range: '2026-W27' }, summary: '上周主要在打磨 Figma 原型，把采集流的三模态选择器和边缘态补齐。',
    entryIds: [], modelUsed: 'deepseek-chat', createdAt: '2026-07-08T09:00:00+08:00', stale: true, detailLevel: 3,
  },
]

export const seedSettings = {
  llmProvider: 'DeepSeek · BYOK',
  apiKeyRef: undefined,
  llmUrl: 'https://api.deepseek.com/v1/chat/completions',
  llmModel: 'deepseek-v4-flash',
  sttProvider: 'Paraformer · BYOK',
  sttModel: 'paraformer-realtime-v2',
  sttKeyRef: undefined,
  recordLocation: false,
  dailyReminder: false,
  theme: 'light' as const,
  aggregateDetailLevel: 3 as const,
  onboarded: false,
  sttMode: 'stream' as const,
  sttUrl: undefined,
  videoVisionEnabled: true,
  videoFrameIntervalSec: 10,
}
