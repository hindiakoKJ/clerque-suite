'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingBasket } from 'lucide-react';
import { useAuthStore } from '@/store/auth';

/**
 * Clerque Procure.
 *
 * Deliberately not a copy of the POS shell. The reason this app exists apart
 * from POS is that an owner will not learn a point-of-sale to record a grocery
 * run — so it gets a header, and nothing else. No sidebar, no module switcher,
 * no settings tree.
 */

/**
 * The stock screens used to be reachable only from the POS sidebar, which
 * showed them to managers and owners alone. Moving them here would have handed
 * them to anyone with the URL, so the same gate moves with them — the pages
 * themselves have no role check inside, they relied on the nav for that.
 *
 * The request screen is deliberately wider: whoever notices the shortage is
 * standing at the bar, and making them find a manager first is what causes the
 * second trip to the grocery.
 *
 * Cooks and baristas being able to SEE stock without changing it is a
 * different thing, and needs a role that does not exist yet — today the
 * closest is CASHIER, which is a till, not a kitchen. Left as a decision
 * rather than guessed at.
 */
const STOCK_ROLES   = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM', 'WAREHOUSE_STAFF'];
const REQUEST_ROLES = [...STOCK_ROLES, 'CASHIER', 'SALES_LEAD'];

function rolesFor(pathname: string): string[] {
  if (pathname.startsWith('/procure/requests')) return REQUEST_ROLES;
  if (pathname === '/procure')                  return REQUEST_ROLES;
  return STOCK_ROLES;
}

export default function ProcureLayout({ children }: { children: React.ReactNode }) {
  const router      = useRouter();
  const pathname    = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user        = useAuthStore((s) => s.user);

  // Zustand rehydrates from storage after mount; reading the role before that
  // would bounce a legitimate manager to /login on every refresh.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) { router.replace('/login'); return; }
    if (user && !rolesFor(pathname).includes(user.role)) router.replace('/procure/requests');
  }, [hydrated, accessToken, user, pathname, router]);

  if (!hydrated) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/select"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Back to apps"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link href="/procure" className="flex min-w-0 items-center gap-3">
            <ShoppingBasket className="h-5 w-5 shrink-0 text-[var(--accent)]" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold leading-tight">Procure</h1>
              <p className="truncate text-xs text-muted-foreground">Stock, requests, and receiving</p>
            </div>
          </Link>
        </div>
      </header>
      {/*
        The request screen is a phone-width list; the stock screens are wide
        tables that came from a full-width POS shell and would be unusable
        squeezed into a reading column. Each gets the width it was built for.
      */}
      <main
        className={`mx-auto px-4 pb-24 pt-5 sm:px-6 ${
          pathname.startsWith('/procure/requests') || pathname === '/procure'
            ? 'max-w-3xl'
            : 'max-w-6xl'
        }`}
      >
        {children}
      </main>
    </div>
  );
}
