import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { importSampleData } from '@/adapters/dexieStorage'

const FEATURES = ['多模态随手记', 'AI 自动涌现分类', '本地优先 + BYOK']

export default function Onboarding() {
  const navigate = useNavigate()
  const [apiKey, setApiKey] = useState('')
  const [permGranted, setPermGranted] = useState(false)
  const [permDenied, setPermDenied] = useState(false)
  // D9: 首启引导是否导入示例数据。导入后 rehydrate 让首页直接加载。
  const [sampleImported, setSampleImported] = useState(false)
  const [importing, setImporting] = useState(false)

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
      stream.getTracks().forEach((t) => t.stop())
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
    useUiStore.getState().setSettings({ onboarded: true })
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

  return (
    <div className="flex min-h-full flex-col px-4 pb-4 pt-6">
      {/* welcome */}
      <div className="flex flex-col items-center pt-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-card bg-priS text-[44px] font-bold text-pri">
          记
        </div>
        <h1 className="mt-4 text-[28px] font-bold text-ink">AiJi</h1>
        <p className="mt-1 text-[13px] text-t2">
          随手记，AI 帮你整理，数据留在本地
        </p>
        <ul className="mt-4 space-y-1 text-[12px] text-t3">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-1.5">
              <Check size={12} strokeWidth={2} className="text-pri" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* BYOK */}
      <div className="mt-6">
        <label className="text-[11px] font-medium text-t3">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="粘贴你的 DeepSeek / OpenAI API Key"
          className="mt-1 h-11 w-full cursor-text rounded-btn border border-brd bg-card px-3 text-[13px] text-ink placeholder:text-t3 transition duration-base ease-out focus:border-pri/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-t3">
          没有 key 也能记，AI 功能会降级；采集和存储照常可用。
        </p>
      </div>

      {/* permission */}
      <div className="mt-4 flex items-center justify-between rounded-card border border-brd bg-card p-3">
        <div>
          <p className="text-[13px] font-medium text-ink">允许麦克风与摄像头</p>
          <p className="mt-0.5 text-[11px] text-t3">采集语音/视频需要授权</p>
          {permDenied && (
            <p className="mt-1 text-[11px] leading-relaxed text-catFail">
              未授权，采集功能将受限。可在浏览器设置中重新授权。
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant={permGranted ? 'secondary' : 'primary'}
          onClick={requestPermission}
        >
          {permGranted ? '已授权' : '请求权限'}
        </Button>
      </div>

      {/* D9: 示例数据导入（可选）——首启空库，用户可在此导入 12 条原型记录了解 App。 */}
      <div className="mt-4 flex items-center justify-between rounded-card border border-brd bg-card p-3">
        <div>
          <p className="text-[13px] font-medium text-ink">导入示例数据</p>
          <p className="mt-0.5 text-[11px] text-t3">12 条原型记录帮你快速了解 App</p>
        </div>
        <Button
          size="sm"
          variant={sampleImported ? 'secondary' : 'primary'}
          disabled={importing}
          onClick={() => void handleImportSample()}
        >
          {importing ? '导入中…' : sampleImported ? '已导入' : '导入'}
        </Button>
      </div>

      {/* CTA */}
      <div className="mt-auto pt-6">
        <Button variant="primary" size="lg" className="w-full" onClick={() => void onStart()}>
          开始记
        </Button>
      </div>
    </div>
  )
}
