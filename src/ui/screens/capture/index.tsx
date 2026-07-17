import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useUiStore } from '@/app/store'
import { di } from '@/app/di'
import { enrichLocation } from '@/adapters/geocoding'
import type { EntryPart } from '@/domain/types'
import {
  CameraView,
  CaptureHeader,
  CaptureKeyframes,
  CaptureToolbar,
  DraftHintBanner,
  EmptyCompose,
  FlowPart,
  InterimBubble,
  NoMicPanel,
  SaveBar,
  TextPartEditor,
  Toast,
  VoiceBar,
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
  const title = useUiStore((s) => s.capture.title)
  const hydrated = useUiStore((s) => s.hydrated)
  const startRecording = useUiStore((s) => s.startRecording)
  const stopRecording = useUiStore((s) => s.stopRecording)
  const beginSave = useUiStore((s) => s.beginSave)
  const finishSave = useUiStore((s) => s.finishSave)
  const addPart = useUiStore((s) => s.addPart)
  const allowMic = useUiStore((s) => s.allowMic)
  const clearDraft = useUiStore((s) => s.clearDraft)
  const saveDraft = useUiStore((s) => s.saveDraft)
  const primeLocation = useUiStore((s) => s.primeLocation)

  const [view, setView] = useState<View>('compose')
  const [elapsed, setElapsed] = useState(0)
  const [textDraft, setTextDraft] = useState('')
  const [textOpen, setTextOpen] = useState(false)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)
  // Wave 3 #4: draft hint banner — shows when parts are restored from a
  // persisted draft on hydrate. Initialized from current parts (common case:
  // hydrate completed before navigating to /capture). Also checks once more
  // after hydrated transitions to true to catch the loadDraft async race.
  const [showDraftHint, setShowDraftHint] = useState(() => parts.length > 0)
  const draftChecked = useRef(parts.length > 0)

  // Mirror into a ref so the unmount cleanup revokes the latest object URLs.
  const urlsRef = useRef<Record<string, string>>({})
  urlsRef.current = mediaUrls
  useEffect(() => () => { Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u)) }, [])

  // L1: 卸载时若在录音/相机 → 停 tracks，免麦克风指示灯/相机常驻（用户按 X 关、navigate 离开均触发 unmount）。
  // stopRecording 把在录音频 finalize 成 part 落到 store（post-unmount set 仍生效），stopCamera 释放相机流。
  useEffect(() => () => {
    if (useUiStore.getState().capture.recording) void useUiStore.getState().stopRecording()
    void di.capture.stopCamera()
  }, [])

  // Count-up timer while voice-recording.
  useEffect(() => {
    if (!recording) { setElapsed(0); return }
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => window.clearInterval(id)
  }, [recording])

  // recordLocation 修复：capture 屏挂载即取地点，覆盖文本/相机/相册条目（此前仅语音
  // startRecording 调 primeLocation → 其他条目类型 entry.location 恒丢）。幂等：recordLocation
  // 关/已取则 no-op。等 hydrated 再取，避免 boot 竞态用 seed 默认覆盖用户已关的设置。
  useEffect(() => {
    if (!hydrated) return
    primeLocation()
  }, [hydrated, primeLocation])

  // D5: async reverse-geocode the captured coordinates into a human-readable
  // address. Fires when location arrives (from primeLocation) and has no address
  // yet. Non-blocking — if the user saves before the address comes back, the
  // entry persists with lat/lng only. Guarded against re-enrichment (address set
  // → skip) to avoid infinite loops.
  useEffect(() => {
    if (!location) return
    if (location.address) return
    let cancelled = false
    void enrichLocation(location).then((enriched) => {
      if (cancelled || !enriched.address) return
      useUiStore.setState((s) => ({
        capture: { ...s.capture, location: enriched },
      }))
    })
    return () => { cancelled = true }
  }, [location])

  // Saving: persist + return home. (B3: 去掉原 1200ms 人工延迟——延迟期间条目只在 Zustand 内存，
  // 刷新/崩溃丢文本 part + 已 saveMedia 的 blob 成孤儿。finishSave (D7) 已 await saveEntry 落库；
  // saving 态在 await 期间自然驱动 SaveBar spinner，是真实落库耗时而非假延迟。)
  useEffect(() => {
    if (!saving) return
    void finishSave()
    navigate('/')
  }, [saving, finishSave, navigate])

  // Draft hint: if parts were empty on mount, check again after hydrate
  // completes (loadDraft runs async inside hydrate, so parts may arrive
  // a tick after hydrated becomes true). Only checks once — user-added parts
  // during a fresh session won't trigger the hint.
  useEffect(() => {
    if (draftChecked.current || !hydrated) return
    const id = window.setTimeout(() => {
      if (useUiStore.getState().capture.parts.length > 0) {
        setShowDraftHint(true)
      }
      draftChecked.current = true
    }, 150)
    return () => window.clearTimeout(id)
  }, [hydrated])

  // Persist a media blob + add the part. Keeps a local object URL for live preview.
  const addMediaPart = (part: EntryPart, blob: Blob) => {
    if (part.type !== 'video' && part.type !== 'audio') return
    const url = URL.createObjectURL(blob)
    setMediaUrls((m) => ({ ...m, [part.ref]: url }))
    void di.storage.saveMedia(part.ref, blob).catch((e) => console.error('[capture] saveMedia failed', e))
    addPart(part)
  }

  const editPart = (idx: number, content: string) => {
    useUiStore.setState((s) => ({
      capture: {
        ...s.capture,
        parts: s.capture.parts.map((p, i) =>
          i === idx && p.type === 'text' ? { ...p, content } : p,
        ),
      },
    }))
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
    if (t) addPart({ type: 'text', content: t, mediaType: 'text' })
    closeTextSheet()
  }

  // D3: On Capacitor native (Android WebView), navigator.permissions.query is
  // unreliable — it may return 'denied'/'prompt' even when the system permission
  // is granted. Probe with an actual getUserMedia({audio:true}) call (via
  // requestMicPermission) to avoid false-negative denial. If the probe succeeds,
  // proceed to startRecording; if it fails, the NoMicPanel stays.
  const handleVoice = async () => {
    if (micDenied) {
      allowMic()
      if (Capacitor.isNativePlatform()) {
        const ok = await di.capture.requestMicPermission()
        if (!ok) return // truly denied — NoMicPanel re-shows via micDenied
      }
    }
    void startRecording()
  }
  const handleStopVoice = () => { void stopRecording() }

  const openCamera = () => setView('camera')

  const handleGallery = async () => {
    const r = await di.capture.pickMedia()
    if (!r) return
    addMediaPart(
      { type: 'video', ref: r.ref, durationSec: r.kind === 'image' ? 0 : Math.max(1, Math.round(r.durationSec)), mime: r.mime, mediaType: r.kind === 'image' ? 'image' : 'video' },
      r.blob,
    )
  }

  // Wave 3 #3: title editing — update store.capture.title directly (no setTitle
  // action; UI-only field). Empty string on blur → set undefined (display "新条目").
  const handleTitleChange = (v: string | undefined) => {
    useUiStore.setState((s) => ({ capture: { ...s.capture, title: v } }))
  }

  // Wave 3 #4: 清空 — confirm before clearing (draft in memory + Dexie).
  const handleClear = () => {
    if (parts.length === 0) return
    if (window.confirm('清空当前草稿？')) {
      clearDraft()
      setShowDraftHint(false)
      setToast('已清空')
    }
  }

  // Wave 3 #4: 存草稿 — persist parts+title+location to Dexie, brief toast.
  const handleSaveDraft = () => {
    saveDraft()
    setToast('已存草稿')
  }

  const handleSave = () => beginSave()

  const showHeader = view === 'compose'
  const showEmpty = parts.length === 0 && !recording && !micDenied && !textOpen
  const liveTranscript = (finalized + interim).trim()

  return (
    <div className="relative flex h-full w-full flex-col bg-page">
      <CaptureKeyframes />

      {showHeader && (
        <CaptureHeader
          partCount={parts.length}
          location={location}
          title={title}
          onTitleChange={handleTitleChange}
          onClose={() => navigate('/')}
        />
      )}

      {/* Wave 3 #4: draft restored hint */}
      {view === 'compose' && showDraftHint && parts.length > 0 && (
        <DraftHintBanner onDismiss={() => setShowDraftHint(false)} />
      )}

      <main className="relative flex-1 overflow-y-auto">
        {view === 'compose' && (
          micDenied && !recording ? (
            <NoMicPanel
              onUseText={() => { allowMic(); setTextOpen(true) }}
              onRetry={() => {
                allowMic()
                // D3: native platform — probe with getUserMedia before retrying
                // startRecording, to avoid false-negative from navigator.permissions.
                if (Capacitor.isNativePlatform()) {
                  void di.capture.requestMicPermission().then((ok) => {
                    if (ok) void startRecording()
                  })
                } else {
                  void startRecording()
                }
              }}
            />
          ) : showEmpty ? (
            <EmptyCompose />
          ) : (
            <div className="flex flex-col gap-3 px-4 py-4">
              {textOpen && (
                <TextPartEditor
                  value={textDraft}
                  onChange={setTextDraft}
                  onConfirm={submitText}
                  onCancel={closeTextSheet}
                />
              )}
              {parts.map((p, i) => (
                <FlowPart
                  key={i}
                  part={p}
                  mediaUrl={p.type === 'video' ? mediaUrls[p.ref] : undefined}
                  onRemove={() => removePart(i)}
                  onEdit={(v) => editPart(i, v)}
                />
              ))}
              {/* Wave 3 #2: interim transcription bubble — stays inline during recording */}
              {recording && <InterimBubble liveTranscript={liveTranscript} />}
            </div>
          )
        )}

        {view === 'camera' && (
          <CameraView
            onPart={addMediaPart}
            onClose={() => setView('compose')}
          />
        )}
      </main>

      {view === 'compose' && (
        recording ? (
          // Wave 3 #2: compact recording bar at footer — parts list stays visible
          <VoiceBar elapsed={elapsed} onStop={handleStopVoice} />
        ) : !micDenied && (
          <footer className="flex shrink-0 flex-col gap-3 border-t border-brd bg-card px-4 pb-5 pt-3">
            <CaptureToolbar
              onText={() => setTextOpen(true)}
              onVoice={handleVoice}
              onCamera={openCamera}
              onGallery={handleGallery}
              disabled={saving}
            />
            <SaveBar
              saving={saving}
              disabled={parts.length === 0}
              onClear={handleClear}
              onSaveDraft={handleSaveDraft}
              onSave={handleSave}
            />
          </footer>
        )
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
