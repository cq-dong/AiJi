import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, ShieldCheck, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { importSampleData } from '@/adapters/dexieStorage'
import { useT } from '@/app/i18n/useT'
import { detectLang } from '@/app/currentLang'
import { deviceOnboarded } from '@/app/onboardedFlag'
import { FeatureSlide } from './slides'

// Batch 9（2026-07-24）：营销轮播重做——原「欢迎+3 行特性」太单薄，用户看不懂 App 干嘛。
// 现 5 步：欢迎(定位+mini 特性) → 捕捉 → AI 整理 → 找回/提醒（各带产品 mock 插画）→
// 快速设置(BYOK+权限+示例数据合并)。步间方向感知滑切；「跳过」直达设置步（全部可选配置）。

const STEP_COUNT = 5
const STEP_SETUP = STEP_COUNT - 1

const stepVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -48 }),
}

export default function Onboarding() {
  const navigate = useNavigate()
  const t = useT()
  const lang = useUiStore((s) => s.settings.language) ?? detectLang()
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [apiKey, setApiKey] = useState('')
  const [permGranted, setPermGranted] = useState(false)
  const [permDenied, setPermDenied] = useState(false)
  // D9: 首启引导是否导入示例数据。导入后 rehydrate 让首页直接加载。
  const [sampleImported, setSampleImported] = useState(false)
  const [importing, setImporting] = useState(false)

  // 首启语言分段控件：点击即写 settings.language，store 同步 currentLang + useT 重渲。
  const setLang = (next: 'zh' | 'en') => useUiStore.getState().setSettings({ language: next })

  // 欢迎页 mini 特性（icon + 短语，随语言切换）。
  const MINI_FEATURES = [
    { icon: Mic, label: t('onboarding.feature.multimodal') },
    { icon: Sparkles, label: t('onboarding.feature.autocategorize') },
    { icon: ShieldCheck, label: t('onboarding.feature.localfirst') },
  ]

  const goTo = (next: number) => {
    if (next === step || next < 0 || next >= STEP_COUNT) return
    setDir(next > step ? 1 : -1)
    setStep(next)
  }

  // 请求麦克风+摄像头授权。只需拿到授权标记，不持有 stream：成功后立即释放 tracks。
  const requestPermission = async () => {
    setPermDenied(false)
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermGranted(false)
      setPermDenied(true)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      stream.getTracks().forEach((track) => track.stop())
      setPermGranted(true)
    } catch {
      setPermGranted(false)
      setPermDenied(true)
    }
  }

  // D9: 导入示例数据（12 条原型记录）。写入 Dexie 后标记已导入，onStart 时 rehydrate。
  const handleImportSample = async () => {
    if (sampleImported || importing) return
    setImporting(true)
    try {
      await importSampleData()
      setSampleImported(true)
    } catch (e) {
      console.error('[onboarding] importSampleData failed', e)
    } finally {
      setImporting(false)
    }
  }

  const onStart = async () => {
    // A2: 标记已 onboarding —— 之后再开不再重定向到这里（router OnboardingGate 据此放行）。
    // 双写：settings.onboarded（per-owner）+ 设备级 deviceOnboarded（防游客/新账号 rehydrate
    // 重置 per-owner 标志后重复弹引导）。
    useUiStore.getState().setSettings({ onboarded: true })
    deviceOnboarded.set()
    const key = apiKey.trim()
    if (key) {
      useUiStore.getState().setLlmConfig(
        'https://api.deepseek.com/v1/chat/completions',
        'deepseek-v4-flash',
        key,
      )
    }
    // D9: 若导入了示例数据，rehydrate 让首页加载刚写入的条目。
    if (sampleImported) {
      await useUiStore.getState().rehydrate()
    }
    navigate('/')
  }

  const isLast = step === STEP_SETUP

  return (
    <div className="flex min-h-full flex-col px-4 pb-4 pt-6">
      {/* 步内容：方向感知滑切（mode="wait" 先出后进，防两步重叠错位） */}
      <div className="flex-1">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="h-full"
          >
            {step === 0 && (
              <div className="flex h-full flex-col">
                {/* 首启语言选择控件 */}
                <div className="flex justify-center">
                  <div className="flex w-[176px] items-center rounded-chip bg-priS p-1" role="group">
                    <button
                      type="button"
                      onClick={() => setLang('zh')}
                      aria-pressed={lang === 'zh'}
                      className={`flex-1 rounded-chip py-1 text-center text-[12px] font-medium transition duration-base ease-out ${
                        lang === 'zh' ? 'bg-pri text-white shadow-sm' : 'text-t2'
                      }`}
                    >
                      {t('onboarding.lang.zh')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLang('en')}
                      aria-pressed={lang === 'en'}
                      className={`flex-1 rounded-chip py-1 text-center text-[12px] font-medium transition duration-base ease-out ${
                        lang === 'en' ? 'bg-pri text-white shadow-sm' : 'text-t2'
                      }`}
                    >
                      {t('onboarding.lang.en')}
                    </button>
                  </div>
                </div>

                {/* 品牌 + 定位 */}
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-screen bg-gradient-to-b from-priS to-priS/40 text-[52px] font-bold text-pri shadow-glowPriSm ring-1 ring-pri/10 animate-scale-in">
                    {t('onboarding.brandMark')}
                  </div>
                  <h1 className="mt-5 text-[32px] font-bold text-ink">AiJi</h1>
                  <p className="mt-1.5 text-[15px] font-medium text-ink">{t('onboarding.tagline')}</p>
                  <p className="mx-auto mt-2 max-w-[280px] text-[12px] leading-relaxed text-t3">
                    {t('onboarding.welcomeSub')}
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    {MINI_FEATURES.map((f, i) => (
                      <span
                        key={f.label}
                        className="flex items-center gap-1.5 rounded-chip border border-brd bg-card px-2.5 py-1.5 text-[11px] font-medium text-t2 shadow-card animate-fade-in-up"
                        style={{ animationDelay: `${200 + i * 90}ms` }}
                      >
                        <f.icon size={12} className="text-pri" />
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* D12: 免责声明（首屏可见） */}
                <p className="pb-2 text-center text-[10px] leading-relaxed text-t3">
                  {t('onboarding.disclaimer')}
                </p>
              </div>
            )}

            {step === 1 && (
              <FeatureSlide
                kind="capture"
                title={t('onboarding.slide.capture.title')}
                desc={t('onboarding.slide.capture.desc')}
              />
            )}
            {step === 2 && (
              <FeatureSlide
                kind="organize"
                title={t('onboarding.slide.organize.title')}
                desc={t('onboarding.slide.organize.desc')}
              />
            )}
            {step === 3 && (
              <FeatureSlide
                kind="recall"
                title={t('onboarding.slide.recall.title')}
                desc={t('onboarding.slide.recall.desc')}
              />
            )}

            {step === STEP_SETUP && (
              <div className="pt-6">
                {/* BYOK */}
                <label className="text-[11px] font-medium uppercase tracking-[0.06em] text-t3">
                  {t('onboarding.byok.label')}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('onboarding.byok.placeholder')}
                  className="mt-1 h-11 w-full cursor-text rounded-btn border border-brd/80 bg-card px-3 text-[13px] text-ink shadow-card placeholder:text-t3 transition-all duration-base ease-out focus:border-pri/50 focus:shadow-glowPriSm focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/20 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-t3">{t('onboarding.byok.hint')}</p>

                {/* permission */}
                <div className="mt-4 flex items-center justify-between rounded-card border border-brd/80 bg-card p-3 shadow-card">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{t('onboarding.permission.title')}</p>
                    <p className="mt-0.5 text-[11px] text-t3">{t('onboarding.permission.desc')}</p>
                    {permDenied && (
                      <p className="mt-1 text-[11px] leading-relaxed text-catFail">
                        {t('onboarding.permission.denied')}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={permGranted ? 'secondary' : 'primary'}
                    onClick={requestPermission}
                  >
                    {permGranted ? t('onboarding.permission.granted') : t('onboarding.permission.request')}
                  </Button>
                </div>

                {/* D9: 示例数据导入（可选） */}
                <div className="mt-3 flex items-center justify-between rounded-card border border-brd/80 bg-card p-3 shadow-card">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{t('onboarding.sample.title')}</p>
                    <p className="mt-0.5 text-[11px] text-t3">{t('onboarding.sample.desc')}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={sampleImported ? 'secondary' : 'primary'}
                    disabled={importing}
                    onClick={() => void handleImportSample()}
                  >
                    {importing
                      ? t('onboarding.sample.importing')
                      : sampleImported
                        ? t('onboarding.sample.imported')
                        : t('onboarding.sample.import')}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 底部：进度点 + 导航行 */}
      <div className="mt-auto pt-6">
        <div className="flex items-center justify-center gap-2 pb-4">
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={t('onboarding.aria.stepDot', { n: i + 1 })}
              aria-current={i === step ? 'step' : undefined}
              className={`h-2 cursor-pointer rounded-full transition-all duration-base ease-out ${
                i === step ? 'w-5 bg-pri' : 'w-2 bg-brd hover:bg-t3/40'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => goTo(step - 1)}
            className={step === 0 ? 'invisible' : ''}
          >
            {t('onboarding.step.back')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            onClick={() => (isLast ? void onStart() : goTo(step + 1))}
          >
            {isLast ? t('onboarding.start') : t('onboarding.step.next')}
          </Button>
        </div>
        {!isLast && (
          <button
            type="button"
            onClick={() => goTo(STEP_SETUP)}
            className="mt-3 w-full cursor-pointer py-1 text-center text-[12px] font-medium text-t3 transition duration-base ease-out hover:text-t2 active:scale-[0.98]"
          >
            {t('onboarding.step.skip')}
          </button>
        )}
      </div>
    </div>
  )
}
