import { useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from './cn'

// D10: 全局轻量 toast——3.5s 后自动消失。成功(ink)/失败(catFail)用颜色区分。
// 三份重复（settings/detail/CategoryDetail）收编于此；调用方包 <AnimatePresence>
// 获得退出动画（下滑淡出，reduce 时瞬隐）。入场保持原 animate-slide-up 观感。
export function Toast({ message, ok, onDismiss }: { message: string; ok: boolean; onDismiss: () => void }) {
  const reduce = useReducedMotion()
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 8, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 pointer-events-none"
    >
      <div
        className={cn(
          'pointer-events-auto max-w-[360px] rounded-btn px-4 py-2.5 text-[12px] font-medium shadow-sheet',
          ok ? 'bg-ink text-card' : 'bg-catFail text-card',
        )}
        role="status"
      >
        {message}
      </div>
    </motion.div>
  )
}
