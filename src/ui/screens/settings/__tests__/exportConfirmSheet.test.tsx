// E2 eng-debt e2-minor（2026-10-05）：ExportConfirmSheet 恢复备份变体文案（MINOR-1）。
// 契约：docs/acceptance/e2-eng-debt.md §范围④；来源 docs/acceptance/prd-trust-pack.md §findings MINOR-1。
// - 缺省 props 保持导出语义（export 调用方零变化）：scope 行「导出范围」+ 有「保存位置」行。
// - 恢复变体：scopeRowLabel 覆盖（settings.importBackupScope）+ hideSaveLocation 隐藏保存位置行。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/app/di', () => ({
  di: { llm: {}, storage: {} },
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { ExportConfirmSheet } from '@/ui/screens/settings/index'
import { t } from '@/app/i18n'
import { setCurrentLang } from '@/app/currentLang'

const BASE_PROPS = {
  scopeLabel: '全部条目',
  filename: 'aiji-backup.zip',
  entryCount: 10,
  mediaCount: 3,
  onClose: () => {},
  onConfirm: () => {},
}

describe('ExportConfirmSheet（E2 MINOR-1 恢复备份变体）', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount()
      })
      root = null
    }
    container.remove()
  })

  it('缺省 props 保持导出语义：scope 行「导出范围」+ 有「保存位置」行', async () => {
    setCurrentLang('zh')
    await act(async () => {
      root!.render(<ExportConfirmSheet {...BASE_PROPS} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('导出范围')
    expect(text).toContain('保存位置')
  })

  it('恢复变体（zh）：scopeRowLabel 覆盖为「还原范围」+ hideSaveLocation 隐藏保存位置行', async () => {
    setCurrentLang('zh')
    await act(async () => {
      root!.render(
        <ExportConfirmSheet {...BASE_PROPS} scopeRowLabel={t('settings.importBackupScope')} hideSaveLocation />,
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('还原范围')
    expect(text).not.toContain('导出范围')
    expect(text).not.toContain('保存位置')
  })

  it('恢复变体（en）：scopeRowLabel「Restore scope」+ 无「Save to」行', async () => {
    setCurrentLang('en')
    await act(async () => {
      root!.render(
        <ExportConfirmSheet {...BASE_PROPS} scopeRowLabel={t('settings.importBackupScope')} hideSaveLocation />,
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('Restore scope')
    expect(text).not.toContain('Save to')
  })
})
