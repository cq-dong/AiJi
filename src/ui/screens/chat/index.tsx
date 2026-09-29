import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, History, Mic, Sparkles, Square, SquarePen } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button, Chip, Spinner, cn } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { t } from '@/app/i18n'
import { useT } from '@/app/i18n/useT'
import { HistorySheet } from './HistorySheet'
import { dateKey, groupLabel } from '@/ui/screens/home/helpers'
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
    // id 部分支持「、/,/,」分隔的多 id 并列（如（见 id1、id2））：逐个 id 渲染成可点链接，
    // 非法 id 跳过（与单 id 现状一致——找不到条目不渲染、不显「已删除」）。
    const citeRegex = new RegExp('[（(]\\s*(?:见|see)\\s+([a-zA-Z0-9_-]+(?:\\s*[、,，]\\s*[a-zA-Z0-9_-]+)*)\\s*[）)]', 'gi')
    const citeNodes: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = citeRegex.exec(part)) !== null) {
      const [fullMatch, idList] = match
      const matchIndex = match.index
      citeNodes.push(part.slice(lastIndex, matchIndex))
      const ids = idList.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
      ids.forEach((id, j) => {
        if (isValidId(id)) {
          citeNodes.push(
            <button
              key={`cite-${i}-${matchIndex}-${j}`}
              type="button"
              onClick={() => navigate(`/detail/${id}`)}
              className="text-pri underline hover:text-pri/80 cursor-pointer"
            >
              {t('chat.seeCite', { label: getLabel(id) })}
            </button>,
          )
        }
      })
      lastIndex = match.index + fullMatch.length
    }
    citeNodes.push(part.slice(lastIndex))
    return <span key={i}>{citeNodes}</span>
  })
}

// D37: 思维链面板——理解问题→召回条目→组织回答的过程，默认折叠可展开。
// m12（2026-09-28 流式验收）：流式期间有 reasoning → 强制展开实时渲染推理过程；
// finalize（streaming=false）后回归用户手动控制（默认折叠）。
// 能力大补（2026-09-29）：意图类别标签（recall 不显示，保持现状）。
const KIND_TAG_KEYS = {
  weather: 'chat.trace.kind.weather',
  search: 'chat.trace.kind.search',
  action: 'chat.trace.kind.action',
} as const

function TracePanel({ trace, streaming }: { trace: ChatTrace; streaming?: boolean }) {
  const [open, setOpen] = useState(false)
  const shown = open || (!!streaming && !!trace.reasoning)
  const t = useT()
  const intent = trace.intent
  const recalled = trace.recalled ?? []
  // 无内容可展示时（无 intent/recalled/error/reasoning）不渲染。
  if (!intent && recalled.length === 0 && !trace.error && !trace.reasoning) return null

  const scopeType = intent?.scope
    ? intent.scope.type === 'day'
      ? t('chat.trace.scopeDay')
      : intent.scope.type === 'week'
        ? t('chat.trace.scopeWeek')
        : t('chat.trace.scopeMonth')
    : ''
  const kindTagKey = intent?.kind && intent.kind !== 'recall' ? KIND_TAG_KEYS[intent.kind] : undefined

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-t3 transition duration-base ease-out active:scale-[0.97]"
      >
        {shown ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t('chat.traceToggle')}</span>
      </button>
      {shown && (
        <div className="mt-1.5 rounded-card bg-page px-3 py-2 text-[11px] leading-relaxed text-t2 space-y-1.5">
          {intent && (
            <div>
              <p className="text-t3">
                {t('chat.trace.intent')}
                {kindTagKey && (
                  <span className="ml-1.5 rounded-chip bg-priS px-1.5 py-0.5 text-[10px] text-pri">{t(kindTagKey)}</span>
                )}
              </p>
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
              {/* 能力大补（2026-09-29）：weather 的城市 / action 的条目线索。 */}
              {intent.city && <p>{t('chat.trace.cityLabel')}{intent.city}</p>}
              {intent.actionHint && <p>{t('chat.trace.actionHintLabel')}{intent.actionHint}</p>}
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
          {/* 思考模型推理全文（2026-09-28 流式输出）：流式期间逐帧累积实时渲染，结束后保留可回看。 */}
          {trace.reasoning && (
            <div>
              <p className="text-t3">{t('chat.trace.reasoning')}</p>
              <p className="whitespace-pre-wrap">{trace.reasoning}</p>
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
// memo（2026-09-28 流式输出）：流式 flush 每帧只替换目标消息对象，其余气泡 msg 引用不变 →
// memo 引用比较命中跳过重渲；streaming 消息自身逐帧重渲（memo 不拦自身 props 变化）。
const AiBubble = memo(function AiBubble({ msg, fresh }: { msg: ChatMessage; fresh: boolean }) {
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
          {/* 流式打字光标：占位空内容期兜底可见（LoadingBubble 此时已隐藏），逐字期间贴末尾。 */}
          {msg.streaming && <span className="animate-pulse text-t3">▍</span>}
        </div>
        {msg.citedEntryIds && msg.citedEntryIds.length > 0 && (
          <CitationChips ids={msg.citedEntryIds} fresh={fresh} />
        )}
        {msg.trace && <TracePanel trace={msg.trace} streaming={msg.streaming} />}
      </div>
    </motion.div>
  )
})

const UserBubble = memo(function UserBubble({ msg, fresh }: { msg: ChatMessage; fresh: boolean }) {
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
})

const LOADING_KEYS = {
  intent: 'chat.loading.intent',
  recall: 'chat.loading.recall',
  answer: 'chat.loading.answer',
  // 能力大补（2026-09-29）：weather/search 意图的专属相位（store chatLoading 联合类型同步扩展）。
  weather: 'chat.loading.weather',
  search: 'chat.loading.search',
} as const

type ChatLoadingPhase = keyof typeof LOADING_KEYS

function LoadingBubble({ phase }: { phase: ChatLoadingPhase }) {
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

// 记忆确认回执（2026-09-10 陪伴化）：kind='memoryConfirm' 的系统消息渲染为居中安静胶囊——
// 视觉语义是「系统回执」（Sparkles + 主色浅底），不是伙伴在说一段话，与对话气泡分化。
function MemoryConfirmBubble({ msg, fresh }: { msg: ChatMessage; fresh: boolean }) {
  return (
    <motion.div
      className="flex justify-center"
      initial={fresh ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div className="flex max-w-[90%] items-center gap-1.5 rounded-chip bg-priS px-3 py-1.5 text-[12px] leading-relaxed text-pri">
        <Sparkles size={13} strokeWidth={2.2} className="shrink-0" />
        <span>{msg.content}</span>
      </div>
    </motion.div>
  )
}

// 跨天分隔条（2026-09-29 能力大补）：微信式日期界。系统分隔 ≠ 系统回执——中性灰调
// （不用 memoryConfirm 的 priS 主色浅底）。无入场动画（initial={false}），历史/新到都瞬显。
// key 以 'date-' 前缀（渲染处拼），不进 seenIds——分隔条不是消息，不参与 fresh 机制。
function DateSeparator({ label }: { label: string }) {
  return (
    <motion.div className="flex justify-center" initial={false} animate={{ opacity: 1 }}>
      <span data-testid="date-separator" className="rounded-chip bg-brd/50 px-3 py-1 text-[11px] leading-relaxed text-t3">
        {label}
      </span>
    </motion.div>
  )
}

// 改分类确认卡（2026-09-29 能力大补）：kind='actionConfirm'。AI 提议、用户点确认才执行——
// pending=单候选直接确认；ambiguous=多候选单选（未选不可确认）；done/cancelled/notFound=终态静态回执。
// 条目名可点跳详情（同 cite chip 先例）。
function ActionConfirmBubble({ msg, fresh }: { msg: ChatMessage; fresh: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  // 契约（Agent B 落地）：resolveCategoryAction(msgId, {entryId} | 'cancel')。
  const resolve = useUiStore((s) => s.resolveCategoryAction)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const action = msg.action
  if (!action) return null

  const interactive = (action.status === 'pending' || action.status === 'ambiguous') && !busy
  const confirm = (entryId: string) => {
    if (!interactive) return
    setBusy(true) // 防重复点击：store 落定后消息转终态，卡片自然失去按钮
    void resolve(msg.id, { entryId })
  }
  const cancel = () => {
    if (!interactive) return
    setBusy(true)
    void resolve(msg.id, 'cancel')
  }

  return (
    <motion.div
      className="flex justify-center"
      initial={fresh ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div className="w-full max-w-[85%] rounded-card border border-brd/80 bg-card px-3 py-2.5 text-[13px] leading-relaxed text-ink shadow-sm">
        {action.status === 'pending' && action.candidates[0] && (
          <div>
            <p>
              《
              <button
                type="button"
                onClick={() => navigate(`/detail/${action.candidates[0]!.entryId}`)}
                className="text-pri underline hover:text-pri/80 cursor-pointer"
              >
                {action.candidates[0].label}
              </button>
              》 {t('chat.action.changeTo')} 「{action.toCategoryLabel}」
              {action.isNewCategory ? `（${t('chat.action.newCategory')}）` : ''}
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" size="sm" className="h-8 flex-1" disabled={busy} onClick={cancel}>
                {t('chat.action.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="h-8 flex-1"
                disabled={busy}
                onClick={() => confirm(action.candidates[0]!.entryId)}
              >
                {t('chat.action.confirm')}
              </Button>
            </div>
          </div>
        )}
        {action.status === 'ambiguous' && (
          <div>
            <p>{t('chat.action.whichOne')}</p>
            <ul className="mt-1.5 space-y-1">
              {action.candidates.slice(0, 5).map((c) => (
                <li key={c.entryId}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.entryId)}
                    aria-pressed={selected === c.entryId}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-btn border px-2.5 py-1.5 text-left transition duration-base ease-out active:scale-[0.99]',
                      selected === c.entryId ? 'border-pri/60 bg-priS' : 'border-brd/80 bg-page',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-full border',
                        selected === c.entryId ? 'border-pri bg-pri' : 'border-t3',
                      )}
                    >
                      {selected === c.entryId && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="shrink-0 text-[11px] text-t3">{c.fromCategory}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" size="sm" className="h-8 flex-1" disabled={busy} onClick={cancel}>
                {t('chat.action.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="h-8 flex-1"
                disabled={busy || !selected}
                onClick={() => selected && confirm(selected)}
              >
                {t('chat.action.confirm')}
              </Button>
            </div>
          </div>
        )}
        {action.status === 'done' && (
          <p className="flex items-center gap-1.5 text-t2">
            <Check size={14} strokeWidth={2.5} className="shrink-0 text-catProject" />
            <span>
              《{action.candidates[0]?.label ?? action.entryHint}》 → 「{action.toCategoryLabel}」
            </span>
          </p>
        )}
        {action.status === 'cancelled' && <p className="text-t3">{t('chat.action.cancelled')}</p>}
        {action.status === 'notFound' && <p className="text-t3">{t('chat.action.notFound', { hint: action.entryHint })}</p>}
      </div>
    </motion.div>
  )
}

// 空态（2026-09-10 陪伴化）：伙伴式问候——时段问候语 + 一句「我记得你」+ 开场建议
// chips（点击填入输入框并聚焦，不直接发送，用户可改）。无插画无营销感，对话感优先。
function EmptyTalk({ onSuggest }: { onSuggest: (text: string) => void }) {
  const t = useT()
  const h = new Date().getHours()
  const greet =
    h < 5 || h >= 22 ? t('chat.greet.night') : h < 11 ? t('chat.greet.morning') : h < 18 ? t('chat.greet.afternoon') : t('chat.greet.evening')
  const suggestions = [t('chat.sug.chat'), t('chat.sug.review'), t('chat.sug.advice')]
  return (
    <div className="mt-14 flex flex-col items-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-b from-pri to-pri/90 shadow-glowPriSm">
        <Sparkles size={22} className="text-white" strokeWidth={1.8} />
      </div>
      <p className="mt-4 text-[17px] font-bold text-ink">{greet}，{t('chat.emptyTitle')}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-t2">{t('chat.emptyHint')}</p>
      <div className="mt-5 flex w-full max-w-[280px] flex-col gap-2">
        {suggestions.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggest(s)}
            className="animate-fade-in-up rounded-card border border-brd/80 bg-card px-3 py-2.5 text-[13px] text-ink shadow-sm transition duration-base ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            style={{ animationDelay: `${i * 60 + 100}ms` }}
          >
            {s}
          </button>
        ))}
      </div>
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
  const inputRef = useRef<HTMLTextAreaElement>(null) // 空态建议 chips 点击后聚焦
  // 入场动画的 fresh 判定：首个非空会话快照其全部消息 id 为「已见」——历史消息瞬显；
  // 之后到达的消息（id 不在快照）按 fresh 播入场动画。用户消息因会话创建即入快照，瞬显。
  const seenIds = useRef<Set<string> | null>(null)
  if (seenIds.current === null && conversation) {
    seenIds.current = new Set(conversation.messages.map((m) => m.id))
  }

  const messages = conversation?.messages ?? []
  const hasMessages = messages.length > 0
  const loading = chatLoading !== 'idle'
  const recording = chatVoice.recording
  // 流式中（2026-09-28）：存在 streaming 消息 → 隐藏 LoadingBubble（占位气泡 + 打字光标接管）。
  const hasStreamingMsg = messages.some((m) => m.streaming)
  // 流式增量总长（streaming 消息 content+reasoning）：flush 一次变一次，驱动自动滚动跟底。
  const streamLen = messages.reduce((n, m) => (m.streaming ? n + m.content.length + (m.trace?.reasoning?.length ?? 0) : n), 0)

  // m10（2026-09-28 流式验收）：贴底才跟——用户上翻阅读历史时，流式增量不再拽回底部。
  // 滚动事件实时维护贴底状态（阈值 60px）；submit 强制回贴底（自己发的消息必跟随）。
  const atBottomRef = useRef(true)
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  // 新消息 / loading 阶段变化 / 流式增量 → 贴底时滚到底。
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages.length, chatLoading, streamLen])

  // 卸载时若在录音 → 停 mic 释放（防 mic 灯长亮 + 适配器 singleton 残留，CapturePort 共享一个 recorder/stream）。
  useEffect(() => {
    return () => {
      if (useUiStore.getState().chatVoice.recording) void useUiStore.getState().stopChatVoice()
    }
  }, [])

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
    atBottomRef.current = true // m10: 发送自己的消息 → 强制回贴底跟随
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

      {/* 隐私披露：问题 + 召回片段上送 LLM 作答（仅检索，AI 不写数据）。
          relative z-10 bg-page：滚动时最上面一条气泡会被滚动容器顶边齐切，正好贴进本行
          92-109px 的字形带——无背景时两者像素级叠印（E2E 截图曾现文字相叠）。盖住即净。 */}
      <p className="relative z-10 shrink-0 bg-page px-4 pb-1.5 text-[11px] text-t3">{t('chat.privacy')}</p>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          {!hasMessages && !loading && (
            <EmptyTalk
              onSuggest={(s) => {
                setText(s)
                inputRef.current?.focus()
              }}
            />
          )}
          {(() => {
            // 跨天分隔条（2026-09-29）：消息日键与前条不同 → 先插 DateSeparator（首条也插）。
            // todayKey 用真实今日（非 home 的 entry 锚定变体）——对话是真实时间流。
            const todayKey = dateKey(new Date().toISOString())
            const nodes: React.ReactNode[] = []
            let prevDay: string | null = null
            for (const m of messages) {
              // 流式消息（2026-09-28）：创建即记 seen——占位气泡不播入场动画（流式逐字本身就是
              // 入场感，叠加 fade/行级渐显会每帧重播）；finalize 原位替换同 id 也不重播。
              if (m.streaming) seenIds.current?.add(m.id)
              const fresh = !seenIds.current?.has(m.id)
              const day = dateKey(m.createdAt)
              if (day !== prevDay) {
                nodes.push(<DateSeparator key={`date-${day}`} label={groupLabel(m.createdAt, todayKey)} />)
                prevDay = day
              }
              nodes.push(
                m.role === 'user' ? (
                  <UserBubble key={m.id} msg={m} fresh={fresh} />
                ) : m.kind === 'memoryConfirm' ? (
                  <MemoryConfirmBubble key={m.id} msg={m} fresh={fresh} />
                ) : m.kind === 'actionConfirm' ? (
                  <ActionConfirmBubble key={m.id} msg={m} fresh={fresh} />
                ) : (
                  <AiBubble key={m.id} msg={m} fresh={fresh} />
                ),
              )
            }
            return nodes
          })()}
          {/* Loading 阶段切换：crossfade 过渡（intent→recall→answer/weather/search 不硬切文案）。
              流式中隐藏——占位气泡 + 打字光标已接管「正在回答」的感知。 */}
          <AnimatePresence mode="wait" initial={false}>
            {loading && !hasStreamingMsg && (
              <motion.div
                key={chatLoading}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                {/* loading=true 已保证非 'idle'（loading=chatLoading!=='idle' 的别名窄化，
                    显式比较会撞 TS2367）——cast 到相位联合。 */}
                <LoadingBubble phase={chatLoading as ChatLoadingPhase} />
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
            ref={inputRef}
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
