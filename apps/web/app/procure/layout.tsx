'use client';
import Link from 'next/link';
import { ArrowLeft, ShoppingBasket } from 'lucide-react';

/**
 * Clerque Procure.
 *
 * Deliberately not a copy of the POS shell. The reason this app exists apart
 * from POS is that an owner will not learn a point-of-sale to record a grocery
 * run — so it gets a header, and nothing else. No sidebar, no module switcher,
 * no settings tree. Everything Procure does happens on one screen.
 */
export default function ProcureLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
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
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-5 sm:px-6">{children}</main>
    </div>
  );
}
