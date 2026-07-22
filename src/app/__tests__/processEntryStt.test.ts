import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Entry, EntryAi, Settings } from '@/domain/types'
import type { Account, AuthSession } from '@/domain/account'

// ── Mocks ───────────────────────────────────────────────────────────────────
// di: controllable per-test via `mocks.*`.
// accountStore: controllable via `accountMocks.account` / `.session`.

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getEntry: vi.fn(),
  saveEntry: vi.fn(),
  saveEntryAi: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  getAggregate: vi.fn(),
  saveAggregate: vi.fn(),
  secretsGet: vi.fn(),
  transcribe: vi.fn(),
  classify: vi.fn(),
  saveSettings: vi.fn(),
}))

const accountMocks = vi.hoisted(() => ({
  account: null as Account | null,
  session: null as AuthSession | null,
}))

vi.mock('@/app/di', () => ({
  di: {
    storage: {
      getSettings: () => mocks.getSettings(),
      saveSettings: (s: Settings) => mocks.saveSettings(s),
      getEntry: (id: string) => mocks.getEntry(id),
      saveEntry: (e: Entry) => mocks.saveEntry(e),
      saveEntryAi: (ai: EntryAi) => mocks.saveEntryAi(ai),
      listCategories: () => mocks.listCategories(),
      listTags: () => mocks.listTags(),
      getAggregate: (...a: unknown[]) => mocks.getAggregate(...a),
      saveAggregate: (a: unknown) => mocks.saveAggregate(a),
    },
    secrets: { get: (k: string) => mocks.secretsGet(k) },
    stt: { transcribe: (ref: string) => mocks.transcribe(ref) },
    llm: { classify: (id: string) => mocks.classify(id) },
  },
}))

vi.mock('@/app/accountStore', () => ({
  useAccountStore: {
    getState: () => ({ account: accountMocks.account, session: accountMocks.session }),
  },
  // store.ts 模块加载时调用 registerStoreRehydrate 注册回调（槽模式）；mock 需提供该导出，
  // 否则 store.ts 模块加载即抛「No registerStoreRehydrate export」。本用例不验 rehydrate 行为，no-op。
  registerStoreRehydrate: () => {},
  registerQuotaReset: () => {},
}))

import { useUiStore } from '@/app/store'

// ── Fixtures ────────────────────────────────────────────────────────────────

const audioEntry: Entry = {
  id: 'e1',
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
  parts: [{ type: 'audio', ref: 'r1', durationSec: 5 }],
  status: 'processing',
}

const baseSettings: Settings = {
  llmProvider: '',
  apiKeyRef: undefined,
  llmUrl: '',
  llmModel: '',
  sttProvider: '',
  sttModel: '',
  sttKeyRef: undefined,
  recordLocation: false,
  dailyReminder: false,
  theme: 'light',
  aggregateDetailLevel: 3,
  onboarded: true,
  sttMode: 'stream',
  sttUrl: undefined,
  videoVisionEnabled: false,
  videoFrameIntervalSec: 10,
  vlmProvider: '',
  vlmUrl: undefined,
  vlmModel: undefined,
  vlmKeyRef: undefined,
  keySource: 'byok',
} as Settings

const networkAccount: Account = {
  id: 'net-1',
  type: 'network',
  nickname: 'alice',
  email: 'a@b.com',
  plan: 'free',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const guestAccount: Account = {
  id: 'g1',
  type: 'guest',
  nickname: 'me',
  plan: 'guest',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const session: AuthSession = {
  jwt: 'jwt-token',
  refreshToken: 'r',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  accountMocks.account = null
  accountMocks.session = null

  // Default mocks: classify throws to short-circuit processEntry past the STT
  // gate — we only assert whether `di.stt.transcribe` was called, not the full
  // post-classify pipeline. The catch block needs getEntry + saveEntry.
  mocks.getSettings.mockResolvedValue({ ...baseSettings })
  mocks.getEntry.mockResolvedValue(audioEntry)
  mocks.saveEntry.mockResolvedValue(undefined)
  mocks.saveEntryAi.mockResolvedValue(undefined)
  mocks.listCategories.mockResolvedValue([])
  mocks.listTags.mockResolvedValue([])
  mocks.getAggregate.mockResolvedValue(null)
  mocks.saveAggregate.mockResolvedValue(undefined)
  mocks.secretsGet.mockResolvedValue(undefined)
  mocks.transcribe.mockResolvedValue('transcript text')
  mocks.classify.mockRejectedValue(new Error('classify not under test'))
  mocks.saveSettings.mockResolvedValue(undefined)

  // Reset store settings to a known state (keySource undefined → byok default).
  useUiStore.setState({ settings: { ...baseSettings, keySource: undefined } })
})

// ── processEntry STT gating ─────────────────────────────────────────────────

describe('processEntry — STT gate by keySource', () => {
  it('byok + stt:key exists → di.stt.transcribe called', async () => {
    mocks.getSettings.mockResolvedValue({ ...baseSettings, keySource: 'byok' })
    mocks.secretsGet.mockResolvedValue('user-stt-key')

    await useUiStore.getState().processEntry('e1', true)

    expect(mocks.transcribe).toHaveBeenCalled()
  })

  it('byok + no stt:key → di.stt.transcribe NOT called (skipped)', async () => {
    mocks.getSettings.mockResolvedValue({ ...baseSettings, keySource: 'byok' })
    mocks.secretsGet.mockResolvedValue(undefined)

    await useUiStore.getState().processEntry('e1', true)

    expect(mocks.transcribe).not.toHaveBeenCalled()
  })

  it('builtin + session exists → di.stt.transcribe called (builtinStt path)', async () => {
    mocks.getSettings.mockResolvedValue({ ...baseSettings, keySource: 'builtin' })
    accountMocks.session = session
    // builtin user has no stt:key secret — must NOT be the reason STT runs.
    mocks.secretsGet.mockResolvedValue(undefined)

    await useUiStore.getState().processEntry('e1', true)

    expect(mocks.transcribe).toHaveBeenCalled()
  })

  it('builtin + no session → di.stt.transcribe NOT called (skipped)', async () => {
    mocks.getSettings.mockResolvedValue({ ...baseSettings, keySource: 'builtin' })
    accountMocks.session = null
    mocks.secretsGet.mockResolvedValue(undefined)

    await useUiStore.getState().processEntry('e1', true)

    expect(mocks.transcribe).not.toHaveBeenCalled()
  })
})

// ── setKeySource action ─────────────────────────────────────────────────────

describe('setKeySource — guest guard + persistence', () => {
  it('guest account → setKeySource("builtin") rejected; keySource unchanged; saveSettings NOT called', () => {
    accountMocks.account = guestAccount
    useUiStore.setState({ settings: { ...baseSettings, keySource: 'byok' } })

    useUiStore.getState().setKeySource('builtin')

    expect(useUiStore.getState().settings.keySource).toBe('byok')
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('network account → setKeySource("builtin") sets keySource + calls saveSettings', () => {
    accountMocks.account = networkAccount
    useUiStore.setState({ settings: { ...baseSettings, keySource: 'byok' } })

    useUiStore.getState().setKeySource('builtin')

    expect(useUiStore.getState().settings.keySource).toBe('builtin')
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1)
    const saved = mocks.saveSettings.mock.calls[0][0] as Settings
    expect(saved.keySource).toBe('builtin')
  })

  it('network account → setKeySource("byok") sets keySource', () => {
    accountMocks.account = networkAccount
    useUiStore.setState({ settings: { ...baseSettings, keySource: 'builtin' } })

    useUiStore.getState().setKeySource('byok')

    expect(useUiStore.getState().settings.keySource).toBe('byok')
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('null account → setKeySource("builtin") rejected (defensive)', () => {
    accountMocks.account = null
    useUiStore.setState({ settings: { ...baseSettings, keySource: undefined } })

    useUiStore.getState().setKeySource('builtin')

    expect(useUiStore.getState().settings.keySource).toBeUndefined()
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })
})
