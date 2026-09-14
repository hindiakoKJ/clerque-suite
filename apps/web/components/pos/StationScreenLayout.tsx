'use client';
/**
 * How the station screen splits its space between orders and prep levels.
 *
 *   split   orders on three quarters, prep levels in a column on the last
 *           quarter, each scrolling on its own. Below tablet width the prep
 *           column sits on top, capped, so the orders still get the screen.
 *   orders  orders only.
 *   prep    prep levels only.
 *
 * The prep panel is always rendered, hidden when only the orders show, so it
 * keeps watching the levels and ringing the bell whichever view is up.
 */
import type { ReactNode } from 'react';

export type StationView = 'split' | 'orders' | 'prep';
export const STATION_VIEWS: StationView[] = ['split', 'orders', 'prep'];

export function StationScreenLayout({ view, orders, prep }: { view: StationView; orders: ReactNode; prep: ReactNode }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col md:flex-row">
      {view !== 'prep' && (
        <section className={`min-h-0 flex-1 overflow-y-auto p-6 ${view === 'split' ? 'order-2 md:order-1 md:w-3/4 md:flex-none' : ''}`}>
          {orders}
        </section>
      )}
      <aside
        aria-label="Prep levels"
        className={view === 'orders'
          ? 'hidden'
          : view === 'split'
            ? 'order-1 max-h-[40vh] shrink-0 overflow-y-auto border-b border-stone-800 bg-stone-900/60 p-4 md:order-2 md:max-h-none md:w-1/4 md:border-b-0 md:border-l'
            : 'min-h-0 flex-1 overflow-y-auto p-6'}
      >
        {prep}
      </aside>
    </main>
  );
}
