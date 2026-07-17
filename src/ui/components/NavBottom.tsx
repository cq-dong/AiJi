import { NavLink } from 'react-router-dom'
import { Bell, LayoutGrid, ListTree, NotebookPen, Settings } from 'lucide-react'
import { cn } from './cn'

const TABS = [
  { to: '/', label: '时间线', Icon: ListTree, end: true },
  { to: '/categories', label: '类别', Icon: LayoutGrid, end: false },
  { to: '/summary', label: '摘要', Icon: NotebookPen, end: false },
  { to: '/reminders', label: '提醒', Icon: Bell, end: false },
  { to: '/settings', label: '设置', Icon: Settings, end: false },
] as const

export function NavBottom() {
  return (
    <nav
      className="absolute inset-x-0 bottom-0 z-20 border-t border-brd bg-card shadow-[0_-4px_12px_rgb(var(--aji-shadow)/0.04)]"
      style={{
        // D1: 底部系统导航栏（gesture/三键）安全区适配。
        // Android WebView 不支持 env(safe-area-inset-*)，--safe-bottom 由 MainActivity 原生注入；
        // PWA 浏览器环境 fallback 0 → 退化为原 79px，不影响原型视感。
        height: 'calc(79px + var(--safe-bottom, 0px))',
        paddingBottom: 'var(--safe-bottom, 0px)',
      }}
    >
      <div className="grid grid-cols-5">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="flex flex-col items-center gap-1 rounded-btn pt-2 outline-none transition duration-base ease-out focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full transition duration-base ease-out',
                    isActive ? 'bg-priS' : 'bg-transparent',
                  )}
                >
                  <Icon
                    size={20}
                    strokeWidth={2}
                    className={cn(isActive ? 'text-pri' : 'text-t3')}
                  />
                </span>
                <span className={cn('text-[10px] font-medium', isActive ? 'text-pri' : 'text-t3')}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
