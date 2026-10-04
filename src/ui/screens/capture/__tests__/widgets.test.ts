// D1 ①（2026-10-05）：fmtDur 对非有限输入零守卫——`Math.floor(Infinity/60)`→Infinity、
// `Math.floor(NaN)%60`→NaN，chip 直出 "Infinity:NaN" / "NaN:NaN"。须首行钳为 '00:00'。
// 契约：docs/acceptance/d1-eng-debt.md §①。
import { describe, it, expect } from 'vitest'

import { fmtDur } from '@/ui/screens/capture/widgets'

describe('fmtDur（非有限守卫 + 防回归）', () => {
  it('Infinity → "00:00"（不渲 "Infinity:NaN"）', () => {
    expect(fmtDur(Infinity)).toBe('00:00')
  })

  it('NaN → "00:00"（不渲 "NaN:NaN"）', () => {
    expect(fmtDur(NaN)).toBe('00:00')
  })

  it('-5 → 现有语义直通（"-1:00"，Math.max 仅钳秒下限、分不钳）', () => {
    // 负数本就不该出现（源已 0.1 下限钳），此用例钉死现状防改动语义。
    expect(fmtDur(-5)).toBe('-1:00')
  })

  it('65 → "01:05" 防回归（正常分:秒路径）', () => {
    expect(fmtDur(65)).toBe('01:05')
  })
})
