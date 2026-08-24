import type React from 'react';
import type { Viewport } from 'next';

/**
 * Customer-facing display layout — bare, no sidebar, no shift gate.
 * The cashier opens this in a second window/tablet that the customer sees.
 */

/**
 * Pinned viewport for an appliance-style screen: no pinch-zoom, no
 * double-tap zoom, locked scale. `userScalable: false` is honoured by
 * Android Chrome (the tablets these run on); iOS ignores it, so
 * useKioskMode() also blocks the gesture events at runtime.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function CustomerDisplayLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
