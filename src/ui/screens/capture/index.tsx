import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '@/app/store'
import { di } from '@/app/di'
import type { EntryPart } from '@/domain/types'
import {
  CameraView,
  CaptureHeader,
  CaptureKeyframes,
  CaptureToolbar,
  EmptyCompose,
  FlowPart,
  NoMicPanel,
  SaveBar,
  TextEntrySheet,
  VoicePanel,
} from './widgets'

type View = 'compose' | 'camera'

export default function Capture() {
  const navigate = useNavigate()
  const parts = useUiStore((s) => s.capture.parts)
  const recording = useUiStore((s) => s.capture.recording)
  const saving = useUiStore((s) => s.capture.saving)
  const micDenied = useUiStore((s) => s.capture.micDenied)
  const finalized = useUiStore((s) => s.capture.finalized)
  const interim = useUiStore((s) => s.capture.interim)
  const location = useUiStore((s) => s.capture.location)
  const startRecording = useUiStore((s) => s.startRecording)
  const stopRecording = useUiStore((s) => s.stopRecording)
  const beginSave = useUiStore((s) => s.beginSave)
  const finishSave = useUiStore((s) => s.finishSave)
  const addPart = useUiStore((s) => s.addPart)
  const allowMic = useUiStore((s) => s.allowMic)

  const [view, setView] = useState<View>('compose')
  const [cameraMode, setCameraMode] = useState<'photo' | 'video'>('photo')
  const [elapsed, setElapsed] = useState(0)
  const [textDraft, setTextDraft] = useState('')
  const [textOpen, setTextOpen] = useState(false)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})

  // Mirror into a ref so the unmount cleanup revokes the latest object URLs.
  const urlsRef = useRef<Record<string, string>>({})
  urlsRef.current = mediaUrls
  useEffect(() => () => { Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u)) }, [])

  // Count-up timer while voice-recording.
  useEffect(() => {
    if (!recording) { setElapsed(0); return }
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

  // Persist a media blob + add the part. Keeps a local object URL for live preview.
  const addMediaPart = (part: EntryPart, blob: Blob) => {
    if (part.type !== 'video' && part.type !== 'audio') return
    const url = URL.createObjectURL(blob)
    setMediaUrls((m) => ({ ...m, [part.ref]: url }))
    void di.storage.saveMedia(part.ref, blob).catch((e) => console.error('[capture] saveMedia failed', e))
    addPart(part)
  }

  const removePart = (idx: number) => {
    const p = parts[idx]
    if (p && (p.type === 'video' || p.type === 'audio') && mediaUrls[p.ref]) {
      URL.revokeObjectURL(mediaUrls[p.ref])
      setMediaUrls((m) => {
        const next = { ...m }
        delete next[p.ref]
        return next
      })
    }
    useUiStore.setState((s) => ({
      capture: { ...s.capture, parts: s.capture.parts.filter((_, i) => i !== idx) },
    }))
  }

  const closeTextSheet = () => {
    setTextDraft('')
    setTextOpen(false)
  }
  const submitText = () => {
    const t = textDraft.trim()
    if (t) addPart({ type: 'text', content: t })
    closeTextSheet()
  }

  const handleVoice = () => {
    if (micDenied) allowMic()
    void startRecording()
  }
  const handleStopVoice = () => { void stopRecording() }

  const openPhoto = () => { setCameraMode('photo'); setView('camera') }
  const openVideo = () => { setCameraMode('video'); setView('camera') }

  const handleGallery = async () => {
    const r = await di.capture.pickMedia()
    if (!r) return
    addMediaPart(
      { type: 'video', ref: r.ref, durationSec: r.kind === 'image' ? 0 : Math.max(1, Math.round(r.durationSec)) },
      r.blob,
    )
  }

  const handleSave = () => beginSave()

  const showHeader = view === 'compose'
  const showEmpty = parts.length === 0 && !recording && !micDenied

  return (
    <div className="relative flex h-full w-full flex-col bg-page">
      <CaptureKeyframes />

      {showHeader && (
        <CaptureHeader partCount={parts.length} location={location} onClose={() => navigate('/')} />
      )}

      <main className="relative flex-1 overflow-y-auto">
        {view === 'compose' && (
          recording ? (
            <VoicePanel
              elapsed={elapsed}
              liveTranscript={(finalized + interim).trim()}
              onStop={handleStopVoice}
            />
          ) : micDenied ? (
            <NoMicPanel
              onUseText={() => { allowMic(); setTextOpen(true) }}
              onRetry={() => { allowMic(); void startRecording() }}
            />
          ) : showEmpty ? (
            <EmptyCompose />
          ) : (
            <div className="flex flex-col gap-3 px-4 py-4">
              {parts.map((p, i) => (
                <FlowPart
                  key={i}
                  part={p}
                  mediaUrl={p.type === 'video' ? mediaUrls[p.ref] : undefined}
                  onRemove={() => removePart(i)}
                />
              ))}
            </div>
          )
        )}

        {view === 'camera' && (
          <CameraView
            mode={cameraMode}
            onPart={addMediaPart}
            onClose={() => setView('compose')}
          />
        )}
      </main>

      {view === 'compose' && !recording && !micDenied && (
        <footer className="flex shrink-0 flex-col gap-3 border-t border-brd bg-card px-4 pb-5 pt-3">
          <CaptureToolbar
            onText={() => setTextOpen(true)}
            onVoice={handleVoice}
            onPhoto={openPhoto}
            onVideo={openVideo}
            onGallery={handleGallery}
            disabled={saving}
          />
          <SaveBar saving={saving} disabled={parts.length === 0} onSave={handleSave} />
        </footer>
      )}

      <TextEntrySheet
        open={textOpen}
        value={textDraft}
        onChange={setTextDraft}
        onAdd={submitText}
        onCancel={closeTextSheet}
      />
    </div>
  )
}
