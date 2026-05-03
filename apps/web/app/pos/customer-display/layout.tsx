import type React from 'react';

/**
 * Customer-facing display layout — bare, no sidebar, no shift gate.
 * The cashier opens this in a second window/tablet that the customer sees.
 */
export default function CustomerDisplayLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
