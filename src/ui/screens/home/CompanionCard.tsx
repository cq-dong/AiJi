// P-D 主动触达 · CompanionCard（spec §4）：home 顶部、问候语区之下。
// 一张卡两种形态（LLM 问候 / 模板兜底）——骨架一致，文本不同，组件不感知来源。
// bg-priS 底 + 圆形 pri 底白字头像 + 13px 一句文本 + 右侧 × 关闭；
// fade-in 入场（framer-motion），无自动消失；点卡片跳 /chat，× 只 dismiss 不跳。

import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/ui/components'
import { useT } from '@/app/i18n/useT'

interface CompanionCardProps {
  text: string
  onOpenChat: () => void
  onDismiss: () => void
}

export function CompanionCard({ text, onOpenChat, onDismiss }: CompanionCardProps) {
  const t = useT()
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      role="button"
      tabIndex={0}
      aria-label={t('home.companion.aria')}
      onClick={onOpenChat}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenChat()
        }
      }}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-card bg-priS px-3.5 py-3',
        'ring-1 ring-pri/10',
      )}
    >
      {/* 伙伴头像占位：圆形 pri 底白字（spec §4）。 */}
      <div
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pri shadow-glowPriSm"
      >
        <span className="text-[13px] font-medium text-white">{t('home.companion.avatar')}</span>
      </div>
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{text}</p>
      <button
        type="button"
        aria-label={t('home.companion.close')}
        onClick={(e) => {
          e.stopPropagation() // × 只 dismiss，不触发卡片跳 /chat
          onDismiss()
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-t3 transition-colors hover:bg-pri/10 hover:text-t2"
      >
        <X size={15} />
      </button>
    </motion.div>
  )
}
