// 引导页营销插画：纯 CSS + framer-motion，无图片资源。
// 每页一个「产品 mock」小场景（捕捉 / 整理 / 找回），让首次用户直观看到 App 在做什么。
// 所有循环动效尊重 useReducedMotion（降级为静态）。
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Bell, Camera, Keyboard, Mic, Search, Sparkles } from 'lucide-react'
import { useT } from '@/app/i18n/useT'

// 浮动小图标 chip（上下轻浮动；reduce 时静止）
function FloatChip({
  className,
  delay = 0,
  children,
}: {
  className: string
  delay?: number
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      animate={reduce ? undefined : { y: [0, -6, 0] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay }}
      className={`absolute flex h-11 w-11 items-center justify-center rounded-card border border-brd bg-card text-pri shadow-card ${className}`}
    >
      {children}
    </motion.div>
  )
}

// 捕捉页：录音卡（声波动画 → 转文字）+ 浮动相机/键盘
function CaptureIllustration() {
  const t = useT()
  const reduce = useReducedMotion()
  const bars = [10, 18, 26, 16, 30, 22, 12, 24, 16, 28, 14, 20]
  return (
    <div className="relative mx-auto w-full max-w-[300px] px-4 py-5">
      <div className="rounded-card border border-brd bg-card p-3.5 shadow-card">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pri text-white shadow-glowPriSm">
            <Mic size={17} />
          </span>
          <div className="flex h-9 flex-1 items-center gap-[3px]" aria-hidden>
            {bars.map((h, i) => (
              <motion.span
                key={i}
                className="w-[3px] rounded-full bg-pri/70"
                style={{ height: h }}
                animate={reduce ? undefined : { scaleY: [0.45, 1, 0.45] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.09 }}
              />
            ))}
          </div>
        </div>
        <div className="mt-3 space-y-1.5" aria-hidden>
          <div className="h-2 w-4/5 rounded-full bg-brd/80" />
          <div className="h-2 w-3/5 rounded-full bg-brd/60" />
        </div>
        <p className="mt-2.5 flex items-center gap-1 text-[10px] font-medium text-pri">
          <Sparkles size={11} />
          {t('onboarding.mock.transcribing')}
        </p>
      </div>
      <FloatChip className="-right-1 -top-2" delay={0.3}>
        <Camera size={18} />
      </FloatChip>
      <FloatChip className="-left-1 bottom-3" delay={1.1}>
        <Keyboard size={18} />
      </FloatChip>
    </div>
  )
}

// 整理页：条目卡 → AI 打分类/标签/摘要（stagger 弹出）
function OrganizeIllustration() {
  const t = useT()
  const pop = (i: number) => ({
    initial: { opacity: 0, scale: 0.8, y: 6 },
    animate: { opacity: 1, scale: 1, y: 0 },
    transition: { delay: 0.35 + i * 0.16, duration: 0.3, ease: 'easeOut' as const },
  })
  return (
    <div className="mx-auto w-full max-w-[300px] px-4 py-5">
      <div className="rounded-card border border-brd bg-card p-3.5 shadow-card">
        <div className="space-y-1.5" aria-hidden>
          <div className="h-2 w-3/4 rounded-full bg-brd/80" />
          <div className="h-2 w-full rounded-full bg-brd/60" />
          <div className="h-2 w-2/5 rounded-full bg-brd/60" />
        </div>
        <div className="mt-3 flex items-center gap-1.5 border-t border-brd/60 pt-2.5">
          <Sparkles size={12} className="shrink-0 text-pri" />
          <motion.span
            {...pop(0)}
            className="rounded-chip bg-priS px-2 py-1 text-[10px] font-medium text-pri"
          >
            {t('onboarding.mock.catIdea')}
          </motion.span>
          <motion.span
            {...pop(1)}
            className="rounded-chip bg-[#0d9488]/10 px-2 py-1 text-[10px] font-medium text-[#0d9488]"
          >
            {t('onboarding.mock.catProject')}
          </motion.span>
          <motion.span {...pop(2)} className="rounded-chip bg-page px-2 py-1 text-[10px] text-t3">
            {t('onboarding.mock.tags')}
          </motion.span>
        </div>
      </div>
      <motion.div
        {...pop(3)}
        className="mt-2.5 flex items-center gap-2 rounded-card border border-pri/15 bg-priS/60 px-3 py-2.5"
      >
        <Sparkles size={13} className="shrink-0 text-pri" />
        <div className="flex-1">
          <p className="text-[10px] font-medium text-pri">{t('onboarding.mock.summary')}</p>
          <div className="mt-1 h-1.5 w-4/5 rounded-full bg-pri/20" aria-hidden />
        </div>
      </motion.div>
    </div>
  )
}

// 找回页：搜索框 + 命中结果 + 提醒卡（bell 轻摆）
function RecallIllustration() {
  const t = useT()
  const reduce = useReducedMotion()
  return (
    <div className="mx-auto w-full max-w-[300px] px-4 py-5">
      <div className="flex h-10 items-center gap-2 rounded-btn border border-brd bg-card px-3 shadow-card">
        <Search size={14} className="shrink-0 text-t3" />
        <span className="text-[12px] text-t3">{t('onboarding.mock.searchPh')}</span>
        <motion.span
          aria-hidden
          className="ml-auto h-3.5 w-[1.5px] bg-pri"
          animate={reduce ? undefined : { opacity: [1, 0, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.3, ease: 'easeOut' }}
        className="mt-2.5 rounded-card border border-brd bg-card p-3 shadow-card"
      >
        <div className="space-y-1.5" aria-hidden>
          <div className="h-2 w-5/6 rounded-full bg-brd/80" />
          <div className="h-2 w-1/2 rounded-full bg-brd/60" />
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.3, ease: 'easeOut' }}
        className="mt-2.5 flex items-center gap-2 rounded-card border border-brd bg-card p-3 shadow-card"
      >
        <motion.span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-catPending/10 text-catPending"
          animate={reduce ? undefined : { rotate: [0, -12, 10, -6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.2, ease: 'easeInOut' }}
        >
          <Bell size={13} />
        </motion.span>
        <span className="flex-1 text-[12px] font-medium text-ink">{t('onboarding.mock.todo')}</span>
        <span className="rounded-chip bg-catPending/10 px-2 py-1 text-[10px] font-medium text-catPending">
          {t('onboarding.mock.reminderSet')}
        </span>
      </motion.div>
    </div>
  )
}

// 营销页统一布局：插画 + 标题 + 描述
export function FeatureSlide({
  kind,
  title,
  desc,
}: {
  kind: 'capture' | 'organize' | 'recall'
  title: string
  desc: string
}) {
  return (
    <div className="flex h-full flex-col justify-center pb-6">
      {kind === 'capture' && <CaptureIllustration />}
      {kind === 'organize' && <OrganizeIllustration />}
      {kind === 'recall' && <RecallIllustration />}
      <h2 className="mt-2 text-center text-[24px] font-bold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-[300px] text-center text-[13px] leading-relaxed text-t2">
        {desc}
      </p>
    </div>
  )
}
