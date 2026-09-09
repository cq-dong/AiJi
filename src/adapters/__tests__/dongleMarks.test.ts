import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/store'

// 纯 store 逻辑测试：markHighlight 累积 → stopRecording 把 draftMarks 写进 audio part。
// di.dongle.markHighlight 用假实现（atSec 由调用序号推算）。
vi.mock('@/app/di', async () => {
  const actual = await vi.importActual<typeof import('@/app/di')>('@/app/di')
  let n = 0
  return {
    ...actual,
    di: {
      ...actual.di,
      dongle: {
        ...actual.di.dongle,
        markHighlight: async () => ({ atSec: ++n }),
      },
    },
  }
})

beforeEach(() => {
  useUiStore.setState({
    capture: { ...useUiStore.getState().capture, draftMarks: [], recording: true },
    dongle: { state: 'connected', scanning: false },
  })
})

describe('录音豆重点标记 store 链路', () => {
  it('markHighlight 累积进 capture.draftMarks（含 label）', async () => {
    await useUiStore.getState().markHighlight('关键结论')
    await useUiStore.getState().markHighlight()
    const marks = useUiStore.getState().capture.draftMarks
    expect(marks).toHaveLength(2)
    expect(marks[0]).toEqual({ atSec: 1, label: '关键结论' })
    expect(marks[1]?.label).toBeUndefined()
  })

  it('dongle 源录音 stopRecording → audio part 带 marks；麦克风源不带', async () => {
    await useUiStore.getState().markHighlight()
    // dongle.state==='connected'（beforeEach 设定）→ part 应带 marks
    // stopAudio mock：返回极小 blob-less 结果（blob undefined → 不走 saveMedia）
    // （di.capture.stopAudio 未 mock 也能跑：webCapture 无 recorder 时返回空结果——
    //  jsdom 下 MediaRecorder undefined，走 transcript-only 路径。）
    await useUiStore.getState().stopRecording()
    const part = useUiStore.getState().capture.parts.at(-1)
    expect(part?.type).toBe('audio')
    if (part?.type === 'audio') expect(part.marks).toHaveLength(1)

    // 回落麦克风源：dongle.state='idle' → 新 part 无 marks 字段
    useUiStore.setState({ capture: { ...useUiStore.getState().capture, recording: true }, dongle: { state: 'idle', scanning: false } })
    await useUiStore.getState().stopRecording()
    const part2 = useUiStore.getState().capture.parts.at(-1)
    if (part2?.type === 'audio') expect(part2.marks).toBeUndefined()
  })
})
