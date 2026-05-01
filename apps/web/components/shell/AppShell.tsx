'use client';
import * as React from 'react';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, ChevronLeft, ChevronRight, Sun, Moon, Settings, LogOut, Lock, HelpCircle } from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { cn } from '@/lib/utils';
import { MobileNavSheet } from './MobileNavSheet';
import { toggleTheme } from '@/components/portal/AppLoginPage';
import { useAuthStore } from '@/store/auth';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Shows an amber pill / dot when > 0 */
  badge?: number;
  /**
   * When true, the item is visible in the nav but rendered as a non-clickable
   * dimmed row with a lock icon — indicates the user's role doesn't allow access.
   */
  disabled?: boolean;
  /** Tooltip shown on hover when disabled (e.g. "Requires Branch Manager or above") */
  disabledReason?: string;
  /**
   * If set, a small section header is rendered above this item — used to
   * group nav items into sections (e.g. "Transactions", "General Ledger").
   * Hidden when the sidebar is collapsed.
   */
  sectionStart?: string;
}

interface AppShellProps {
  children: React.ReactNode;
  navItems: NavItem[];
  logoIcon: React.ElementType;
  appName: string;
  brandName?: string;
  headerRight?: React.ReactNode;
  /**
   * Custom widget rendered in the empty space between the nav items and
   * the sign-out / user info footer. Used by POS to put a live clock
   * there (so cashiers always see the time without leaving the till).
   * Hidden when the sidebar is collapsed.
   */
  sidebarExtra?: React.ReactNode;
  /**
   * Route for the per-app Help & Guide page (e.g. "/pos/help"). When set,
   * a "Help & Guide" link appears above Settings in the sidebar footer.
   */
  helpHref?: string;
  /** When provided, a Sign Out button is rendered in the sidebar footer and mobile nav. */
  onSignOut?: () => void;
}

export function AppShell({
  children,
  navItems,
  logoIcon: LogoIcon,
  appName,
  brandName = 'Clerque',  // "Clerque Counter", "Clerque Ledger", "Clerque Sync"
  headerRight,
  sidebarExtra,
  helpHref,
  onSignOut,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const pathname = usePathname();
  const user     = useAuthStore((s) => s.user);

  useEffect(() => {
    // Backstop: re-apply theme from localStorage in case React hydration briefly
    // reset the class that the inline <head> script set before first paint.
    try {
      const stored = localStorage.getItem('theme');
      const html   = document.documentElement;
      if (stored === 'dark'  && !html.classList.contains('dark')) html.classList.add('dark');
      if (stored === 'light' &&  html.classList.contains('dark')) html.classList.remove('dark');
    } catch {}

    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  function NavList({ onItemClick }: { onItemClick?: () => void }) {
    return (
      <nav className="flex flex-col gap-0.5 p-2">
        {navItems.map((item, idx) => {
          const { href, label, icon: Icon, badge, disabled, disabledReason, sectionStart } = item;
          const active = !disabled && (pathname === href || pathname.startsWith(href + '/'));
          const tooltip = collapsed
            ? disabled ? `${label} — ${disabledReason ?? 'No access for your role'}` : label
            : disabled ? (disabledReason ?? 'No access for your role') : undefined;

          const sectionHeader = sectionStart && !collapsed ? (
            <div
              key={`section-${idx}`}
              className={cn(
                'px-3 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider',
                idx === 0 ? 'pt-1 pb-1.5' : 'pt-3 pb-1.5 mt-1 border-t border-border/40',
              )}
            >
              {sectionStart}
            </div>
          ) : sectionStart && collapsed && idx > 0 ? (
            <div key={`section-${idx}`} className="my-1 mx-2 border-t border-border/40" />
          ) : null;

          // Disabled: visible but non-interactive dimmed row
          if (disabled) {
            return (
              <React.Fragment key={href}>
                {sectionHeader}
                <div
                  title={tooltip}
                  className={cn(
                    'relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium w-full',
                    'text-muted-foreground/40 cursor-not-allowed select-none',
                    collapsed && 'justify-center px-2',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate flex-1">{label}</span>}
                  {!collapsed && <Lock className="h-3 w-3 shrink-0 opacity-50" />}
                </div>
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={href}>
              {sectionHeader}
              <Link
                href={href}
                onClick={onItemClick}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors w-full text-left',
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  collapsed && 'justify-center px-2',
                )}
                title={tooltip}
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
              </Link>
            </React.Fragment>
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

        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
          <NavList />
          {sidebarExtra && !collapsed && (
            <div className="mt-auto px-2 pb-2">
              {sidebarExtra}
            </div>
          )}
        </div>

        <div className="p-2 border-t border-border shrink-0 space-y-1">
          {/* User info */}
          {!collapsed && user && (
            <div className="px-3 py-2 rounded-md bg-muted/30">
              <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {user.role?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </p>
            </div>
          )}
          {/* Help & Guide — app-specific FAQ + how-to docs */}
          {helpHref && (
            <Link
              href={helpHref}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors w-full',
                collapsed && 'justify-center px-2',
              )}
              title={collapsed ? 'Help & Guide' : undefined}
            >
              <HelpCircle className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Help &amp; Guide</span>}
            </Link>
          )}
          {/* Settings */}
          <Link
            href="/settings"
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors w-full',
              collapsed && 'justify-center px-2',
            )}
            title={collapsed ? 'Settings' : undefined}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Settings</span>}
          </Link>
          {/* Sign Out — rendered only when the parent layout provides a handler */}
          {onSignOut && (
            <button
              onClick={onSignOut}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors w-full',
                collapsed && 'justify-center px-2',
              )}
              title={collapsed ? 'Sign out' : undefined}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Sign out</span>}
            </button>
          )}
          {/* Collapse toggle */}
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
          <div className="flex items-center gap-1">
            {headerRight}
            <NotificationBell />
            <button
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <MobileNavSheet open={mobileOpen} onClose={() => setMobileOpen(false)} logoIcon={LogoIcon} appName={appName} brandName={brandName} helpHref={helpHref} onSignOut={onSignOut}>
        <NavList onItemClick={() => setMobileOpen(false)} />
      </MobileNavSheet>
    </div>
  );
}
