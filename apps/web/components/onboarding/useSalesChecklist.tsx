'use client';
/**
 * Per-vertical Get Started checklist for POS / Sales dashboard.
 *
 * Pulls the small bits of state needed (branches, products, recent orders)
 * via TanStack Query — same endpoints the rest of the app already hits, so
 * results are cache-shared. Derives a vertical-specific list of setup
 * milestones based on tenant.businessType.
 *
 * Items only show steps the user can actually act on. Once all required
 * milestones are done, the checklist auto-hides (handled by
 * GetStartedChecklist itself).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ChecklistItem } from './GetStartedChecklist';
import { isFnbType } from '@repo/shared-types';

interface BusinessTypeAware {
  businessType: string | null | undefined;
}

interface CountResponse {
  count: number;
}
interface ProductsList { count: number; products: Array<{ id: string }> }
interface BranchesList { length: number }

export function useSalesChecklist(tenant: BusinessTypeAware): ChecklistItem[] {
  // Branches — single GET, cached for 5 min.
  const { data: branches = [] } = useQuery<Array<{ id: string; isActive: boolean }>>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // Products count — list endpoint always returns at least the count.
  const { data: products } = useQuery<ProductsList | { length: number; data?: Array<unknown> }>({
    queryKey: ['products', { take: 1 }],
    queryFn:  () => api.get('/products', { params: { take: 1 } }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // Recent orders — any sale at all means "first order taken".
  const { data: recentOrders = [] } = useQuery<Array<unknown>>({
    queryKey: ['recent-orders', { take: 1 }],
    queryFn:  () => api.get('/orders', { params: { take: 1 } }).then((r) => r.data),
    staleTime: 60_000,
  });

  // Staff users — counts of additional users beyond the owner.
  const { data: users = [] } = useQuery<Array<{ id: string }>>({
    queryKey: ['users-list'],
    queryFn:  () => api.get('/users').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const hasBranch    = branches.some((b) => b.isActive);
  const productCount =
    typeof (products as ProductsList | undefined)?.count === 'number'
      ? (products as ProductsList).count
      : Array.isArray(products) ? (products as unknown as Array<unknown>).length : 0;
  const hasProducts  = productCount > 0;
  const hasOrders    = recentOrders.length > 0;
  const hasStaff     = users.length > 1;   // owner + at least one extra

  const isFnb = isFnbType(tenant.businessType ?? null);

  // Common items everyone gets.
  const items: ChecklistItem[] = [
    {
      done: hasBranch,
      label: 'Add at least one branch',
      hint: 'Single-location? The default Main branch is fine.',
      href: '/settings/branches',
    },
    {
      done: hasProducts,
      label: 'Add your first products',
      hint: isFnb
        ? 'Create menu items, drinks, or set up a recipe-based product.'
        : 'Create the items you sell. CSV import is supported under Products → Import.',
      href: '/pos/products',
    },
    {
      done: hasStaff,
      label: 'Invite your team',
      hint: 'Add a cashier or manager so the till isn\'t tied to the owner account.',
      href: '/settings/staff',
      optional: true,
    },
    {
      done: hasOrders,
      label: 'Make your first sale',
      hint: 'Open the Terminal, ring up an item, and confirm payment.',
      href: '/pos/terminal',
    },
  ];

  return items;
}
