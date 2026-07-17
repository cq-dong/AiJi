import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, User, X } from 'lucide-react'
import { Button, Card } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'

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

function NetworkSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-screen bg-page p-4 shadow-sheet animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-bold text-ink">切换网络账号</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-11 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-t2">
          网络账号功能暂未开通，敬请期待
        </p>
        <Button
          variant="primary"
          size="sm"
          className="mt-4 h-[38px] w-full rounded-btn"
          onClick={onClose}
        >
          知道了
        </Button>
      </div>
    </div>
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in"
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
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="昵称"
          aria-label="昵称"
          className="mt-3 w-full rounded-btn border border-brd bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pri"
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
  const [sheetOpen, setSheetOpen] = useState(false)
  const [nickOpen, setNickOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!account) return null

  const typeLabel = account.type === 'guest' ? '游客' : '网络'
  const planLabel =
    account.plan === 'guest' ? '游客' : account.plan === 'free' ? '免费' : '付费'
  const initial = account.nickname.trim().charAt(0) || '我'

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
    <Card className="mt-3">
      <div className="flex items-center gap-3">
        {/* 头像：64px 圆，可点换图。 */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="更换头像"
          className="relative size-16 shrink-0 overflow-hidden rounded-full bg-priS transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
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
          <span className="absolute bottom-0 right-0 flex size-6 items-center justify-center rounded-full bg-pri text-white shadow-sm">
            <Camera size={12} strokeWidth={2.2} />
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
          <p className="text-[16px] font-bold text-ink">{account.nickname}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-chip bg-priS px-2 py-0.5 text-[11px] text-pri">
              {typeLabel}
            </span>
            <span className="text-[11px] text-t3">{planLabel}</span>
          </div>
        </button>

        {/* User 图标作右侧可点击提示（亦触发昵称编辑）。 */}
        <button
          type="button"
          onClick={() => setNickOpen(true)}
          aria-label="编辑昵称"
          className="flex size-9 items-center justify-center text-t3 transition duration-base ease-out cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <User size={18} strokeWidth={2} />
        </button>
      </div>

      <Button
        variant="secondary"
        size="sm"
        className="mt-3 w-full"
        onClick={() => setSheetOpen(true)}
      >
        切换网络账号
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="mt-2 w-full text-catFail"
        onClick={() => {
          useAccountStore.getState().logout()
          navigate('/login')
        }}
      >
        退出登录
      </Button>

      {sheetOpen && <NetworkSheet onClose={() => setSheetOpen(false)} />}
      {nickOpen && (
        <NicknameSheet
          initial={account.nickname}
          onClose={() => setNickOpen(false)}
        />
      )}
    </Card>
  )
}
