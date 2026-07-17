import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, ChevronRight, User, X } from 'lucide-react'
import { Button, Card, Sheet, cn } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'
import { useUiStore } from '@/app/store'
import { useQuotaStore } from '@/app/quotaStore'
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

export function AccountSection() {
  const navigate = useNavigate()
  const account = useAccountStore((s) => s.account)
  const sessionStale = useAccountStore((s) => s.sessionStale)
  const settings = useUiStore((s) => s.settings)
  const quota = useQuotaStore((s) => s.quota)
  const [keySourceOpen, setKeySourceOpen] = useState(false)
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [nickOpen, setNickOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
      {nickOpen && (
        <NicknameSheet
          initial={account.nickname}
          onClose={() => setNickOpen(false)}
        />
      )}
    </Card>
  )
}
