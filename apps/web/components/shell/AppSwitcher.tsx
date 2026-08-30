'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronsUpDown, LayoutGrid } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { accessibleApps, appForPath } from '@/lib/apps';
import { cn } from '@/lib/utils';

/**
 * Move between Clerque apps without signing out.
 *
 * Until now /select was the only screen that knew a user held more than one
 * app, and nothing inside an app linked back to it — so an owner in Counter
 * who wanted the Ledger had to sign out and sign back in. That is a minute of
 * friction on a task people do many times a day, and it makes the suite feel
 * like four products that happen to share a login.
 *
 * The list comes from lib/apps.ts, the same function the launcher uses, so
 * this can never offer an app /select would have withheld.
 *
 * Renders nothing when the user holds exactly one app: a switcher with one
 * option is a button that does nothing.
 */
export function AppSwitcher({
  collapsed = false,
  /**
   * Render the apps as a flat list instead of a dropdown. The mobile sheet is
   * already a panel; a menu that pops out of it would clip against the sheet's
   * own bounds, and there is room to just show them.
   */
  inline = false,
  /**
   * Which way the menu opens. The sidebar footer sits at the bottom of the
   * screen so it must open upward; a top header must open downward. Getting
   * this wrong renders the menu off-screen, which reads as a dead button.
   */
  align = 'up',
  onNavigate,
}: {
  collapsed?: boolean;
  inline?: boolean;
  align?: 'up' | 'down';
  onNavigate?: () => void;
}) {
  const pathname            = usePathname();
  const { user, hasAccess } = useAuthStore();
  const [open, setOpen]     = useState(false);
  const ref                 = useRef<HTMLDivElement>(null);

  // Zustand rehydrates after mount; reading appAccess before that would render
  // a switcher with one entry and then pop the rest in.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close on navigation — the menu is fixed-positioned and would otherwise
  // hang over the page you just moved to.
  useEffect(() => { setOpen(false); }, [pathname]);

  if (!hydrated || !user) return null;

  const apps    = accessibleApps(user, hasAccess);
  const current = appForPath(pathname);

  if (apps.length < 2) return null;

  if (inline) {
    return (
      <div className="mt-1 space-y-0.5">
        <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Switch app
        </p>
        {apps.map((app) => {
          const isCurrent = app.name === current;
          return (
            <Link
              key={app.name}
              href={app.resolvedRoute}
              onClick={onNavigate}
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isCurrent ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                style={{ background: app.accent }}
              >
                <app.Icon className="h-3 w-3 text-white" />
              </span>
              <span className="min-w-0 flex-1 truncate">{app.name}</span>
              {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" />}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? 'Switch app' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
          collapsed ? 'w-full justify-center px-2 py-2' : 'w-full px-3 py-2',
        )}
      >
        <LayoutGrid className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Switch app</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 w-60 overflow-hidden rounded-lg border border-border bg-card shadow-lg',
            align === 'up' ? 'bottom-full left-0 mb-1' : 'top-full right-0 mt-1',
          )}
        >
          {apps.map((app) => {
            const isCurrent = app.name === current;
            return (
              <Link
                key={app.name}
                href={app.resolvedRoute}
                role="menuitem"
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors',
                  isCurrent ? 'bg-muted/60' : 'hover:bg-muted',
                )}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                  style={{ background: app.accent }}
                >
                  <app.Icon className="h-3.5 w-3.5 text-white" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{app.name}</span>
                {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
