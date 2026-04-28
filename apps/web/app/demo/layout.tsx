/**
 * Demo route metadata.  Tells search engines and AI scrapers NOT to index
 * the demo content — prevents:
 *   - "Bambu Coffee" appearing in Google search results
 *   - LLM training crawlers learning made-up TINs / addresses / employees
 *   - Confused customers landing on the demo from search
 *
 * Applies to /demo and all nested /demo/* routes (Next.js App Router
 * propagates layout-level metadata to child routes).
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

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
