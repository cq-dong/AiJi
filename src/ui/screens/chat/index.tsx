import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, ChevronDown, ChevronLeft, ChevronRight, History, Mic, Square, SquarePen } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Chip, Spinner, cn } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { t } from '@/app/i18n'
import { useT } from '@/app/i18n/useT'
import { HistorySheet } from './HistorySheet'
import type { ChatMessage, ChatTrace, Entry } from '@/domain/types'

// 裸路由顶栏：返回 ‹ + 标题「问 AI」+ 历史(History) / 新会话(SquarePen) 两图标按钮。
// 新会话在当前会话为空（无消息）时禁用——开新空会话无意义。
function TopBar({ onBack, onHistory, onNewChat, canNewChat }: { onBack: () => void; onHistory: () => void; onNewChat: () => void; canNewChat: boolean }) {
  const t = useT()
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-brd/70 bg-card/90 px-2 backdrop-blur-lg shadow-sm">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('chat.aria.back')}
        className="flex size-11 items-center justify-center rounded-btn text-t2 transition duration-base ease-out hover:bg-page active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <ChevronLeft size={24} strokeWidth={2} />
      </button>
      <h1 className="text-[24px] font-bold leading-tight text-ink">{t('chat.title')}</h1>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onHistory}
          aria-label={t('chat.aria.history')}
          className="flex size-11 items-center justify-center rounded-btn text-t2 transition duration-base ease-out hover:bg-page active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <History size={20} />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          disabled={!canNewChat}
          aria-label={t('chat.aria.newChat')}
          className="flex size-11 items-center justify-center rounded-btn text-t2 transition duration-base ease-out hover:bg-page active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-30 disabled:active:scale-100"
        >
          <SquarePen size={20} />
        </button>
      </div>
    </div>
  )
}

// 防幻觉层 4：引用 chip 点 → /detail/:id，verbatim 片段在 detail 内对齐。
// 标签取 summary/标题/首段文本前 16 字；条目已删（不在 entries）→ 灰显「已删除」不可点。
function citeLabel(id: string, entries: Entry[], aiByEntry: ReturnType<typeof useUiStore.getState>['aiByEntry']): { label: string; gone: boolean } {
  const entry = entries.find((e) => e.id === id)
  if (!entry) return { label: t('chat.citeDeleted'), gone: true }
  const ai = aiByEntry[id]
  const firstText = entry.parts.find((p) => p.type === 'text')?.content ?? ''
  const label = ai?.titleSuggestion || ai?.summary || firstText.slice(0, 16) || t('chat.entryFallback')
  return { label, gone: false }
}

function CitationChips({ ids, fresh }: { ids: string[]; fresh: boolean }) {
  const navigate = useNavigate()
  const entries = useUiStore((s) => s.entries)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  // 订阅语言：citeLabel 的「已删除」走全局 t()，切换语言需重渲刷新。
  useT()
  if (ids.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {ids.map((id, i) => {
        const { label, gone } = citeLabel(id, entries, aiByEntry)
        return (
          <button
            key={id}
            type="button"
            disabled={gone}
            onClick={() => navigate(`/detail/${id}`)}
            className={cn('disabled:cursor-default', fresh && 'animate-fade-in-up')}
            style={fresh ? { animationDelay: `${Math.min(i, 6) * 40 + 150}ms` } : undefined}
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
    // i18n：zh 提示词产「（见 <id>）」，en 产 "(see <id>)"——解析器两种 wire-format 都认。
    const citeRegex = new RegExp('[（(]\\s*(?:见|see)\\s+([a-zA-Z0-9_-]+)\\s*[）)]', 'gi')
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
            {t('chat.seeCite', { label: getLabel(id) })}
          </button>,
        )
      }
      lastIndex = match.index + fullMatch.length
    }
    citeNodes.push(part.slice(lastIndex))
    return <span key={i}>{citeNodes}</span>
  })
}

// D37: 思维链面板——理解问题→召回条目→组织回答的过程，默认折叠可展开。
function TracePanel({ trace }: { trace: ChatTrace }) {
  const [open, setOpen] = useState(false)
  const t = useT()
  const intent = trace.intent
  const recalled = trace.recalled ?? []
  // 无内容可展示时（无 intent/recalled/error）不渲染。
  if (!intent && recalled.length === 0 && !trace.error) return null

  const scopeType = intent?.scope
    ? intent.scope.type === 'day'
      ? t('chat.trace.scopeDay')
      : intent.scope.type === 'week'
        ? t('chat.trace.scopeWeek')
        : t('chat.trace.scopeMonth')
    : ''

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-t3 transition duration-base ease-out active:scale-[0.97]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t('chat.traceToggle')}</span>
      </button>
      {open && (
        <div className="mt-1.5 rounded-card bg-page px-3 py-2 text-[11px] leading-relaxed text-t2 space-y-1.5">
          {intent && (
            <div>
              <p className="text-t3">{t('chat.trace.intent')}</p>
              <p>
                {t('chat.trace.keywordsLabel')}
                {intent.keywords.length > 0 ? intent.keywords.join('、') : t('chat.trace.keywordsNone')}
              </p>
              {intent.scope && (
                <p>
                  {t('chat.trace.scopeLabel')}{scopeType} {intent.scope.range}
                </p>
              )}
              {intent.categorySlugs && intent.categorySlugs.length > 0 && (
                <p>{t('chat.trace.categoriesLabel')}{intent.categorySlugs.join('、')}</p>
              )}
            </div>
          )}
          {recalled.length > 0 && (
            <div>
              <p className="text-t3">{t('chat.trace.recalled', { count: recalled.length })}</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {recalled.map((r) => (
                  <li key={r.id}>{r.label}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-t3">{t('chat.trace.organize')}</p>
            <p>{t('chat.trace.organizeHint')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// AI 气泡：左对齐。解析 markdown 加粗/列表；引用 id 替换为条目名链接。
// fresh（本会话新到）→ 整泡 fade+rise 入场 + 行级渐进显现（≤320ms 入场动画，非假流式）；
// 历史消息（seenIds 命中）→ initial={false} 瞬显不播动画。
function AiBubble({ msg, fresh }: { msg: ChatMessage; fresh: boolean }) {
  const navigate = useNavigate()
  const entries = useUiStore((s) => s.entries)
  const aiByEntry = useUiStore((s) => s.aiByEntry)
  // 订阅语言：renderRichText 的「见 {label}」走全局 t()，切换语言需重渲刷新。
  useT()

  const getLabel = (id: string) => citeLabel(id, entries, aiByEntry).label
  const isValidId = (id: string) => !citeLabel(id, entries, aiByEntry).gone

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n')
    const elements: React.ReactNode[] = []
    let i = 0
    // 行渐显：每行延迟 40ms，封顶 8 行（≈320ms 全部显现——入场动画，不拖阅读）。
    const lineCls = fresh ? 'animate-fade-in-up' : undefined
    let lineIdx = 0
    const nextDelay = (): CSSProperties | undefined =>
      fresh ? { animationDelay: `${Math.min(lineIdx++, 7) * 40}ms` } : undefined
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
          <ul key={i} className={cn('list-disc pl-4 my-1 space-y-0.5', lineCls)} style={nextDelay()}>
            {items.map((item, idx) => (
              <li key={idx} className="leading-relaxed">
                {renderRichText(item, getLabel, isValidId, navigate)}
              </li>
            ))}
          </ul>,
        )
      } else if (trimmed === '') {
        elements.push(<div key={i} className={cn('h-2', lineCls)} style={nextDelay()} />)
      } else {
        elements.push(
          <p key={i} className={cn('my-0.5', lineCls)} style={nextDelay()}>
            {renderRichText(line, getLabel, isValidId, navigate)}
          </p>,
        )
      }
      i++
    }
    return elements
  }

  return (
    <motion.div
      className="flex justify-start"
      initial={fresh ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div className="max-w-[85%]">
        <div
          className={`rounded-card px-3 py-2 text-[13px] leading-relaxed whitespace-normal break-words shadow-sm ${msg.error ? 'bg-page text-t3' : 'bg-card text-ink border border-brd/80'}`}
        >
          {renderMarkdown(msg.content)}
        </div>
        {msg.citedEntryIds && msg.citedEntryIds.length > 0 && (
          <CitationChips ids={msg.citedEntryIds} fresh={fresh} />
        )}
        {msg.trace && <TracePanel trace={msg.trace} />}
      </div>
    </motion.div>
  )
}

function UserBubble({ msg, fresh }: { msg: ChatMessage; fresh: boolean }) {
  return (
    <motion.div
      className="flex justify-end"
      initial={fresh ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div className="max-w-[85%] rounded-card bg-gradient-to-b from-pri to-pri/90 px-3 py-2 text-[13px] leading-relaxed text-white shadow-glowPriSm whitespace-pre-wrap break-words">
        {msg.content}
      </div>
    </motion.div>
  )
}

const LOADING_KEYS = {
  intent: 'chat.loading.intent',
  recall: 'chat.loading.recall',
  answer: 'chat.loading.answer',
} as const

function LoadingBubble({ phase }: { phase: 'intent' | 'recall' | 'answer' }) {
  const t = useT()
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 rounded-card border border-brd/80 bg-card px-3 py-2 text-[13px] text-t2 shadow-sm">
        <Spinner size={14} />
        <span>{t(LOADING_KEYS[phase])}</span>
      </div>
    </div>
  )
}

function EmptyTalk() {
  const t = useT()
  return (
    <div className="mt-10 px-6 text-center">
      <p className="text-[15px] font-medium text-ink">{t('chat.emptyTitle')}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-t2">{t('chat.emptyHint')}</p>
    </div>
  )
}

export default function Chat() {
  const navigate = useNavigate()
  const t = useT()
  const conversation = useUiStore((s) => s.conversation)
  const chatLoading = useUiStore((s) => s.chatLoading)
  const online = useUiStore((s) => s.online)
  const sendMessage = useUiStore((s) => s.sendMessage)
  const newConversation = useUiStore((s) => s.newConversation)
  const chatVoice = useUiStore((s) => s.chatVoice)
  const startChatVoice = useUiStore((s) => s.startChatVoice)
  const stopChatVoice = useUiStore((s) => s.stopChatVoice)

  const [text, setText] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 入场动画的 fresh 判定：首个非空会话快照其全部消息 id 为「已见」——历史消息瞬显；
  // 之后到达的消息（id 不在快照）按 fresh 播入场动画。用户消息因会话创建即入快照，瞬显。
  const seenIds = useRef<Set<string> | null>(null)
  if (seenIds.current === null && conversation) {
    seenIds.current = new Set(conversation.messages.map((m) => m.id))
  }

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
      // 注意：局部变量名 transcript 而非 t，避免遮蔽组件级 useT() 的 i18n t。
      const transcript = await stopChatVoice()
      if (transcript) setText((prev) => `${prev.replace(/\s+$/, '')}${prev.trim() ? ' ' : ''}${transcript}`)
    } else {
      void startChatVoice()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={() => navigate('/')}
        onHistory={() => setHistoryOpen(true)}
        onNewChat={() => newConversation()}
        canNewChat={hasMessages}
      />

      {/* 隐私披露：问题 + 召回片段上送 LLM 作答（仅检索，AI 不写数据）。 */}
      <p className="shrink-0 px-4 text-[11px] text-t3">{t('chat.privacy')}</p>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          {!hasMessages && !loading && <EmptyTalk />}
          {messages.map((m) => {
            const fresh = !seenIds.current?.has(m.id)
            return m.role === 'user' ? (
              <UserBubble key={m.id} msg={m} fresh={fresh} />
            ) : (
              <AiBubble key={m.id} msg={m} fresh={fresh} />
            )
          })}
          {/* Loading 阶段切换：crossfade 过渡（intent→recall→answer 不硬切文案）。 */}
          <AnimatePresence mode="wait" initial={false}>
            {loading && (
              <motion.div
                key={chatLoading}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <LoadingBubble phase={chatLoading as 'intent' | 'recall' | 'answer'} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-brd/70 bg-card/90 px-3 py-2 backdrop-blur-lg">
        {!online && (
          <p className="mb-1.5 text-[11px] text-catFail">{t('chat.offlineHint')}</p>
        )}
        {chatVoice.micDenied && (
          <p className="mb-1.5 text-[11px] text-catFail">{t('chat.micDenied')}</p>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!online || loading}
            aria-label={recording ? t('chat.aria.stopVoice') : t('chat.aria.startVoice')}
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
            placeholder={recording ? t('chat.placeholderListening') : online ? t('chat.placeholder') : t('chat.placeholderOffline')}
            readOnly={recording}
            disabled={loading}
            rows={1}
            className="flex-1 resize-none rounded-btn border border-brd/80 bg-card px-3 py-2 text-[14px] text-ink shadow-sm placeholder:text-t3 focus:outline-none focus:border-pri/50 focus:shadow-glowPriSm focus-visible:ring-2 focus-visible:ring-pri/20 read-only:focus:shadow-sm read-only:focus:ring-0 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!text.trim() || loading || !online || recording}
            aria-label={t('chat.aria.send')}
            className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-gradient-to-b from-pri to-pri/90 text-white shadow-glowPriSm transition-all active:scale-90 disabled:opacity-40"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </form>

      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  )
}
