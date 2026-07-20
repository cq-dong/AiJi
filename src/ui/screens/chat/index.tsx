import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, ChevronLeft, Eraser, Mic, Square } from 'lucide-react'
import { Chip, Spinner } from '@/ui/components'
import { useUiStore } from '@/app/store'
import type { ChatMessage, Entry } from '@/domain/types'

// 裸路由顶栏：返回 ‹ + 标题「问 AI」+ 清空会话（Eraser）。
function TopBar({ onBack, onClear, canClear }: { onBack: () => void; onClear: () => void; canClear: boolean }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between px-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回"
        className="flex size-11 items-center justify-center rounded-btn text-t2 transition duration-base ease-out hover:bg-page active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <ChevronLeft size={24} strokeWidth={2} />
      </button>
      <h1 className="text-[24px] font-bold leading-tight text-ink">问 AI</h1>
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        aria-label="清空会话"
        className="flex size-11 items-center justify-center rounded-btn text-t2 transition duration-base ease-out hover:bg-page active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-30 disabled:active:scale-100"
      >
        <Eraser size={18} />
      </button>
    </div>
  )
}

// 防幻觉层 4：引用 chip 点 → /detail/:id，verbatim 片段在 detail 内对齐。
// 标签取 summary/标题/首段文本前 16 字；条目已删（不在 entries）→ 灰显「已删除」不可点。
function citeLabel(id: string, entries: Entry[], aiByEntry: ReturnType<typeof useUiStore.getState>['aiByEntry']): { label: string; gone: boolean } {
  const entry = entries.find((e) => e.id === id)
  if (!entry) return { label: '已删除', gone: true }
  const ai = aiByEntry[id]
  const firstText = entry.parts.find((p) => p.type === 'text')?.content ?? ''
  const label = ai?.titleSuggestion || ai?.summary || firstText.slice(0, 16) || '条目'
  return { label, gone: false }
}

function CitationChips({ ids }: { ids: string[] }) {
  const navigate = useNavigate()
  const entries = useUiStore((s) => s.entries)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  if (ids.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const { label, gone } = citeLabel(id, entries, aiByEntry)
        return (
          <button
            key={id}
            type="button"
            disabled={gone}
            onClick={() => navigate(`/detail/${id}`)}
            className="disabled:cursor-default"
          >
            <Chip tone="idea">{gone ? label : `#${label}`}</Chip>
          </button>
        )
      })}
    </div>
  )
}

// 解析一段文本中的 **加粗** 和（见 id）引用。
// D29: 非法 id（条目已删/LLM 臆造）的引用段整段跳过，不显「已删除」（实未删，是 LLM 幻觉）。
function renderRichText(
  text: string,
  getLabel: (id: string) => string,
  isValidId: (id: string) => boolean,
  navigate: ReturnType<typeof useNavigate>,
): React.ReactNode {
  const boldParts = text.split(/(\*\*[^*]+?\*\*)/g)
  return boldParts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <b key={i}>{part.slice(2, -2)}</b>
    }
    const citeRegex = new RegExp('（见\\s+([a-zA-Z0-9-]+)）', 'g')
    const citeNodes: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = citeRegex.exec(part)) !== null) {
      const [fullMatch, id] = match
      citeNodes.push(part.slice(lastIndex, match.index))
      if (isValidId(id)) {
        citeNodes.push(
          <button
            key={`cite-${i}-${match.index}`}
            type="button"
            onClick={() => navigate(`/detail/${id}`)}
            className="text-pri underline hover:text-pri/80 cursor-pointer"
          >
            （见 {getLabel(id)}）
          </button>,
        )
      }
      lastIndex = match.index + fullMatch.length
    }
    citeNodes.push(part.slice(lastIndex))
    return <span key={i}>{citeNodes}</span>
  })
}

// AI 气泡：左对齐。解析 markdown 加粗/列表；引用 id 替换为条目名链接。
function AiBubble({ msg }: { msg: ChatMessage }) {
  const navigate = useNavigate()
  const entries = useUiStore((s) => s.entries)
  const aiByEntry = useUiStore((s) => s.aiByEntry)

  const getLabel = (id: string) => citeLabel(id, entries, aiByEntry).label
  const isValidId = (id: string) => !citeLabel(id, entries, aiByEntry).gone

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n')
    const elements: React.ReactNode[] = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()
      if (trimmed.startsWith('- ')) {
        const items: string[] = []
        while (i < lines.length && lines[i].trim().startsWith('- ')) {
          items.push(lines[i].trim().slice(2))
          i++
        }
        i--
        elements.push(
          <ul key={i} className="list-disc pl-4 my-1 space-y-0.5">
            {items.map((item, idx) => (
              <li key={idx} className="leading-relaxed">
                {renderRichText(item, getLabel, isValidId, navigate)}
              </li>
            ))}
          </ul>,
        )
      } else if (trimmed === '') {
        elements.push(<div key={i} className="h-2" />)
      } else {
        elements.push(
          <p key={i} className="my-0.5">
            {renderRichText(line, getLabel, isValidId, navigate)}
          </p>,
        )
      }
      i++
    }
    return elements
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        <div
          className={`rounded-card px-3 py-2 text-[13px] leading-relaxed whitespace-normal break-words ${msg.error ? 'bg-page text-t3' : 'bg-card text-ink border border-brd'}`}
        >
          {renderMarkdown(msg.content)}
        </div>
        {msg.citedEntryIds && msg.citedEntryIds.length > 0 && <CitationChips ids={msg.citedEntryIds} />}
      </div>
    </div>
  )
}

function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-card bg-pri px-3 py-2 text-[13px] leading-relaxed text-white whitespace-pre-wrap break-words">
        {msg.content}
      </div>
    </div>
  )
}

const LOADING_TEXT: Record<'intent' | 'recall' | 'answer', string> = {
  intent: '理解问题…',
  recall: '检索库中…',
  answer: '组织回答…',
}

function LoadingBubble({ phase }: { phase: 'intent' | 'recall' | 'answer' }) {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 rounded-card bg-card px-3 py-2 text-[13px] text-t2 border border-brd">
        <Spinner size={14} />
        <span>{LOADING_TEXT[phase]}</span>
      </div>
    </div>
  )
}

function EmptyTalk() {
  return (
    <div className="mt-10 px-6 text-center">
      <p className="text-[15px] font-medium text-ink">问库里的内容</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-t2">
        试试「我上个月关于跑步的想法」「桂花拿铁那条」「这周做了什么」
      </p>
    </div>
  )
}

export default function Chat() {
  const navigate = useNavigate()
  const conversation = useUiStore((s) => s.conversation)
  const chatLoading = useUiStore((s) => s.chatLoading)
  const online = useUiStore((s) => s.online)
  const sendMessage = useUiStore((s) => s.sendMessage)
  const clearConversation = useUiStore((s) => s.clearConversation)
  const chatVoice = useUiStore((s) => s.chatVoice)
  const startChatVoice = useUiStore((s) => s.startChatVoice)
  const stopChatVoice = useUiStore((s) => s.stopChatVoice)

  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // 新消息 / loading 阶段变化 → 滚到底。
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversation?.messages.length, chatLoading])

  // 卸载时若在录音 → 停 mic 释放（防 mic 灯长亮 + 适配器 singleton 残留，CapturePort 共享一个 recorder/stream）。
  useEffect(() => {
    return () => {
      if (useUiStore.getState().chatVoice.recording) void useUiStore.getState().stopChatVoice()
    }
  }, [])

  const messages = conversation?.messages ?? []
  const hasMessages = messages.length > 0
  const loading = chatLoading !== 'idle'
  const recording = chatVoice.recording

  // 录音中：textarea 显「已键入文本 + live 转写」；停止时把转写并入 text（seamless：显示不变，仅切数据源）。
  const voiceTranscript = chatVoice.finalized + chatVoice.interim
  const inputValue = recording
    ? `${text.replace(/\s+$/, '')}${text.trim() ? ' ' : ''}${voiceTranscript}`
    : text

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = text.trim()
    if (!v || loading || recording) return
    setText('')
    void sendMessage(v)
  }

  const toggleVoice = async () => {
    if (recording) {
      const t = await stopChatVoice()
      if (t) setText((prev) => `${prev.replace(/\s+$/, '')}${prev.trim() ? ' ' : ''}${t}`)
    } else {
      void startChatVoice()
    }
  }

  const onClear = () => {
    if (hasMessages && window.confirm('清空当前会话？')) void clearConversation()
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar onBack={() => navigate('/')} onClear={onClear} canClear={hasMessages} />

      {/* 隐私披露：问题 + 召回片段上送 LLM 作答（仅检索，AI 不写数据）。 */}
      <p className="shrink-0 px-4 text-[11px] text-t3">
        问答仅本地检索，问题与片段将上送 LLM 作答 · AI 不会改动你的条目
      </p>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          {!hasMessages && !loading && <EmptyTalk />}
          {messages.map((m) =>
            m.role === 'user' ? <UserBubble key={m.id} msg={m} /> : <AiBubble key={m.id} msg={m} />,
          )}
          {loading && <LoadingBubble phase={chatLoading as 'intent' | 'recall' | 'answer'} />}
        </div>
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-brd bg-card px-3 py-2">
        {!online && (
          <p className="mb-1.5 text-[11px] text-catFail">离线中，连上网再问</p>
        )}
        {chatVoice.micDenied && (
          <p className="mb-1.5 text-[11px] text-catFail">麦克风被拒，去系统设置开权限后重试</p>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!online || loading}
            aria-label={recording ? '停止语音' : '语音输入'}
            className="flex size-10 shrink-0 items-center justify-center rounded-btn text-t2 active:bg-page disabled:opacity-40"
          >
            {recording ? (
              <span className="relative flex size-5 items-center justify-center">
                <span className="absolute inline-flex size-5 animate-ping rounded-full bg-catFail/40" />
                <Square size={16} className="relative text-catFail" fill="currentColor" />
              </span>
            ) : (
              <Mic size={20} />
            )}
          </button>
          <textarea
            value={inputValue}
            onChange={(e) => !recording && setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e as unknown as React.FormEvent)
            }}
            placeholder={recording ? '正在听…' : online ? '问点什么…' : '离线中'}
            readOnly={recording}
            disabled={loading}
            rows={1}
            className="flex-1 resize-none rounded-btn bg-page px-3 py-2 text-[14px] text-ink placeholder:text-t3 focus:outline-none focus:ring-1 focus:ring-pri/40 read-only:focus:ring-0 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!text.trim() || loading || !online || recording}
            aria-label="发送"
            className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-pri text-white disabled:opacity-40"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </form>
    </div>
  )
}
