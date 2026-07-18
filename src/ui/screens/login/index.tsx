import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card } from '@/ui/components'
import { useAccountStore } from '@/app/accountStore'

export default function Login() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState('')
  const [networkNotice, setNetworkNotice] = useState(false)

  const onGuestStart = () => {
    useAccountStore.getState().registerGuest(nickname)
    navigate('/onboarding')
  }

  return (
    <div className="flex min-h-full flex-col px-4 pb-4 pt-6">
      {/* 品牌头 */}
      <div className="flex flex-col items-center pt-10 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-card bg-priS text-[44px] font-bold text-pri shadow-sm ring-1 ring-pri/10">
          记
        </div>
        <h1 className="mt-4 text-[28px] font-bold text-ink">AiJi</h1>
        <p className="mt-1 text-[13px] text-t3">
          随手记，AI 帮你整理，数据留在本地
        </p>
      </div>

      {/* 游客注册 */}
      <Card className="mt-5">
        <p className="text-[14px] font-bold text-ink">游客注册</p>
        <p className="mt-1 text-[11px] leading-relaxed text-t3">
          无需登录，数据存本地；后续可在设置里自配 Key 或升级网络账号
        </p>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="昵称（可空）"
          aria-label="昵称"
          className="mt-3 h-11 w-full rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/15 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        />
        <Button
          variant="primary"
          size="lg"
          className="mt-3 w-full"
          onClick={onGuestStart}
        >
          开始记
        </Button>
      </Card>

      {/* 网络注册（次要，视觉从属） */}
      <Card className="mt-3 opacity-90">
        <p className="text-[14px] font-bold text-ink">网络账号</p>
        <p className="mt-1 text-[11px] leading-relaxed text-t3">
          注册网络账号可享内置 Key 额度与云备份（远期）
        </p>
        <Button
          variant="secondary"
          className="mt-3 w-full active:scale-[0.97]"
          onClick={() => setNetworkNotice(true)}
        >
          网络账号注册 / 登录
        </Button>
        {networkNotice && (
          <p className="mt-2 text-[12px] leading-relaxed text-t3">
            网络账号功能暂未开通，敬请期待
          </p>
        )}
      </Card>

      {/* 底部说明 */}
      <p className="mt-auto pt-8 text-center text-[11px] text-t3">
        数据始终本地优先；账号只是身份与权益凭证
      </p>

      {/* D12: 免责声明（双保险——AccountGate 强制先登录，首启首屏为 /login） */}
      <p className="mt-3 text-center text-[11px] leading-relaxed text-t3">
        AiJi · AI 记 — 开源址 github.com/cq-dong/AiJi · 仅供学习交流 · AI
        生成内容（分类/摘要/问答）可能不准确，重要决策请自行核实 · 使用本应用视为接受此声明
      </p>
    </div>
  )
}
