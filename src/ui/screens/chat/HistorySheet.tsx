import { useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { Sheet } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { t } from '@/app/i18n'
import { useT } from '@/app/i18n/useT'
import type { Conversation } from '@/domain/types'

// 历史会话 sheet：chatList 按 updatedAt 倒序列出。标题=首条 user 消息前 24 字
// （无则 chat.untitled）；副行=相对时间 + 消息数；点项→loadConversation+关 sheet；
// 当前会话项 bg-priS 高亮；Trash2 删除带 confirm。空态 chat.historyEmpty。
// helpers 走模块 t()，组件 useT() 订阅重渲（与 chat/index.tsx 的 citeLabel 同构）。
// AnimatePresence 常驻 + open 条件渲染 → Sheet 退出动画（下滑淡出）完成后才卸载。

function conversationTitle(conv: Conversation): string {
  const firstUser = conv.messages.find((m) => m.role === 'user')
  const text = (firstUser?.content ?? '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 24) || t('chat.untitled')
}

// 相对时间桶：<1min 刚刚 · <60min 分钟前 · <24h 小时前 · <7d 天前 · 其余本地日期
// （对齐 detail/helpers.ts:relativeTime 的桶分）。{n} 插值对齐 drafts.ago.* pattern。
function ago(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return t('chat.ago.justNow')
  if (min < 60) return t('chat.ago.minutes', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('chat.ago.hours', { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return t('chat.ago.days', { n: day })
  return d.toLocaleDateString()
}

export function HistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const chatList = useUiStore((s) => s.chatList)
  const conversation = useUiStore((s) => s.conversation)
  const loadConversation = useUiStore((s) => s.loadConversation)
  const deleteChatConversation = useUiStore((s) => s.deleteChatConversation)
  const refreshChatList = useUiStore((s) => s.refreshChatList)

  // 打开时若 chatList 为空兜底刷新一次（hydrate 通常已载，此为失忆兜底）。
  // 读 getState 避免 chatList.length 入依赖致空列表下循环刷新。
  useEffect(() => {
    if (!open) return
    if (useUiStore.getState().chatList.length === 0) void refreshChatList()
  }, [open, refreshChatList])

  const currentId = conversation?.id

  async function onSelect(id: string) {
    await loadConversation(id)
    onClose()
  }

  function onDelete(id: string) {
    if (window.confirm(t('chat.deleteConfirm'))) void deleteChatConversation(id)
  }

  return (
    <AnimatePresence>
      {open && (
        <Sheet title={t('chat.history')} onClose={onClose}>
          {chatList.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-t3">{t('chat.historyEmpty')}</div>
          ) : (
            <div className="space-y-2 py-1">
              {chatList.map((conv) => {
                const isCurrent = conv.id === currentId
                return (
                  <div
                    key={conv.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void onSelect(conv.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void onSelect(conv.id)
                      }
                    }}
                    className={`flex cursor-pointer items-center gap-3 rounded-card border border-brd/80 p-3 transition duration-base ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-pri/40 ${
                      isCurrent ? 'bg-priS' : 'bg-card hover:bg-page'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-ink">{conversationTitle(conv)}</p>
                      <p className="mt-0.5 truncate text-[12px] text-t3">
                        {ago(conv.updatedAt)} · {t('chat.msgCount', { count: conv.messages.length })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(conv.id)
                      }}
                      aria-label={t('chat.aria.delete')}
                      className="flex size-9 shrink-0 items-center justify-center rounded-btn text-t3 transition duration-base ease-out hover:bg-page hover:text-catFail active:scale-[0.95] focus-visible:ring-2 focus-visible:ring-pri/40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Sheet>
      )}
    </AnimatePresence>
  )
}
