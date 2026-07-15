import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '@/app/store'
import { CaptureKeyframes } from './widgets'
import type { Mode } from './widgets'
import { EmptyView, MultiView, NoMicView, RecordingView } from './variants'
import type { CaptureApi } from './variants'

const SAMPLE_TRANSCRIPT = '…地铁里想到——如果记一条东西能顺便变成提醒或待办，就不用再开另一个 app 了…'
const SAMPLE_TEXT = '不用再开另一个 app 了'

export default function Capture() {
  const navigate = useNavigate()
  const parts = useUiStore((s) => s.capture.parts)
  const recording = useUiStore((s) => s.capture.recording)
  const saving = useUiStore((s) => s.capture.saving)
  const micDenied = useUiStore((s) => s.capture.micDenied)
  const startRecording = useUiStore((s) => s.startRecording)
  const stopRecording = useUiStore((s) => s.stopRecording)
  const beginSave = useUiStore((s) => s.beginSave)
  const finishSave = useUiStore((s) => s.finishSave)
  const addPart = useUiStore((s) => s.addPart)
  const allowMic = useUiStore((s) => s.allowMic)
  const denyMic = useUiStore((s) => s.denyMic)

  const [mode, setMode] = useState<Mode>('voice')
  const [popOpen, setPopOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // Count-up timer while recording.
  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => window.clearInterval(id)
  }, [recording])

  // Saving: after a short beat, finish + return home.
  useEffect(() => {
    if (!saving) return
    const id = window.setTimeout(() => {
      finishSave()
      navigate('/')
    }, 1200)
    return () => window.clearTimeout(id)
  }, [saving, finishSave, navigate])

  // Store has no removePart action; mutate via the exposed zustand setter so the
  // store remains the single source of truth. Candidate to promote to store.ts.
  const removePart = (idx: number) =>
    useUiStore.setState((s) => ({
      capture: { ...s.capture, parts: s.capture.parts.filter((_, i) => i !== idx) },
    }))

  const api: CaptureApi = {
    mode,
    popOpen,
    elapsed,
    parts,
    onClose: () => navigate('/'),
    onPickMode: (m) => {
      setMode(m)
      if (m === 'voice') {
        setElapsed(0)
        startRecording()
      } else if (m === 'text') {
        addPart({ type: 'text', content: SAMPLE_TEXT })
      }
    },
    onOpenVideoPop: () => {
      setMode('video')
      setPopOpen(true)
    },
    onClosePop: () => setPopOpen(false),
    onAddText: () => addPart({ type: 'text', content: SAMPLE_TEXT }),
    onAddVideo: () => {
      addPart({ type: 'video', ref: 'mock', durationSec: 8 })
      setPopOpen(false)
    },
    onStartRec: () => {
      setElapsed(0)
      startRecording()
    },
    onStop: () => {
      stopRecording()
      addPart({
        type: 'audio',
        ref: 'mock',
        durationSec: Math.max(1, elapsed),
        transcript: SAMPLE_TRANSCRIPT,
      })
    },
    onSave: () => beginSave(),
    onRemovePart: removePart,
    onToggleMic: () => (micDenied ? allowMic() : denyMic()),
    onAllowMic: () => allowMic(),
    onUseText: () => {
      allowMic()
      setMode('text')
    },
  }

  let body: ReactNode
  if (micDenied) body = <NoMicView api={api} />
  else if (recording) body = <RecordingView api={api} />
  else if (saving) body = <MultiView api={api} saving />
  else if (parts.length > 0) body = <MultiView api={api} />
  else body = <EmptyView api={api} />

  return (
    <div className="relative h-full w-full bg-page">
      <CaptureKeyframes />
      {body}
    </div>
  )
}
