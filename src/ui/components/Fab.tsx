import { useNavigate } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { useT } from '@/app/i18n/useT'

export function Fab() {
  const navigate = useNavigate()
  const t = useT()
  return (
    <button
      type="button"
      onClick={() => navigate('/capture')}
      aria-label={t('comp.fab.startCapture')}
      // D1: FAB 上移安全区高度，避免被系统导航栏遮挡。Android WebView 不支持 env()，
      // --safe-bottom 由 MainActivity 原生注入；PWA fallback 0 → 退化为 93px。
      style={{ bottom: 'calc(93px + var(--safe-bottom, 0px))' }}
      className="absolute right-5 z-30 flex h-14 w-14 items-center justify-center rounded-fab bg-gradient-to-b from-pri to-pri/85 text-card shadow-glowPri transition-all duration-base ease-out hover:brightness-[1.06] active:scale-90 active:shadow-glowPriSm"
    >
      <Mic size={26} strokeWidth={2.2} />
    </button>
  )
}
