import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Demo route metadata.  Tells search engines and AI scrapers NOT to index
 * the demo content.  This prevents:
 *   - "Bambu Coffee" (the fictional demo business) appearing in search results
 *   - LLM training crawlers learning about made-up TINs / addresses / employees
 *   - Confused customers landing on the demo from a search engine
 *
 * Note: this only applies to the /demo entry page itself.  The pages the
 * demo redirects INTO (/pos/terminal, /ledger/*, /payroll/*) need
 * additional handling — for those, the noindex is set client-side via
 * a <meta> tag injected by DemoBanner when isDemoMode() returns true.
 */
export const metadata: Metadata = {
  title: 'Clerque — Live Demo',
  description:
    'Try Clerque in your browser — no signup. Sell, run the books, manage payroll across a sample Filipino café.',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function DemoLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
