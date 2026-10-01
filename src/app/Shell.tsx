import clsx from 'clsx'
import { Home as HomeIcon, Megaphone, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { IconButton, Kbd } from '@/ui'
import { CommandPalette } from './CommandPalette'
import { useSite, useVisibleGroups } from './config'
import { usePrefs } from './prefs'
import { toolPath } from './registry'

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-2 whitespace-nowrap', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--color-mat)" />
        <path d="M0 11h32M0 21h32M11 0v32M21 0v32" stroke="var(--color-mat-line)" strokeWidth="1" />
        <path d="M7 19.5 13 25 25.5 8.5" fill="none" stroke="var(--color-mark)" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-display text-[1.35rem] leading-none tracking-[-0.01em] text-ink">
        온비<span className="marker">짱</span>
      </span>
    </span>
  )
}

function NavItem({ to, icon: Icon, label, collapsed, end, badge }: { to: string; icon: React.ComponentType<{ className?: string }>; label: string; collapsed: boolean; end?: boolean; badge?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        clsx(
          'group relative flex h-9 items-center gap-2.5 rounded-md text-sm transition-colors duration-150',
          collapsed ? 'justify-center px-0' : 'px-2.5',
          isActive ? 'bg-surface font-bold text-ink shadow-1' : 'font-medium text-ink-2 hover:bg-surface/70 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={clsx('size-[18px] shrink-0', isActive ? 'text-brand' : 'text-muted group-hover:text-ink-2')} />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
          {badge && <span className={clsx('size-1.5 rounded-full bg-accent', collapsed && 'absolute right-1.5 top-1.5')} aria-label="새 기능" />}
        </>
      )}
    </NavLink>
  )
}

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const groups = useVisibleGroups()
  const config = useSite((s) => s.config)
  return (
    <nav aria-label="도구 메뉴" className="flex h-full flex-col gap-4 overflow-y-auto px-2.5 py-3" onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate?.()}>
      <NavItem to="/" end icon={HomeIcon} label="모든 도구" collapsed={collapsed} />
      {groups.map(({ group, tools }) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          {collapsed ? (
            <div className="mx-auto mb-1 h-px w-6 bg-line-strong" />
          ) : (
            <p className="px-2.5 pb-1 text-xs font-bold text-muted">{group.title}</p>
          )}
          {tools.map((t) => (
            <NavItem key={t.id} to={toolPath(t.id)} icon={t.icon} label={t.title} collapsed={collapsed} badge={config.tools[t.id]?.badge === 'new'} />
          ))}
        </div>
      ))}
      {!collapsed && (
        <p className="mt-auto flex items-start gap-2 rounded-md px-2.5 pt-3 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
          사진·영상·문서는 서버로 보내지 않고 이 컴퓨터에서 처리합니다.
        </p>
      )}
    </nav>
  )
}

export function Shell() {
  const collapsed = usePrefs((s) => s.sidebarCollapsed)
  const setCollapsed = usePrefs((s) => s.setSidebarCollapsed)
  const notice = useSite((s) => s.config.notice)
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const [noticeClosed, setNoticeClosed] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    setDrawer(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-dvh">
      <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-paper/92 px-3 backdrop-blur-sm sm:px-4">
        <span className="lg:hidden">
          <IconButton icon={Menu} label="메뉴 열기" onClick={() => setDrawer(true)} />
        </span>
        <span className="hidden lg:inline-flex">
          <IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? '메뉴 펼치기' : '메뉴 접기'} onClick={() => setCollapsed(!collapsed)} />
        </span>
        <Link to="/" className="shrink-0 rounded-sm" aria-label="온비짱 홈">
          <Logo />
        </Link>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="ml-auto flex h-9 min-w-0 flex-1 items-center sm:max-w-72 gap-2 rounded-md border border-line-strong bg-surface px-3 text-sm text-muted shadow-1 transition-colors duration-150 hover:border-faint hover:text-ink-2"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate text-left">도구 찾기</span>
          <span className="hidden items-center gap-0.5 sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <Link to="/admin" title="관리자" aria-label="관리자" className="inline-flex size-10 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink">
          <Settings className="size-[18px]" aria-hidden />
        </Link>
      </header>

      {notice.enabled && notice.text.trim() && !noticeClosed && (
        <div className="no-print flex items-center gap-2.5 border-b border-line bg-mark-soft px-4 py-2 text-sm text-ink">
          <Megaphone className="size-4 shrink-0 text-warn" aria-hidden />
          <p className="min-w-0 flex-1">{notice.text}</p>
          <IconButton icon={X} label="공지 닫기" size="sm" onClick={() => setNoticeClosed(true)} />
        </div>
      )}

      <div className="flex">
        <aside className={clsx('no-print sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 border-r border-line bg-panel transition-[width] duration-200 lg:block', collapsed ? 'w-[60px]' : 'w-60')}>
          <Sidebar collapsed={collapsed} />
        </aside>

        {drawer && (
          <div className="no-print fixed inset-0 z-50 lg:hidden">
            <button type="button" aria-label="메뉴 닫기" className="animate-fade absolute inset-0 bg-ink/45" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-panel shadow-3">
              <div className="flex h-14 items-center justify-between border-b border-line px-4">
                <Logo />
                <IconButton icon={X} label="메뉴 닫기" onClick={() => setDrawer(false)} />
              </div>
              <div className="min-h-0 flex-1">
                <Sidebar collapsed={false} onNavigate={() => setDrawer(false)} />
              </div>
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  )
}
