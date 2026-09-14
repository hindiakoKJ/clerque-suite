'use client';
/**
 * How the station screen splits its space between orders and prep levels.
 *
 *   split   on a tablet-sized screen: orders on three quarters, prep levels in
 *           a column on the last quarter, each scrolling on its own under a
 *           header that stays put. On a phone, or any screen too short to pin
 *           a header, the page scrolls as it always did: orders first, prep
 *           levels underneath.
 *   orders  orders only, the page scrolling as it always did.
 *   prep    prep levels only.
 *
 * The prep panel is always rendered, hidden when only the orders show, so it
 * keeps watching the levels and ringing the bell whichever view is up.
 */
import type { ReactNode } from 'react';

export type StationView = 'split' | 'orders' | 'prep';
export const STATION_VIEWS: StationView[] = ['split', 'orders', 'prep'];

/**
 * The page's own height. Pinned to the screen only for the split on a screen
 * wide and tall enough for two scroll areas under a pinned header; otherwise
 * the page grows and scrolls, so a landscape phone still shows its tickets.
 * dvh rather than vh, so a phone browser's toolbar does not hide the bottom.
 */
export function stationRootHeight(view: StationView): string {
  return view === 'split' ? 'min-h-screen md:[@media(min-height:481px)]:h-dvh' : 'min-h-screen';
}

export function StationScreenLayout({ view, orders, prep }: { view: StationView; orders: ReactNode; prep: ReactNode }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col md:flex-row">
      {view !== 'prep' && (
        <section className={`min-h-0 flex-1 overflow-y-auto p-6 ${view === 'split' ? 'md:w-3/4 md:flex-none' : ''}`}>
          {orders}
        </section>
      )}
      <aside
        aria-label="Prep levels"
        className={view === 'orders'
          ? 'hidden'
          : view === 'split'
            ? 'border-t border-stone-800 bg-stone-900/60 p-4 md:min-h-0 md:w-1/4 md:overflow-y-auto md:border-l md:border-t-0'
            : 'min-h-0 flex-1 overflow-y-auto p-6'}
      >
        {prep}
      </aside>
    </main>
  );
}
