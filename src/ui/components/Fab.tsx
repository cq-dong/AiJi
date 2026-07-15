import { useNavigate } from 'react-router-dom'
import { Mic } from 'lucide-react'

export function Fab() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/capture')}
      aria-label="开始采集"
      className="absolute bottom-[93px] right-5 z-30 flex h-14 w-14 items-center justify-center rounded-fab bg-pri text-card shadow-lg shadow-pri/30 transition active:scale-95"
    >
      <Mic size={26} strokeWidth={2.2} />
    </button>
  )
}
