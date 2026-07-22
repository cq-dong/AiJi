import { NavLink } from 'react-router-dom'
import { Bell, LayoutGrid, ListTree, NotebookPen, Settings } from 'lucide-react'
import { useT } from '@/app/i18n/useT'
import type { I18nKey } from '@/app/i18n'
import { cn } from './cn'

const TABS = [
  { to: '/', key: 'nav.home' as const, Icon: ListTree, end: true },
  { to: '/categories', key: 'nav.categories' as const, Icon: LayoutGrid, end: false },
  { to: '/summary', key: 'nav.summary' as const, Icon: NotebookPen, end: false },
  { to: '/reminders', key: 'nav.reminders' as const, Icon: Bell, end: false },
  { to: '/settings', key: 'nav.settings' as const, Icon: Settings, end: false },
]

export function NavBottom() {
  const t = useT()
  return (
    <nav
      className="absolute inset-x-0 bottom-0 z-20 border-t border-brd/70 bg-card/85 shadow-[0_-8px_24px_-8px_rgb(var(--aji-shadow)/0.08)] backdrop-blur-xl"
      style={{
        // D1: 底部系统导航栏（gesture/三键）安全区适配。
        // Android WebView 不支持 env(safe-area-inset-*)，--safe-bottom 由 MainActivity 原生注入；
        // PWA 浏览器环境 fallback 0 → 退化为原 79px，不影响原型视感。
        height: 'calc(79px + var(--safe-bottom, 0px))',
        paddingBottom: 'var(--safe-bottom, 0px)',
      }}
    >
      <div className="grid grid-cols-5">
        {TABS.map(({ to, key, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="group flex flex-col items-center gap-[3px] rounded-btn pt-2 outline-none focus-visible:ring-2 focus-visible:ring-pri/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'relative flex h-8 w-14 items-center justify-center rounded-full transition-all duration-slow ease-out',
                    isActive ? 'bg-priS shadow-sm' : 'bg-transparent group-active:bg-page',
                  )}
                >
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.2 : 2}
                    className={cn(
                      'transition-all duration-slow ease-out',
                      isActive ? 'scale-105 text-pri' : 'text-t3 group-active:text-t2',
                    )}
                  />
                </span>
                <span
                  className={cn(
                    'text-[10px] leading-tight transition-colors duration-base ease-out',
                    isActive ? 'font-semibold text-pri' : 'font-medium text-t3',
                  )}
                >
                  {t(key as I18nKey)}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
