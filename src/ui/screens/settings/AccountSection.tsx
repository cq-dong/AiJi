import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, ChevronRight, User, X } from 'lucide-react'
import { Button, Card, Sheet, cn } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'
import { useUiStore } from '@/app/store'
import { useQuotaStore } from '@/app/quotaStore'
import { PlansSheet } from './PlansSheet'
import { QuotaSheet } from './QuotaSheet'

// 头像压缩：FileReader 读为 data URL → Image → canvas 缩放至 256×256（contain）
// → toDataURL('image/jpeg', 0.85)。任一步失败回落原始 data URL（不阻断选图）。
async function compressAvatar(file: File): Promise<string> {
  const readAsDataUrl = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => reject(fr.error)
      fr.readAsDataURL(f)
    })

  const original = await readAsDataUrl(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = original
    })
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    // contain：保留比例，短边留白（透明，JPEG 编码会变黑——先填白底）。
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    const scale = Math.min(size / img.width, size / img.height)
    const w = img.width * scale
    const h = img.height * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return original
  }
}

// KeySource 切换 sheet：网络账号可选「内置 Key（免费额度）」或「自己的 Key」。
// setKeySource 内部有 guest 守卫（guest 选 builtin 时 no-op），但本 sheet 仅在网络账号下能打开，
// 故此处直调即可。Sheet 原语无 open prop，调用方条件渲染 → 内部 `if (!open) return null`。
function KeySourceSheet({
  open,
  onClose,
  current,
}: {
  open: boolean
  onClose: () => void
  current: 'byok' | 'builtin'
}) {
  const setKeySource = useUiStore((s) => s.setKeySource)
  if (!open) return null
  const options: { value: 'byok' | 'builtin'; label: string }[] = [
    { value: 'builtin', label: '内置 Key（免费额度）' },
    { value: 'byok', label: '自己的 Key' },
  ]
  return (
    <Sheet title="Key 来源" onClose={onClose}>
      <div className="space-y-2 py-2">
        {options.map((o) => {
          const active = o.value === current
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setKeySource(o.value)
                // D2: 切到 builtin 后立即刷新额度——否则 quota 行显「加载中…」直到重载。
                // hydrate 只在 boot 跑；session 内切换需显式 refresh。
                if (o.value === 'builtin') {
                  void useQuotaStore.getState().refresh()
                }
                onClose()
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-btn border px-4 py-3 text-left text-[13px] transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                active
                  ? 'border-pri bg-priS text-pri'
                  : 'border-brd bg-card text-ink',
              )}
            >
              <span>{o.label}</span>
              {active && <Check size={16} strokeWidth={2} className="text-pri" />}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

function NicknameSheet({
  initial,
  onClose,
}: {
  initial: string
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">修改昵称</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="mt-3 h-px bg-brd" />
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="昵称"
          aria-label="昵称"
          className="mt-3 h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/15 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        />
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[38px] flex-1 rounded-btn"
            onClick={() => {
              useAccountStore.getState().setNickname(value)
              onClose()
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

// 游客升级为网络账号：绑邮箱+密码，account.id 不变（单池）。
// bindNetwork 抛 'AUTH_<CODE>:<中文>'；AUTH_409 = 邮箱已注册。成功后 onClose + toast。
// Sheet 原语无 open prop，调用方条件渲染 → 内部 `if (!open) return null`（hooks 前置）。
function BindNetworkSheet({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const bindNetwork = useAccountStore((s) => s.bindNetwork)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  async function onSubmit() {
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('邮箱格式无效')
      return
    }
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (password !== confirm) {
      setError('两次密码不一致')
      return
    }
    setBusy(true)
    try {
      await bindNetwork(email, password)
      onSuccess()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.startsWith('AUTH_409') ? '该邮箱已注册' : msg.replace(/^AUTH_\d+:/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="升级为网络账号" onClose={onClose}>
      <div className="space-y-2 py-1">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱"
          aria-label="邮箱"
          className="h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/15 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（至少 8 位）"
          aria-label="密码"
          className="h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/15 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="确认密码"
          aria-label="确认密码"
          className="h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/15 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        />
        {error && <p className="text-[12px] text-catFail">{error}</p>}
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => void onSubmit()}
        >
          {busy ? '升级中…' : '升级'}
        </Button>
      </div>
    </Sheet>
  )
}

export function AccountSection() {
  const navigate = useNavigate()
  const account = useAccountStore((s) => s.account)
  const sessionStale = useAccountStore((s) => s.sessionStale)
  const settings = useUiStore((s) => s.settings)
  const quota = useQuotaStore((s) => s.quota)
  const [keySourceOpen, setKeySourceOpen] = useState(false)
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [nickOpen, setNickOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)
  const [bindOpen, setBindOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 本地瞬时 toast：2.5s 自动消失。AppShell 无 toast 系统，故局部实现。
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  if (!account) return null

  const typeLabel = account.type === 'guest' ? '游客' : '网络'
  const planLabel =
    account.plan === 'guest' ? '游客' : account.plan === 'free' ? '免费' : '付费'
  const initial = account.nickname.trim().charAt(0) || '我'

  // keySource 未定义（旧数据）按 byok 处理。游客下 builtin 由 setKeySource 守卫拦截，UI 也禁用。
  const keySource: 'byok' | 'builtin' = settings.keySource === 'builtin' ? 'builtin' : 'byok'
  const isGuest = account.type === 'guest'
  const keySourceLabel =
    keySource === 'builtin' ? '内置 Key（免费额度）' : '自己的 Key'
  const showQuotaRow = keySource === 'builtin'

  // 升级行：guest 隐藏（需先 bindNetwork，T15c）；free 显「升级付费」；paid 显到期日期。
  const showUpgradeRow = account.plan !== 'guest'
  const upgradeLabel =
    account.plan === 'paid'
      ? `当前：${account.paidPlanId === 'yearly' ? '年度会员' : '月度会员'}${
          account.paidExpiresAt
            ? ` 至 ${account.paidExpiresAt.slice(0, 10)}`
            : ''
        }`
      : '升级付费'

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    // 清空 value 允许重复选同一文件。
    e.target.value = ''
    if (!f) return
    try {
      const dataUrl = await compressAvatar(f)
      useAccountStore.getState().setAvatar(dataUrl)
    } catch {
      // 压缩 helper 内部已回落；此处兜底静默忽略。
    }
  }

  return (
    <Card className="mt-4">
      <div className="flex items-center gap-3">
        {/* 头像：64px 圆，可点换图。 */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="更换头像"
          className="relative size-16 shrink-0 overflow-hidden rounded-full bg-priS shadow-sm ring-2 ring-pri/10 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          {account.avatar ? (
            <img
              src={account.avatar}
              alt="头像"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[22px] font-bold text-pri">
              {initial}
            </span>
          )}
          {/* 相机角标。 */}
          <span className="absolute bottom-0 right-0 flex size-5 items-center justify-center rounded-full bg-pri/95 text-white shadow-sm ring-2 ring-card">
            <Camera size={11} strokeWidth={2.2} />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => void onPickFile(e)}
          className="hidden"
        />

        {/* 昵称 + 徽章：点昵称弹编辑 sheet。 */}
        <button
          type="button"
          onClick={() => setNickOpen(true)}
          className="flex-1 text-left transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card rounded-btn"
        >
          <p className="text-[17px] font-bold text-ink">{account.nickname}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-chip bg-priS px-2.5 py-1 text-[11px] font-medium text-pri">
              {typeLabel}
            </span>
            <span className="text-[11px] text-t3">{planLabel}</span>
          </div>
        </button>

        {/* User 图标作右侧可点击提示（亦触发昵称编辑），44pt 触达。 */}
        <button
          type="button"
          onClick={() => setNickOpen(true)}
          aria-label="编辑昵称"
          className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <User size={18} strokeWidth={2} />
        </button>
      </div>

      <div className="my-3 h-px bg-brd" />

      {/* keySource 行：显当前来源，点开 KeySourceSheet 二选一。游客 disabled + 副标题。 */}
      <button
        type="button"
        onClick={() => !isGuest && setKeySourceOpen(true)}
        disabled={isGuest}
        className={cn(
          'flex w-full items-center justify-between rounded-btn py-1 transition duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          isGuest
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer active:scale-[0.97]',
        )}
      >
        <span className="flex flex-col">
          <span className="text-[13px] text-ink">{keySourceLabel}</span>
          {isGuest && (
            <span className="mt-0.5 text-[11px] text-t3">需先升级为网络账号</span>
          )}
        </span>
        {!isGuest && <ChevronRight size={18} className="text-t2" />}
      </button>

      {/* 游客升级为网络账号行：仅 guest 显示。紧接 keySource（guest 下 disabled）形成自然引导。 */}
      {isGuest && (
        <button
          type="button"
          onClick={() => setBindOpen(true)}
          className={cn(
            'mt-1 flex w-full items-center justify-between rounded-btn py-1 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          )}
        >
          <span className="text-[13px] text-ink">升级为网络账号</span>
          <ChevronRight size={18} className="text-t2" />
        </button>
      )}

      {/* 额度行：仅 keySource=builtin 显示。sessionStale 时灰色 + 提示重新登录。 */}
      {showQuotaRow && (
        <button
          type="button"
          onClick={() => setQuotaOpen(true)}
          className={cn(
            'mt-1 flex w-full items-center justify-between rounded-btn py-1 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            sessionStale && 'opacity-50',
          )}
        >
          <span className="text-[13px] text-ink">
            {quota === null ? (
              '加载中…'
            ) : (
              <>
                今日 LLM {quota.llmUsed}/{quota.llmLimit < 0 ? '∞' : quota.llmLimit} 次，
                STT {quota.sttUsedSec}/{quota.sttLimitSec < 0 ? '∞' : quota.sttLimitSec} 秒
                {sessionStale && (
                  <span className="text-catPending">
                    {' '}· 登录状态可能已过期，重新登录
                  </span>
                )}
              </>
            )}
          </span>
          <ChevronRight size={18} className="text-t2" />
        </button>
      )}

      {showUpgradeRow && (
        <button
          type="button"
          onClick={() => setPlansOpen(true)}
          className={cn(
            'mt-1 flex w-full items-center justify-between rounded-btn py-1 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          )}
        >
          <span className="text-[13px] text-ink">{upgradeLabel}</span>
          <ChevronRight size={18} className="text-t2" />
        </button>
      )}

      {/* 退出登录：ghost 文字按钮，居中，更轻。 */}
      <button
        type="button"
        onClick={() => {
          useAccountStore.getState().logout()
          navigate('/login')
        }}
        className="mt-2 w-full text-center text-[13px] text-catFail transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card rounded-btn py-1"
      >
        退出登录
      </button>

      <KeySourceSheet
        open={keySourceOpen}
        onClose={() => setKeySourceOpen(false)}
        current={keySource}
      />
      <QuotaSheet open={quotaOpen} onClose={() => setQuotaOpen(false)} />
      <PlansSheet open={plansOpen} onClose={() => setPlansOpen(false)} />
      <BindNetworkSheet
        open={bindOpen}
        onClose={() => setBindOpen(false)}
        onSuccess={() => {
          setBindOpen(false)
          setToast('已升级为网络账号')
        }}
      />
      {nickOpen && (
        <NicknameSheet
          initial={account.nickname}
          onClose={() => setNickOpen(false)}
        />
      )}

      {/* 瞬时 toast：固定底部居中，2.5s 自动消失。 */}
      {toast && (
        <div
          className="pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-btn bg-ink/90 px-4 py-2 text-[13px] text-white shadow-sheet animate-fade-in"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </Card>
  )
}
