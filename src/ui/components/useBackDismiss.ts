// 手搓弹层接硬件返回键（D1 收尾波）：latest-ref 避免旧闭包，mount 注册/unmount 注销。
// web 端栈注册但 backButton 事件永不触发（initBackButton native 自守卫），零行为变化。
import { useEffect, useRef } from 'react'
import { pushBackHandler } from '@/app/backButton'

export function useBackDismiss(onClose: () => void): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => pushBackHandler(() => ref.current()), [])
}
