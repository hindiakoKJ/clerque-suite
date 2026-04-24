'use client';
import * as React from 'react';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MobileNavSheet } from './MobileNavSheet';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Shows an amber pill / dot when > 0 */
  badge?: number;
}

interface AppShellProps {
  children: React.ReactNode;
  navItems: NavItem[];
  logoIcon: React.ElementType;
  appName: string;
  brandName?: string;
  headerRight?: React.ReactNode;
}

export function AppShell({
  children,
  navItems,
  logoIcon: LogoIcon,
  appName,
  brandName = '[AppName]',
  headerRight,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router   = useRouter();

  function NavList({ onItemClick }: { onItemClick?: () => void }) {
    return (
      <nav className="flex flex-col gap-0.5 p-2">
        {navItems.map(({ href, label, icon: Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <button
              key={href}
              onClick={() => { router.push(href); onItemClick?.(); }}
              className={cn(
                'relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors w-full text-left',
                active
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                collapsed && 'justify-center px-2',
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate flex-1">{label}</span>}
              {badge != null && badge > 0 && !collapsed && (
                <span className="ml-auto bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
              {badge != null && badge > 0 && collapsed && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col border-r border-border bg-card shrink-0 transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <div className={cn('h-14 flex items-center border-b border-border shrink-0', collapsed ? 'justify-center px-2' : 'px-4 gap-2.5')}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent)' }}>
            <LogoIcon className="h-4 w-4 text-white" />
          </div>
          {!collapsed && (
            <div className="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
              <span className="font-semibold text-sm tracking-tight text-foreground whitespace-nowrap">{brandName}</span>
              <span className="text-muted-foreground text-sm">·</span>
              <span className="font-semibold text-sm tracking-tight whitespace-nowrap" style={{ color: 'var(--accent)' }}>{appName}</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <NavList />
        </div>

        <div className="p-2 border-t border-border shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-full h-8 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="h-14 bg-card/60 backdrop-blur-sm border-b border-border flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3 md:hidden">
            <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                <LogoIcon className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="font-semibold text-sm" style={{ color: 'var(--accent)' }}>{appName}</span>
            </div>
          </div>
          <div className="hidden md:block" />
          {headerRight && <div className="flex items-center gap-1">{headerRight}</div>}
        </header>

        <main className="flex-1 overflow-hidden">{children}</main>
      </div>

      <MobileNavSheet open={mobileOpen} onClose={() => setMobileOpen(false)} logoIcon={LogoIcon} appName={appName} brandName={brandName}>
        <NavList onItemClick={() => setMobileOpen(false)} />
      </MobileNavSheet>
    </div>
  );
}
