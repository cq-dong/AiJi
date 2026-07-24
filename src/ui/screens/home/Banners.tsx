// 首页顶部瞬态横幅：刚保存 toast / 处理失败 / 离线 / 刷新中
// 对应 Figma 38:60 / 38:184 / 38:247 / 38:123-125

import { useState } from 'react'
import { motion, useMotionValueEvent, useTransform, type MotionValue } from 'framer-motion'
import { Check, WifiOff } from 'lucide-react'
import { useT } from '@/app/i18n/useT'

export function JustSavedToast() {
  const t = useT()
  return (
    <div className="flex h-[46px] items-center justify-between rounded-btn border border-pri/25 bg-priS/90 px-4 shadow-glowPriSm backdrop-blur-sm animate-scale-in">
      <span className="flex items-center gap-2 text-[13px] font-medium text-pri">
        <span className="flex size-5 items-center justify-center rounded-full bg-pri text-white">
          <Check size={12} strokeWidth={3} />
        </span>
        {t('home.banner.saved')}
      </span>
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-[6px] animate-pulse rounded-full bg-pri"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </span>
    </div>
  )
}

export function FailBanner({ onRetry }: { onRetry?: () => void }) {
  const t = useT()
  return (
    <div className="flex h-[56px] items-center rounded-btn border border-catFail/25 bg-catFail/10 pl-4 pr-2 shadow-sm animate-scale-in">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-catFail">{t('home.banner.fail.title')}</p>
        <p className="text-[11px] text-t3">{t('home.banner.fail.subtitle')}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="h-[30px] w-[88px] shrink-0 rounded-[8px] bg-catFail text-[12px] font-medium text-card shadow-sm transition duration-base ease-out hover:brightness-105 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        {t('common.retry')}
      </button>
    </div>
  )
}

export function OfflineBanner() {
  const t = useT()
  return (
    <div className="flex h-[40px] items-center rounded-btn border border-brd/80 bg-brd/70 pl-4 backdrop-blur-sm animate-scale-in">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-t2">
        <WifiOff size={13} strokeWidth={2} />
        {t('home.banner.offline')}
      </span>
    </div>
  )
}

export function RefreshIndicator() {
  const t = useT()
  return (
    <div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-brd">
        <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-pri/60 to-pri animate-indeterminate" />
      </div>
      <p className="mt-1 text-center text-[11px] font-medium text-pri">{t('home.banner.refresh')}</p>
    </div>
  )
}

// ── Batch 8（调研 #19）：下拉进度环——弧长随手势 pull 生长、箭头越阈翻转、
// refreshing 整环旋转。文案三态：下拉刷新 / 松开刷新 / 刷新中。 ──
const PTR_THRESHOLD = 64 // 与 usePullToRefresh.THRESHOLD 同步
const RING_R = 9
const RING_C = 2 * Math.PI * RING_R

export function PullIndicator({ pull, refreshing }: { pull: MotionValue<number>; refreshing: boolean }) {
  const t = useT()
  // 环弧进度 0→1（越阈钳满）；箭头 0→180° 随拉距渐变翻转（iOS 式「松手即刷」预告）。
  const progress = useTransform(pull, [0, PTR_THRESHOLD], [0, 1], { clamp: true })
  const dashOffset = useTransform(progress, (p) => RING_C * (1 - p))
  const arrowRotate = useTransform(progress, (p) => p * 180)
  const [over, setOver] = useState(false)
  useMotionValueEvent(pull, 'change', (v) => setOver(v >= PTR_THRESHOLD))

  return (
    <div className="flex flex-col items-center gap-1">
      <motion.svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        aria-hidden
        animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
        transition={refreshing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : { duration: 0.15 }}
      >
        <circle cx="12" cy="12" r={RING_R} fill="none" className="stroke-brd" strokeWidth="2.5" />
        <motion.circle
          cx="12"
          cy="12"
          r={RING_R}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={over || refreshing ? 'stroke-pri' : 'stroke-pri/60'}
          strokeDasharray={RING_C}
          style={{ strokeDashoffset: dashOffset, rotate: -90, transformOrigin: 'center' }}
        />
        <motion.path
          d="M12 7.5v6M9.2 10.7 12 13.5l2.8-2.8"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={over || refreshing ? 'stroke-pri' : 'stroke-t3'}
          style={{ rotate: arrowRotate, transformOrigin: 'center' }}
        />
      </motion.svg>
      <p className={`text-[11px] font-medium ${over || refreshing ? 'text-pri' : 'text-t3'}`}>
        {refreshing ? t('home.banner.refresh') : over ? t('home.ptr.release') : t('home.ptr.pull')}
      </p>
    </div>
  )
}
