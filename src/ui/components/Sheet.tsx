import type { ReactNode } from 'react'
import { motion, useMotionValue, animate, useReducedMotion, type PanInfo } from 'framer-motion'
import { X } from 'lucide-react'
import { useT } from '@/app/i18n/useT'

// 底部 sheet：编辑 AI 面板 / 手动编辑 parts 共用。fixed 覆盖整视口（含 statusbar，
// iOS sheet 惯例），backdrop 点击 = 关闭 + 毛玻璃虚化背景。内容超高可滚。
// framer-motion：进场 spring 上滑、面板可下拉关闭（过阈值/快速下甩触发）、回弹。
// 保留可见 Close 按钮（NN/g bottom-sheet 红线）。退出动画未做——需调用方用
// AnimatePresence 包裹条件渲染，属后续 batch。
const DISMISS_Y = 90
const DISMISS_VELOCITY = 600

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const t = useT()
  const reduce = useReducedMotion()
  const y = useMotionValue(0)

  // 下拉超过阈值/快速下甩 → 先弹簧甩出屏外再回调关闭（避免卸载闪切）。
  // y 是 MotionValue<number>，出屏目标用整屏高（面板 max-h 88vh，必然推到底）。
  const dismiss = () => {
    if (reduce) return onClose()
    animate(y, window.innerHeight, { type: 'spring', stiffness: 420, damping: 40 }).then(onClose)
  }

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_Y || info.velocity.y > DISMISS_VELOCITY) dismiss()
    else animate(y, 0, reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 })
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <motion.button
        type="button"
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.18 }}
      />
      <motion.div
        className="relative flex max-h-[88vh] flex-col rounded-t-[32px] border-t border-white/10 bg-card pb-4 pt-2 shadow-sheet"
        style={{ y }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 38 }}
        drag="y"
        dragDirectionLock
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-t3/40" />
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-[17px] font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-1 flex size-11 items-center justify-center rounded-full bg-page text-t2 transition duration-base ease-out hover:bg-brd active:scale-[0.97] cursor-pointer focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-2">{children}</div>
        {footer && <div className="flex items-center gap-2 px-4 pt-1">{footer}</div>}
      </motion.div>
    </div>
  )
}
