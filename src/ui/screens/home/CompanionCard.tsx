// P-D 主动触达 · CompanionCard（spec §4）：home 顶部、问候语区之下。
// 一张卡两种形态（LLM 问候 / 模板兜底）——骨架一致，文本不同，组件不感知来源。
// bg-priS 底 + 圆形 pri 底白字头像 + 13px 一句文本 + 右侧 × 关闭；
// fade-in 入场（framer-motion），无自动消失；点卡片跳 /chat，× 只 dismiss 不跳。
// P-F 周回顾（2026-10-04）：weekly prop 存在时整卡切「上周回顾」变体——
// 日历图标 + 标题 + 摘要 line-clamp-2 截断 + CTA 行；点卡体 onOpen（调用方跳 /summary
// 并写 seen key），× onDismiss（stopPropagation 不冒泡到 onOpen）。
// 壳/动效与问候形态完全一致，不新增组件文件；weekly 缺席时问候路径像素级不变。

import { motion } from 'framer-motion'
import { CalendarRange, X } from 'lucide-react'
import { cn } from '@/ui/components'
import { useT } from '@/app/i18n/useT'

// P-F 周回顾变体契约（pf-store home/index.tsx 调用方管 seen key + 跳转）：
// range=上周 range key（如 '2026-W40'，仅透传标识用，组件不消费）；
// summary=周摘要全文（本组件 CSS line-clamp-2 截断展示）。
interface WeeklyReview {
  range: string
  summary: string
  onOpen: () => void
  onDismiss: () => void
}

interface CompanionCardProps {
  text: string
  onOpenChat: () => void
  onDismiss: () => void
  weekly?: WeeklyReview
}

export function CompanionCard({ text, onOpenChat, onDismiss, weekly }: CompanionCardProps) {
  const t = useT()
  // 变体分派：weekly 在 → 周回顾（onOpen/onDismiss 走 weekly 回调）；不在 → 问候（现状不变）。
  const handleOpen = weekly ? weekly.onOpen : onOpenChat
  const handleDismiss = weekly ? weekly.onDismiss : onDismiss
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      role="button"
      tabIndex={0}
      aria-label={weekly ? t('home.weeklyReview.title') : t('home.companion.aria')}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleOpen()
        }
      }}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-card bg-priS px-3.5 py-3',
        'ring-1 ring-pri/10',
      )}
    >
      {weekly ? (
        // 周回顾：日历图标占位（沿用问候头像的圆形 pri 底白字壳）。
        <div
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pri shadow-glowPriSm"
        >
          <CalendarRange size={16} strokeWidth={2.2} className="text-white" />
        </div>
      ) : (
        /* 伙伴头像占位：圆形 pri 底白字（spec §4）。 */
        <div
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pri shadow-glowPriSm"
        >
          <span className="text-[13px] font-medium text-white">{t('home.companion.avatar')}</span>
        </div>
      )}
      {weekly ? (
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{t('home.weeklyReview.title')}</p>
          <p className="line-clamp-2 text-[13px] leading-snug text-t2">{weekly.summary}</p>
          <p className="mt-0.5 text-[11px] text-pri">{t('home.weeklyReview.cta')}</p>
        </div>
      ) : (
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{text}</p>
      )}
      <button
        type="button"
        aria-label={weekly ? t('common.close') : t('home.companion.close')}
        onClick={(e) => {
          e.stopPropagation() // × 只 dismiss，不触发卡片跳转（/chat 或 /summary）
          handleDismiss()
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-t3 transition-colors hover:bg-pri/10 hover:text-t2"
      >
        <X size={15} />
      </button>
    </motion.div>
  )
}
