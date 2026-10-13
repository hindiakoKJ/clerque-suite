'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Boxes } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { AppSwitcher } from '@/components/shell/AppSwitcher';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { cn } from '@/lib/utils';
import { TAG_ROLES, pagesFor, rolesFor } from './inventory-nav';

/**
 * Clerque Inventory: tagged parts, their photos, the printed labels.
 *
 * Built like Procure: a header and nothing else, because the people who use
 * it most are tagging parts on a phone in the stockroom. Plus one row of tabs
 * with only the screens this person's role can open.
 *
 * The edge guard (middleware.ts) lets in every Inventory role; this layout
 * narrows each screen to the roles the tag API accepts for it, and refuses by
 * rendering a message, never by redirecting to another page it would also
 * refuse.
 */

// Inventory's colour, matching its card on /select. Set on <html> so dialog
// portals inherit it, and cleaned up on unmount (same as Procure).
const INVENTORY_ACCENT      = 'hsl(142 60% 34%)';
const INVENTORY_ACCENT_SOFT = 'hsl(142 60% 34% / 0.08)';

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  const router      = useRouter();
  const pathname    = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user        = useAuthStore((s) => s.user);

  // The auth store rehydrates after mount; reading the role before that would
  // send a signed-in person to /login on every refresh.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent',      INVENTORY_ACCENT);
    root.style.setProperty('--accent-soft', INVENTORY_ACCENT_SOFT);
    return () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
    };
  }, []);

  useEffect(() => {
    if (hydrated && !accessToken) router.replace('/login');
  }, [hydrated, accessToken, router]);

  if (!hydrated) return null;

  const atHome       = pathname === '/inventory';
  const allowedAtAll = !user || TAG_ROLES.includes(user.role);
  const allowedHere  = !user || rolesFor(pathname).includes(user.role);
  const tabs         = pagesFor(user?.role);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          {/* Back goes up one level: to Inventory home from a screen, out to the apps from home. */}
          <Link
            href={atHome ? '/select' : '/inventory'}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={atHome ? 'Back to apps' : 'Back to Inventory'}
            title={atHome ? 'Back to apps' : 'Back to Inventory'}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link href="/inventory" className="flex min-w-0 flex-1 items-center gap-3">
            <Boxes className="h-5 w-5 shrink-0 text-[var(--accent)]" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold leading-tight">Inventory</h1>
              <p className="truncate text-xs text-muted-foreground">Tagged parts, photos and labels</p>
            </div>
          </Link>
          <AppSwitcher align="down" />
          <NotificationBell />
        </div>
        {allowedAtAll && tabs.length > 1 && (
          <nav className="mx-auto max-w-6xl overflow-x-auto px-2 sm:px-4" aria-label="Inventory screens">
            <ul className="flex gap-1 pb-2">
              {tabs.map(({ href, title, Icon }) => {
                const active = href === '/inventory' ? atHome : pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={href} className="shrink-0">
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6">
        {!allowedAtAll ? (
          <Refusal
            title="Inventory is not part of your role"
            body="Tagging parts and printing labels belong to the people who handle stock. Ask the owner if you need access."
            href="/select"
            linkText="Back to your apps"
          />
        ) : !allowedHere ? (
          <Refusal
            title="This screen is not part of your role"
            body="Ask the owner if you need it. The other Inventory screens are in the row above."
            href="/inventory"
            linkText="Back to Inventory"
          />
        ) : (
          children
        )}
      </main>
    </div>
  );
}

function Refusal({ title, body, href, linkText }: { title: string; body: string; href: string; linkText: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Link
        href={href}
        className="mt-4 inline-block rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
      >
        {linkText}
      </Link>
    </div>
  );
}
