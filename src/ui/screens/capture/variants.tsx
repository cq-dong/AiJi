import { MicOff } from 'lucide-react'
import { Spinner } from '@/ui/components'
import type { EntryPart } from '@/domain/types'
import type { Mode } from './widgets'
import { CaptureHub, LiveWaveform, PartsStack, TriModal, VideoPop, fmtDur } from './widgets'

export interface CaptureApi {
  mode: Mode
  popOpen: boolean
  elapsed: number
  parts: EntryPart[]
  liveTranscript: string
  onClose: () => void
  onPickMode: (m: Mode) => void
  onOpenVideoPop: () => void
  onClosePop: () => void
  onAddText: () => void
  onAddVideo: () => void
  onStartRec: () => void
  onStop: () => void
  onSave: () => void
  onRemovePart: (i: number) => void
  onToggleMic: () => void
  onAllowMic: () => void
  onUseText: () => void
}

// ── Top bar ── "capture" kind: ✕ + 新条目 (+ N 片段 pill). "record" kind: ✕ + 语音录制 + 切换.
function TopBar({
  kind,
  partCount,
  onClose,
  onSwitch,
}: {
  kind: 'capture' | 'record'
  partCount: number
  onClose: () => void
  onSwitch: () => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute left-[24px] top-[14px] text-[20px] font-medium leading-none text-ink"
      >
        ✕
      </button>
      {kind === 'capture' ? (
        <>
          <h1 className="absolute left-[70px] top-[16px] text-[17px] font-bold text-ink">新条目</h1>
          {partCount > 0 && (
            <span className="absolute left-[298px] top-[10px] flex h-[26px] w-[60px] items-center justify-center rounded-[13px] bg-priS text-[11px] font-medium text-pri">
              {partCount} 片段
            </span>
          )}
        </>
      ) : (
        <>
          <h1 className="absolute left-1/2 top-[20px] -translate-x-1/2 whitespace-nowrap text-[17px] font-medium text-ink">
            语音录制
          </h1>
          <button
            type="button"
            onClick={onSwitch}
            className="absolute right-[24px] top-[22px] text-[14px] font-medium text-pri"
          >
            切换
          </button>
        </>
      )}
    </>
  )
}

function SaveButton({ saving, onSave }: { saving?: boolean; onSave: () => void }) {
  if (saving) {
    return (
      <div className="absolute left-[24px] top-[48px] flex h-10 w-[342px] items-center justify-center gap-2 rounded-btn border border-brd bg-priS text-[14px] font-medium text-pri">
        <Spinner size={16} /> 保存中…
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onSave}
      className="absolute left-[24px] top-[48px] flex h-10 w-[342px] items-center justify-center rounded-btn bg-pri text-[14px] font-medium text-white transition active:scale-[0.98]"
    >
      保存
    </button>
  )
}

// Shared bottom bar (recording / no-mic): 文本 + 视频 pills + location toggle.
function BottomBars() {
  return (
    <>
      <div className="absolute left-[16px] top-[584px] flex h-9 w-[84px] items-center justify-center rounded-[18px] border border-brd bg-card text-[13px] font-medium text-t2">
        文本
      </div>
      <div className="absolute left-[108px] top-[584px] flex h-9 w-[84px] items-center justify-center rounded-[18px] border border-brd bg-card text-[13px] font-medium text-t2">
        视频
      </div>
      <div className="absolute left-[16px] top-[636px] flex h-8 w-[200px] items-center rounded-card border border-brd px-[11px] text-[12px] text-t3">
        ○ 不记录地点 · 默认
      </div>
    </>
  )
}

// ── 28:2 empty default ──
export function EmptyView({ api }: { api: CaptureApi }) {
  return (
    <>
      <TopBar kind="capture" partCount={api.parts.length} onClose={api.onClose} onSwitch={api.onToggleMic} />
      <CaptureHub onClick={api.onStartRec} />
      <p className="absolute left-1/2 top-[344px] -translate-x-1/2 whitespace-nowrap text-[16px] font-medium text-ink">
        说一句、打几个字、或拍一张
      </p>
      <p className="absolute left-1/2 top-[372px] -translate-x-1/2 whitespace-nowrap text-[11px] text-t3">
        不点保存继续记，多条会堆成一条多片段
      </p>
      <p className="absolute left-1/2 top-[496px] -translate-x-1/2 whitespace-nowrap text-[12px] text-t3">
        选择片段类型
      </p>
      <TriModal mode={api.mode} top={518} onPick={api.onPickMode} onVideoPop={api.onOpenVideoPop} />
      <p className="absolute left-1/2 top-[596px] -translate-x-1/2 whitespace-nowrap text-[11px] text-t3">
        默认语音 · 点视频可选拍照或录视频
      </p>
    </>
  )
}

// ── 28:21 multi-fragment / 41:2 saving (saving=true) ──
export function MultiView({ api, saving }: { api: CaptureApi; saving?: boolean }) {
  return (
    <>
      <TopBar kind="capture" partCount={api.parts.length} onClose={api.onClose} onSwitch={api.onToggleMic} />
      <SaveButton saving={saving} onSave={api.onSave} />
      <PartsStack parts={api.parts} onRemove={api.onRemovePart} onAdd={api.onAddText} />
      <p className="absolute left-1/2 top-[424px] -translate-x-1/2 whitespace-nowrap text-[12px] text-t3">
        选择片段类型
      </p>
      <TriModal mode={api.mode} top={450} disabled={saving} onPick={api.onPickMode} onVideoPop={api.onOpenVideoPop} />
      {api.popOpen && <VideoPop top={396} disabled={saving} onPhoto={api.onAddVideo} onVideo={api.onAddVideo} />}
      <p className="absolute left-1/2 top-[516px] -translate-x-1/2 whitespace-nowrap text-[11px] text-t3">
        {saving
          ? '正在保存 · 片段将合并为一条条目'
          : api.popOpen
            ? '点视频后弹出 · 拍照或录视频'
            : '默认语音 · 点视频可选拍照或录视频'}
      </p>
    </>
  )
}

// ── 4:2 recording ──
export function RecordingView({ api }: { api: CaptureApi }) {
  return (
    <>
      <TopBar kind="record" partCount={api.parts.length} onClose={api.onClose} onSwitch={api.onToggleMic} />
      <div className="absolute left-1/2 top-[126px] -translate-x-1/2 flex size-[160px] items-center justify-center rounded-full border-[1.5px] border-pri/15 bg-priS/40">
        <LiveWaveform />
      </div>
      <div className="absolute left-1/2 top-[302px] -translate-x-1/2 flex items-center gap-2 whitespace-nowrap text-[13px] font-medium text-pri">
        <span
          className="inline-block size-[8px] rounded-full bg-pri"
          style={{ animation: 'aji-pulse 1s ease-in-out infinite' }}
        />
        录音中 · {fmtDur(api.elapsed)}
      </div>
      <div className="absolute left-[16px] top-[340px] w-[358px] rounded-card border border-brd bg-card p-[19px]">
        <p className="text-[12px] text-t3">正在转写</p>
        <p className="mt-[12px] w-[318px] text-[13px] leading-[1.5] text-t2">
          {api.liveTranscript || '…'}
        </p>
      </div>
      <button
        type="button"
        onClick={api.onStop}
        aria-label="停止录音"
        className="absolute left-1/2 top-[484px] -translate-x-1/2 flex size-[72px] items-center justify-center rounded-[36px] bg-pri active:scale-95"
      >
        <span className="block size-6 rounded-[4px] bg-card" />
      </button>
      <BottomBars />
      <p className="absolute left-[20px] top-[684px] whitespace-nowrap text-[12px] text-t3">点一下停止 · 长按取消</p>
    </>
  )
}

// ── 41:43 no microphone permission ──
export function NoMicView({ api }: { api: CaptureApi }) {
  return (
    <>
      <TopBar kind="record" partCount={api.parts.length} onClose={api.onClose} onSwitch={api.onToggleMic} />
      <div className="absolute left-1/2 top-[162px] -translate-x-1/2 flex size-20 items-center justify-center rounded-full border border-brd bg-card">
        <MicOff size={36} strokeWidth={1.8} className="text-t3" />
      </div>
      <p className="absolute left-1/2 top-[264px] -translate-x-1/2 whitespace-nowrap text-[16px] font-bold text-ink">
        麦克风未授权
      </p>
      <p className="absolute left-1/2 top-[294px] w-[318px] -translate-x-1/2 text-center text-[11px] leading-[1.5] text-t2">
        未获得麦克风权限 · 可在系统设置中开启，或改用文本记录
      </p>
      <button
        type="button"
        onClick={api.onUseText}
        className="absolute left-[40px] top-[348px] flex h-11 w-[150px] items-center justify-center rounded-btn bg-pri text-[13px] font-medium text-white"
      >
        改用文本
      </button>
      <button
        type="button"
        onClick={api.onAllowMic}
        className="absolute left-[200px] top-[348px] flex h-11 w-[150px] items-center justify-center rounded-btn border border-brd bg-card text-[13px] font-medium text-t2"
      >
        去设置
      </button>
      <BottomBars />
    </>
  )
}
