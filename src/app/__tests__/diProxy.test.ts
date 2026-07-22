import { describe, it, expect, beforeEach, vi } from 'vitest'
import { di } from '@/app/di'
import { openAiCompatLlm } from '@/adapters/openAiCompatLlm'
import { builtinLlm } from '@/adapters/builtinLlm'
import { paraformerStreamStt } from '@/adapters/paraformerStreamStt'
import { whisperRestStt } from '@/adapters/whisperRestStt'
import { builtinStt } from '@/adapters/builtinStt'

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }))
vi.mock('@/adapters/dexieStorage', () => ({ dexieStorage: { getSettings } }))
beforeEach(() => {
  getSettings.mockReset()
  vi.restoreAllMocks()
})

describe('di proxies', () => {
  it('byok → llm routes to openAiCompatLlm, not builtinLlm', async () => {
    getSettings.mockResolvedValue({ keySource: 'byok' })
    const byokSpy = vi.spyOn(openAiCompatLlm, 'classify').mockResolvedValue(null as never)
    const builtinSpy = vi.spyOn(builtinLlm, 'classify').mockResolvedValue(null as never)
    await di.llm.classify('e1')
    expect(byokSpy).toHaveBeenCalledOnce()
    expect(builtinSpy).not.toHaveBeenCalled()
  })
  it('byok → stt routes to paraformer (stream mode)', async () => {
    getSettings.mockResolvedValue({ keySource: 'byok', sttMode: 'stream' })
    const pSpy = vi.spyOn(paraformerStreamStt, 'transcribe').mockResolvedValue('')
    const wSpy = vi.spyOn(whisperRestStt, 'transcribe').mockResolvedValue('')
    const bSpy = vi.spyOn(builtinStt, 'transcribe').mockResolvedValue('')
    await di.stt.transcribe('r')
    expect(pSpy).toHaveBeenCalledOnce()
    expect(wSpy).not.toHaveBeenCalled()
    expect(bSpy).not.toHaveBeenCalled()
  })
  it('byok + whisper mode → whisper', async () => {
    getSettings.mockResolvedValue({ keySource: 'byok', sttMode: 'whisper' })
    const wSpy = vi.spyOn(whisperRestStt, 'transcribe').mockResolvedValue('')
    await di.stt.transcribe('r')
    expect(wSpy).toHaveBeenCalledOnce()
  })
  it('builtin → llm routes to builtinLlm, not openAiCompatLlm', async () => {
    getSettings.mockResolvedValue({ keySource: 'builtin' })
    const byokSpy = vi.spyOn(openAiCompatLlm, 'classify').mockResolvedValue(null as never)
    const builtinSpy = vi.spyOn(builtinLlm, 'classify').mockResolvedValue(null as never)
    await di.llm.classify('e1')
    expect(builtinSpy).toHaveBeenCalledOnce()
    expect(byokSpy).not.toHaveBeenCalled()
  })
  it('builtin → stt routes to builtinStt', async () => {
    getSettings.mockResolvedValue({ keySource: 'builtin' })
    const bSpy = vi.spyOn(builtinStt, 'transcribe').mockResolvedValue('')
    const pSpy = vi.spyOn(paraformerStreamStt, 'transcribe').mockResolvedValue('')
    await di.stt.transcribe('r')
    expect(bSpy).toHaveBeenCalledOnce()
    expect(pSpy).not.toHaveBeenCalled()
  })
  it('keySource undefined → byok', async () => {
    getSettings.mockResolvedValue({})
    const byokSpy = vi.spyOn(openAiCompatLlm, 'classify').mockResolvedValue(null as never)
    const builtinSpy = vi.spyOn(builtinLlm, 'classify').mockResolvedValue(null as never)
    await di.llm.classify('e1')
    expect(byokSpy).toHaveBeenCalledOnce()
    expect(builtinSpy).not.toHaveBeenCalled()
  })
})
