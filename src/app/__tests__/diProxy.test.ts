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

  // B1 回归（2026-09-28 流式验收）：llmProxy.answerChat 必须把第二参 onEvent 透传到底层
  // 适配器——旧实现只转单参，真链路（builtin/byok 经 DI）流式全灭，单测全 mock di.llm 漏检。
  it('B1: byok → answerChat 的 onEvent 透传到 openAiCompatLlm', async () => {
    getSettings.mockResolvedValue({ keySource: 'byok' })
    const spy = vi.spyOn(openAiCompatLlm, 'answerChat').mockResolvedValue({ answer: '', citedEntryIds: [] })
    const onEvent = (): void => {}
    await di.llm.answerChat({ question: 'q', cites: [], conversation: [] }, onEvent)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][1]).toBe(onEvent) // 同一回调引用到达底层适配器
  })
  it('B1: builtin → answerChat 的 onEvent 透传到 builtinLlm', async () => {
    getSettings.mockResolvedValue({ keySource: 'builtin' })
    const spy = vi.spyOn(builtinLlm, 'answerChat').mockResolvedValue({ answer: '', citedEntryIds: [] })
    const onEvent = (): void => {}
    await di.llm.answerChat({ question: 'q', cites: [], conversation: [] }, onEvent)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][1]).toBe(onEvent)
  })
  it('B1: 省略 onEvent → 底层同样收到 undefined（非流式旧路径不破）', async () => {
    getSettings.mockResolvedValue({ keySource: 'byok' })
    const spy = vi.spyOn(openAiCompatLlm, 'answerChat').mockResolvedValue({ answer: '', citedEntryIds: [] })
    await di.llm.answerChat({ question: 'q', cites: [], conversation: [] })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][1]).toBeUndefined()
  })
})
