import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useUiStore } from '@/app/store'
import { useAccountStore } from '@/app/accountStore'
import { useQuotaStore } from '@/app/quotaStore'
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

// Task 16: toast 可携带可选 action（"注册网络账号"链接），pointer-events 启用以便点击。
function ActionToast({
  message,
  actionLabel,
  onAction,
  onDone,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
  onDone: () => void
}) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 3200)
    return () => window.clearTimeout(id)
  }, [onDone])
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-24 z-40 flex justify-center px-4">
      <div className="flex max-w-full items-center gap-3 rounded-btn bg-black/85 px-4 py-2.5 text-[13px] font-medium text-white shadow-lg">
        <span className="flex-1">{message}</span>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={() => { onAction(); onDone() }}
            className="shrink-0 rounded-btn bg-pri px-2.5 py-1 text-[12px] font-semibold text-white active:opacity-70"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

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
  // Task 16: 富 toast（带可选 action 链接）—— 采集失败引导 / session 过期。
  const [actionToast, setActionToast] = useState<{
    message: string
    actionLabel?: string
    onAction?: () => void
  } | null>(null)

  // Task 16: quota 耗尽 + 账号态。keySource 默认 'byok'（domain types: undefined→byok）。
  // quota 仅对 builtin 用户有意义（byok 用自己的 key，不耗内置额度）。
  const account = useAccountStore((s) => s.account)
  const sessionStale = useAccountStore((s) => s.sessionStale)
  const quotaExhausted = useQuotaStore((s) => s.exhausted)
  const settings = useUiStore((s) => s.settings)
  const keySource = settings?.keySource ?? 'byok'
  const isGuest = !account || account.type === 'guest'
  // builtin 且额度耗尽 → 采集入口降级（用户应切 byok 或等重置）。
  const quotaBlocked = keySource === 'builtin' && quotaExhausted

  // Task 16: session 过期信号——accountStore hydrate 时 refresh 失败置 sessionStale=true。
  // 此处不自动 logout（spec: LLM 失败只伤 AI 层；让用户看到失败条目再手动登出）。
  useEffect(() => {
    if (!sessionStale) return
    setActionToast({
      message: '登录已过期，请重新登录',
    })
  }, [sessionStale])
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

  // D1: 保存预检——byok-no-key / guest 含语音 part 时，显示转写失败 + 注册网络账号链接，
  // 仍保存（条目落库→processEntry STT 失败→条目 failed，匹配 spec「条目 failed」）但抑制
  // 即时 navigate，让 toast 留在屏上可点。3.5s 后自动回首页；点链接则清定时器去 /login。
  const skipNavigateRef = useRef(false)
  const navTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (navTimerRef.current !== null) window.clearTimeout(navTimerRef.current)
  }, [])

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
    void (async () => {
      const geoKey = (await di.secrets.get('geocoding:key')) ?? undefined
      const enriched = await enrichLocation(location, { key: geoKey })
      if (cancelled || !enriched.address) return
      useUiStore.setState((s) => ({
        capture: { ...s.capture, location: enriched },
      }))
    })()
    return () => { cancelled = true }
  }, [location])

  // Saving: persist + return home. (B3: 去掉原 1200ms 人工延迟——延迟期间条目只在 Zustand 内存，
  // 刷新/崩溃丢文本 part + 已 saveMedia 的 blob 成孤儿。finishSave (D7) 已 await saveEntry 落库；
  // saving 态在 await 期间自然驱动 SaveBar spinner，是真实落库耗时而非假延迟。)
  // D1: skipNavigateRef 由 handleSave 预检置位——byok-no-key/guest 语音保存时抑制即时 navigate，
  // 让 conversion toast 留屏可点；3.5s 后由 navTimer 自动回首页。
  useEffect(() => {
    if (!saving) return
    void finishSave()
    if (!skipNavigateRef.current) {
      navigate('/')
    }
    skipNavigateRef.current = false
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
  // D3 修复：native 路径先 probe，成功才清 micDenied——此前 allowMic() 先清再 probe，
  // probe 失败时 micDenied 残留 false，UI 卡在无 NoMicPanel 但 startRecording 又失败。
  const handleVoice = async () => {
    if (micDenied) {
      if (Capacitor.isNativePlatform()) {
        const ok = await di.capture.requestMicPermission()
        if (!ok) return // truly denied — micDenied 仍 true，NoMicPanel 保持
        allowMic() // probe 成功 → 清 micDenied
      } else {
        allowMic()
      }
    }
    void startRecording().catch(() => showCaptureFailureToast())
  }
  const handleStopVoice = () => {
    void stopRecording().catch(() => showCaptureFailureToast())
  }

  const openCamera = () => setView('camera')

  const handleGallery = async () => {
    try {
      const r = await di.capture.pickMedia()
      if (!r) return
      addMediaPart(
        { type: 'video', ref: r.ref, durationSec: r.kind === 'image' ? 0 : Math.max(1, Math.round(r.durationSec)), mime: r.mime, mediaType: r.kind === 'image' ? 'image' : 'video' },
        r.blob,
      )
    } catch {
      showCaptureFailureToast()
    }
  }

  // Task 16: 采集失败引导——仅 guest 或 (byok 且未配 stt:key) 时附"注册网络账号"链接。
  // network+builtin 用户失败只显纯文案 toast（无链接）。
  const showCaptureFailureToast = async () => {
    const eligible = isGuest || (keySource === 'byok' && !(await di.secrets.get('stt:key')))
    if (eligible) {
      setActionToast({
        message: '采集失败',
        actionLabel: '或注册网络账号用免费额度',
        onAction: () => navigate('/login'),
      })
    } else {
      setActionToast({ message: '采集失败，请重试' })
    }
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

  // D1: 保存前预检——含 audio part 且用户为 guest 或 (byok 且未配 stt:key) 时，
  // 显示「未配置语音 Key，转写将失败」+ 注册网络账号链接 toast，仍保存（条目经 processEntry
  // STT 失败→failed，匹配 spec「条目 failed」），但抑制即时 navigate 让 toast 可点；
  // 3.5s 后自动回首页，点链接则清定时器跳 /login。其余情况走正常保存+navigate。
  const handleSave = async () => {
    const hasAudio = parts.some((p) => p.type === 'audio')
    if (hasAudio) {
      const sttKey = await di.secrets.get('stt:key')
      const eligible = isGuest || (keySource === 'byok' && !sttKey)
      if (eligible) {
        skipNavigateRef.current = true
        setActionToast({
          message: '未配置语音 Key，转写将失败',
          actionLabel: '或注册网络账号用免费额度',
          onAction: () => {
            if (navTimerRef.current !== null) {
              window.clearTimeout(navTimerRef.current)
              navTimerRef.current = null
            }
            navigate('/login')
          },
        })
        beginSave()
        navTimerRef.current = window.setTimeout(() => {
          navTimerRef.current = null
          navigate('/')
        }, 3500)
        return
      }
    }
    beginSave()
  }

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

      {/* Task 16: quota 耗尽提示（仅 builtin 用户）—— byok 用自己的 key 不受此限。 */}
      {view === 'compose' && quotaBlocked && (
        <div className="mx-4 mb-2 rounded-chip bg-catPending/10 px-3 py-2.5">
          <p className="text-[12px] font-medium text-catPending">
            今日内置额度已用完，明早 8 点重置
          </p>
          <p className="mt-0.5 text-[11px] text-t3">
            或切用自己的 Key
          </p>
        </div>
      )}

      <main className="relative flex-1 overflow-y-auto">
        {view === 'compose' && (
          micDenied && !recording ? (
            <NoMicPanel
              onUseText={() => { allowMic(); setTextOpen(true) }}
              onRetry={() => {
                // D3 修复：native 先 probe，成功才清 micDenied + 开始录音——
                // 此前 allowMic() 先清再 probe，probe 失败时 micDenied 残留 false。
                if (Capacitor.isNativePlatform()) {
                  void di.capture.requestMicPermission().then((ok) => {
                    if (ok) {
                      allowMic()
                      void startRecording()
                    }
                  })
                } else {
                  allowMic()
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
              disabled={saving || quotaBlocked}
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
      {actionToast && (
        <ActionToast
          message={actionToast.message}
          actionLabel={actionToast.actionLabel}
          onAction={actionToast.onAction}
          onDone={() => setActionToast(null)}
        />
      )}
    </div>
  )
}
