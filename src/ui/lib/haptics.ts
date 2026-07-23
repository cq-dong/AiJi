// 触感反馈门面。语义分级对齐 Apple HIG：impact(物理隐喻 light/medium/heavy)、
// notification(成败 success/warning/error)、selection(值变化，如 swipe 越阈)。
// web/Android Chrome 走 navigator.vibrate；iOS Safari PWA 不支持 Vibration API → 静默降级 no-op。
// 原生壳后续在此接入 @capacitor/haptics（同语义映射），UI 层只认 haptic()，不感知平台。
export type HapticStyle =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error'
  | 'selection'

// 每档一个振动模式（ms 或 [振,停,振…]）。短 transient 用于离散事件，避免长连续振动稀释语义。
const PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 8,
  medium: 16,
  heavy: [0, 28, 40, 28],
  success: [0, 12, 70, 18],
  warning: [0, 22, 50, 22],
  error: [0, 45, 60, 45],
  selection: 5,
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/** 触发一次触感。失败/不支持时静默降级——触感是增强，不是必需。 */
export function haptic(style: HapticStyle = 'light'): void {
  if (!canVibrate()) return
  try {
    navigator.vibrate(PATTERNS[style])
  } catch {
    // 系统拒绝或环境不支持，忽略。
  }
}
