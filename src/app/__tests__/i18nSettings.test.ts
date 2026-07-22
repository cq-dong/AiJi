import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock di.storage：hydrate 的全套读取 + getSettings/saveSettings 可控。
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      purgeExpired: async () => 0,
      listEntries: async () => [],
      getSettings: () => mocks.getSettings(),
      saveSettings: (s: unknown) => mocks.saveSettings(s),
      listCategories: async () => [],
      listTags: async () => [],
      listAggregates: async () => [],
      listReminders: async () => [],
      listDrafts: async () => [],
      listTrashed: async () => [],
      listMemories: async () => [],
      getEntryAi: async () => undefined,
      getConversation: async () => undefined,
    },
  },
}))

import { useUiStore } from '@/app/store'
import { getCurrentLang, setCurrentLang } from '@/app/currentLang'
import { seedSettings } from '@/data/seed'

beforeEach(() => {
  vi.clearAllMocks()
  setCurrentLang('zh')
  mocks.saveSettings.mockResolvedValue(undefined)
  useUiStore.setState({ settings: { ...seedSettings }, hydrated: false })
})

describe('Settings.language ↔ currentLang', () => {
  it('setSettings({language:"en"}) → currentLang 同步 en', () => {
    useUiStore.getState().setSettings({ language: 'en' })
    expect(getCurrentLang()).toBe('en')
  })

  it('hydrate：settings.language 已固化 en → currentLang 用 en，不再写回', async () => {
    mocks.getSettings.mockResolvedValue({ ...seedSettings, language: 'en' })
    await useUiStore.getState().hydrate()
    expect(getCurrentLang()).toBe('en')
    expect(useUiStore.getState().settings.language).toBe('en')
  })

  it('hydrate：language 未固化 → detect 并写回 settings', async () => {
    mocks.getSettings.mockResolvedValue({ ...seedSettings, language: undefined })
    await useUiStore.getState().hydrate()
    // jsdom navigator.language = en-US → detect = en
    expect(getCurrentLang()).toBe('en')
    expect(useUiStore.getState().settings.language).toBe(getCurrentLang())
    expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: getCurrentLang() }))
  })
})
