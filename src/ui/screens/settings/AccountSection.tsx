import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { Button, Card } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'

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

export function AccountSection() {
  const navigate = useNavigate()
  const account = useAccountStore((s) => s.account)
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!account) return null

  const typeLabel = account.type === 'guest' ? '游客' : '网络'
  const planLabel =
    account.plan === 'guest' ? 'guest' : account.plan === 'free' ? 'free' : 'paid'

  return (
    <Card className="mt-3">
      <p className="text-[14px] font-bold text-ink">账号</p>
      <p className="mt-1 text-[11px] text-t3">身份与权益</p>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[13px] font-medium text-ink">{account.nickname}</span>
        <span className="rounded-chip bg-priS px-2 py-0.5 text-[11px] text-pri">
          {typeLabel}
        </span>
        <span className="text-[11px] text-t3">{planLabel}</span>
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
    </Card>
  )
}
