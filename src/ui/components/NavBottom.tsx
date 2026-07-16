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
    <nav className="absolute inset-x-0 bottom-0 z-20 h-[79px] border-t border-brd bg-card">
      <div className="grid grid-cols-5">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="flex flex-col items-center gap-1 pt-2">
            {({ isActive }) => (
              <>
                <Icon
                  size={20}
                  strokeWidth={2}
                  className={cn(isActive ? 'text-pri' : 'text-t3')}
                />
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
