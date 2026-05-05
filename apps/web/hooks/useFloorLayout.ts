'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CoffeeShopTier } from '@repo/shared-types';
import type { PrinterConfig, StationConfig } from '@/lib/pos/printer-dispatch';

interface LayoutResponse {
  tenant: {
    id: string;
    businessType: string;
    coffeeShopTier: CoffeeShopTier | null;
    hasCustomerDisplay: boolean;
  };
  stations: Array<{
    id: string;
    name: string;
    kind: string;
    hasKds: boolean;
    hasPrinter: boolean;
    printerId: string | null;
    printer: { id: string; name: string; interface: string; paperWidthMm: number; isActive: boolean } | null;
    categories: Array<{ id: string; name: string }>;
  }>;
  printers: Array<{
    id: string;
    name: string;
    model: string | null;
    interface: string;
    address: string | null;
    paperWidthMm: number;
    printsReceipts: boolean;
    printsOrders: boolean;
    isActive: boolean;
  }>;
  terminals: Array<{
    id: string;
    name: string;
    code: string;
    isActive: boolean;
  }>;
  template: unknown | null;
}

/**
 * Layout query — returns the tenant's stations, printers, terminals, and CS tier.
 * Cached aggressively (60s) since it changes rarely. Used by:
 *   - POS terminal: to dispatch station tickets after order completion
 *   - Settings → Floor Layout: to render the management UI
 *   - Customer-facing display: to know if it's enabled
 */
export function useFloorLayout() {
  const query = useQuery<LayoutResponse>({
    queryKey: ['floor-layout'],
    queryFn:  () => api.get('/layouts').then((r) => r.data),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Map to the shapes printer-dispatch expects.
  const stations: StationConfig[] = (query.data?.stations ?? []).map((s) => ({
    id:          s.id,
    name:        s.name,
    hasPrinter:  s.hasPrinter,
    printerId:   s.printerId,
    categoryIds: s.categories.map((c) => c.id),
  }));

  const printers: PrinterConfig[] = (query.data?.printers ?? []).map((p) => ({
    id:             p.id,
    name:           p.name,
    interface:      p.interface as PrinterConfig['interface'],
    address:        p.address,
    paperWidthMm:   p.paperWidthMm,
    printsReceipts: p.printsReceipts,
    printsOrders:   p.printsOrders,
    isActive:       p.isActive,
  }));

  return {
    layout: query.data,
    stations,
    printers,
    terminals: query.data?.terminals ?? [],
    coffeeShopTier: query.data?.tenant.coffeeShopTier ?? null,
    hasCustomerDisplay: query.data?.tenant.hasCustomerDisplay ?? false,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
