// PWA Share Target 接收页（契约 docs/acceptance/prd-trust-pack.md §范围②）。
// manifest share_target GET 把外部分享落到 /share-target?title&text&url：
// - 非空 → 追加一条 text part 进采集草稿（addPart 追加语义，不覆盖在写草稿）→
//   replace 跳 /capture（渲染期即跳，本页只落一帧 Loading）。
// - 全空 → 空态 + 回首页。
// 非目标：POST/files（需 injectManifest 手术）、原生 ACTION_SEND——文档在案。
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, Spinner } from '@/ui/components'
import { useUiStore } from '@/app/store'
import { useT } from '@/app/i18n/useT'

// 分享三参（均可缺席）→ 草稿文本：有值的按行拼接，trim。export 供测试。
export function composeSharedText(
  title?: string | null,
  text?: string | null,
  url?: string | null,
): string {
  return [title, text, url]
    .filter((s): s is string => Boolean(s))
    .join('\n')
    .trim()
}

export default function ShareTarget() {
  const t = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [empty, setEmpty] = useState(false)
  // StrictMode 双调守卫：addPart 是追加语义，effect 双跑会把分享文本重复入草稿。
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const content = composeSharedText(params.get('title'), params.get('text'), params.get('url'))
    if (!content) {
      setEmpty(true)
      return
    }
    useUiStore.getState().addPart({ type: 'text', content })
    navigate('/capture', { replace: true })
  }, [params, navigate])

  if (empty) {
    return (
      <EmptyState
        title={t('shareTarget.empty')}
        action={
          <Button onClick={() => navigate('/', { replace: true })}>{t('shareTarget.backHome')}</Button>
        }
      />
    )
  }
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size={28} />
    </div>
  )
}
