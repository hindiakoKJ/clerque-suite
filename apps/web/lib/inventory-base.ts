'use client';
import { usePathname } from 'next/navigation';

/**
 * The stock screens are rendered by two routes — /pos/inventory (historic) and
 * /procure/stock (where they now belong). One component, two homes.
 *
 * Their internal links therefore cannot be hard-coded: a manager who opens
 * stock from Procure and taps "Movements" would land in the POS shell,
 * sidebar and all, with no way back to the app they started in. Deriving the
 * base from the current path keeps each visit inside the app it began in
 * without duplicating a 684-line page.
 */
export function useInventoryBase(): string {
  const pathname = usePathname();
  return pathname.startsWith('/procure') ? '/procure/stock' : '/pos/inventory';
}

/** Where "back" goes, which differs by app rather than by page. */
export function useAppHome(): string {
  const pathname = usePathname();
  return pathname.startsWith('/procure') ? '/procure' : '/pos/dashboard';
}
