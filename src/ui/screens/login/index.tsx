import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Spinner } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'
import { localizeError } from '@/app/i18n/errorText'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const navigate = useNavigate()
  const t = useT()
  const [nickname, setNickname] = useState('')
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onGuestStart = () => {
    useAccountStore.getState().registerGuest(nickname)
    navigate('/onboarding')
  }

  async function onNetworkSubmit() {
    setError(null)
    if (!EMAIL_RE.test(email)) { setError(t('login.errorEmail')); return }
    if (password.length < 8) { setError(t('login.errorPasswordShort')); return }
    if (mode === 'register' && password !== confirmPassword) { setError(t('login.errorPasswordMismatch')); return }
    setLoading(true)
    try {
      if (mode === 'register') await useAccountStore.getState().register(email, password)
      else await useAccountStore.getState().login(email, password)
      const onboarded = useUiStore.getState().settings.onboarded
      navigate(onboarded ? '/' : '/onboarding')
    } catch (e) {
      // startsWith('AUTH_409') 是控制流分支（翻到登录 tab），用原 e.message；
      // 其余展示层走 localizeError（AUTH_* 已有中英映射，未知码回落原文）。
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('AUTH_409')) { setError(t('login.errorAuth409Hint')); setMode('login') }
      else setError(localizeError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col px-4 pb-4 pt-6">
      {/* 品牌头 */}
      <div className="flex flex-col items-center pt-10 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-card bg-gradient-to-b from-priS to-priS/50 text-[44px] font-bold text-pri shadow-glowPriSm ring-1 ring-pri/10 animate-scale-in">
          {t('login.brandGlyph')}
        </div>
        <h1 className="mt-4 text-[28px] font-bold text-ink">AiJi</h1>
        <p className="mt-1 text-[13px] text-t3">{t('login.subtitle')}</p>
      </div>

      {/* 游客注册 */}
      <Card className="mt-5 shadow-card">
        <p className="text-[14px] font-bold text-ink">{t('login.guestTitle')}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-t3">{t('login.guestHint')}</p>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={t('login.nicknamePlaceholder')}
          aria-label={t('login.aria.nickname')}
          className="mt-3 h-11 w-full rounded-btn border border-brd/80 bg-card px-3 text-[13px] text-ink shadow-sm placeholder:text-t3 transition-all duration-base ease-out focus:border-pri/50 focus:shadow-glowPriSm focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/20 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        />
        <Button
          variant="primary"
          size="lg"
          className="mt-3 w-full"
          onClick={onGuestStart}
        >
          {t('login.guestCta')}
        </Button>
      </Card>

      {/* 网络账号（次要，视觉从属） */}
      <Card className="mt-3 shadow-card">
        <div className="grid grid-cols-2 gap-1 rounded-[12px] border border-brd/60 bg-page p-1 shadow-inner">
          <button type="button" onClick={() => { setMode('register'); setError(null) }}
            className={`rounded-[8px] py-2 text-[13px] font-medium transition-all duration-base ease-out ${mode === 'register' ? 'bg-card text-pri shadow-sm font-semibold' : 'text-t3 active:scale-95'}`}>{t('login.tabRegister')}</button>
          <button type="button" onClick={() => { setMode('login'); setError(null) }}
            className={`rounded-[8px] py-2 text-[13px] font-medium transition-all duration-base ease-out ${mode === 'login' ? 'bg-card text-pri shadow-sm font-semibold' : 'text-t3 active:scale-95'}`}>{t('login.tabLogin')}</button>
        </div>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('login.emailPlaceholder')}
          aria-label={t('login.aria.email')} aria-invalid={!!error}
          className="mt-3 h-11 w-full rounded-btn border border-brd/80 bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition-all focus:border-pri/50 focus:shadow-glowPriSm focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/20" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('login.passwordPlaceholder')}
          aria-label={t('login.aria.password')} aria-invalid={!!error}
          className="mt-2 h-11 w-full rounded-btn border border-brd/80 bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition-all focus:border-pri/50 focus:shadow-glowPriSm focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/20" />
        {mode === 'register' && (
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t('login.confirmPasswordPlaceholder')}
            aria-label={t('login.aria.confirmPassword')}
            className="mt-2 h-11 w-full rounded-btn border border-brd/80 bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition-all focus:border-pri/50 focus:shadow-glowPriSm focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/20" />
        )}
        {error && <p className="mt-2 rounded-btn bg-catFail/10 px-3 py-2 text-[12px] text-catFail animate-scale-in" role="alert">{error}</p>}
        <Button variant="primary" size="lg" className="mt-3 w-full" onClick={onNetworkSubmit} disabled={loading}>
          {loading ? <Spinner size={16} /> : mode === 'register' ? t('login.tabRegister') : t('login.tabLogin')}
        </Button>
      </Card>

      {/* 底部说明 */}
      <p className="mt-auto pt-8 text-center text-[11px] text-t3">{t('login.footerNote')}</p>

      {/* D12: 免责声明（双保险——AccountGate 强制先登录，首启首屏为 /login） */}
      <p className="mt-3 text-center text-[11px] leading-relaxed text-t3">{t('login.disclaimer')}</p>
    </div>
  )
}
