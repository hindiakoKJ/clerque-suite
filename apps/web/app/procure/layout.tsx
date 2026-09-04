'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingBasket } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { AppSwitcher } from '@/components/shell/AppSwitcher';

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
/*
  Procure's brand colour, matching its card on /select. Every other app layout
  sets these on <html> and Procure did not, so `--accent` resolved to the empty
  string on every /procure route: each bg-[var(--accent)] button rendered with
  NO background at all, and text-[var(--accent)] with no colour. The Add button
  on the buy list -- the primary action of the app -- was invisible.

  It goes on <html> rather than the wrapper so Radix dialog portals, which
  mount at document.body, inherit it too. Cleaned up on unmount so switching
  apps does not leave Procure's orange behind in Counter.
*/
const PROCURE_ACCENT      = 'hsl(28 80% 48%)';
const PROCURE_ACCENT_SOFT = 'hsl(28 80% 48% / 0.08)';

export const STOCK_ROLES   = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM', 'WAREHOUSE_STAFF'];
// GENERAL_EMPLOYEE is the cook/barista account: it can put something on the
// buy list and nothing else. Read access to the stock screens is deliberately
// NOT granted here -- those screens carry Create / Edit / Receive controls with
// no read-only mode, so "let them look" currently means "let them receive".
export const REQUEST_ROLES = [...STOCK_ROLES, 'CASHIER', 'SALES_LEAD', 'GENERAL_EMPLOYEE'];

function rolesFor(pathname: string): string[] {
  if (pathname.startsWith('/procure/requests')) return REQUEST_ROLES;
  // The menu ceiling is a READ of what is short. The cook who notices the
  // milk is low is exactly who should be able to check it, so it sits with
  // the buy list rather than with the stock screens.
  if (pathname.startsWith('/procure/ceiling'))  return REQUEST_ROLES;
  /*
    Recording a batch is a floor action, and the API already says so: CASHIER,
    SALES_LEAD and WAREHOUSE_STAFF may all post one, because the person who
    made the syrup is the one who knows it happened. A shift that cannot record
    it is a shift where the raw materials silently stop moving.

    Safe to open where the other stock screens are not: this one has no Create,
    Edit or Receive control, so "let them look" does not quietly mean "let them
    receive".
  */
  /*
    Defining a prep is master data, not a floor action, and the API says so:
    `PUT /inventory/sub-recipes/:id` is BUSINESS_OWNER and MDM only. Checked
    BEFORE the board below, which is a prefix match -- without this, a cashier
    could open a form whose every Save came back 403.

    Deliberately narrower than STOCK_ROLES. A manager or warehouse account that
    could open this would see a screen it cannot use, which is worse than not
    seeing it: changing a recipe changes what every future batch consumes and
    what the ingredient costs.
  */
  if (pathname.startsWith('/procure/batches/setup')) return ['BUSINESS_OWNER', 'MDM'];
  // Posting a receipt moves stock and money in one tap, so it sits with the
  // roles the API already lets record a purchase and receive it.
  if (pathname.startsWith('/procure/receipts'))      return ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM'];
  if (pathname.startsWith('/procure/batches'))  return REQUEST_ROLES;
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
    const root = document.documentElement;
    root.style.setProperty('--accent',      PROCURE_ACCENT);
    root.style.setProperty('--accent-soft', PROCURE_ACCENT_SOFT);
    return () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
    };
  }, []);

  // Redirect only where there is somewhere to go. Sending a role that cannot
  // open ANY Procure page to /procure/requests just moved it to a page it also
  // cannot open, where the same check failed and pathname stopped changing --
  // so the effect stopped firing and the page rendered anyway. A refusal has
  // to be a render, not a redirect, or it is not a refusal.
  const atHome       = pathname === '/procure';
  const allowedHere  = !user || rolesFor(pathname).includes(user.role);
  const allowedAtAll = !user || REQUEST_ROLES.includes(user.role);

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) { router.replace('/login'); return; }
    if (!allowedHere && allowedAtAll) router.replace('/procure/requests');
  }, [hydrated, accessToken, allowedHere, allowedAtAll, router]);

  if (!hydrated) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          {/*
            Back goes UP one level, not out of the app. From a sub-screen it
            returns to the Procure home; only from the home itself does it
            leave for the app selector. Sending someone from the buy list all
            the way out to /select is not "back" -- it throws away where they
            were, and the app switcher already covers leaving.
          */}
          <Link
            href={atHome ? '/select' : '/procure'}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={atHome ? 'Back to apps' : 'Back to Procure'}
            title={atHome ? 'Back to apps' : 'Back to Procure'}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link href="/procure" className="flex min-w-0 flex-1 items-center gap-3">
            <ShoppingBasket className="h-5 w-5 shrink-0 text-[var(--accent)]" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold leading-tight">Procure</h1>
              <p className="truncate text-xs text-muted-foreground">Stock, requests, and receiving</p>
            </div>
          </Link>
          {/* Procure has no AppShell sidebar to hang this off, and it is the
              app a warehouse or kitchen account lands in — the one most likely
              to be someone's only app, and the one where being stuck would be
              least obvious. It hides itself when there is nowhere else to go. */}
          <AppSwitcher align="down" />
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
        {allowedAtAll ? (
          allowedHere ? children : null   /* in-flight redirect to the requests screen */
        ) : (
          <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 text-center">
            <h2 className="text-base font-semibold">Procure is not part of your role</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Stock, requests and receiving belong to the people who handle inventory. Ask the
              owner if you need access.
            </p>
            <Link
              href="/select"
              className="mt-4 inline-block rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              Back to your apps
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
