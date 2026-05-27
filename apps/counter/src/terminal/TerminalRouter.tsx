import React, { lazy, Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing } from '@/theme/tokens';
import type { BusinessType, TenantConfig } from '@/types';
import { useAuth } from '@/auth/AuthProvider';
import FBTerminal from './fb/FBTerminal';
import RetailTerminal from './retail/RetailTerminal';

// Lazy verticals (other agents own these screens).
const LaundryTerminalLazy = lazy(() =>
  import('./laundry/LaundryTerminal').then((mod) => {
    // The Laundry module may export either a default or a named `LaundryTerminal`.
    const Component =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mod as any).default ?? (mod as any).LaundryTerminal;
    return { default: Component };
  }),
);

const PharmacyTerminalLazy = lazy(() =>
  import('./pharmacy/PharmacyTerminal').then((mod) => {
    const Component =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mod as any).default ?? (mod as any).PharmacyTerminal;
    return { default: Component };
  }),
);

interface TerminalRouterProps {
  /** Provided by AuthProvider context once that lands. Pass at least
   *  businessType so the router can switch. */
  tenant?: Pick<TenantConfig, 'businessType' | 'planFeatures'>;
}

function SuspenseLoader() {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export default function TerminalRouter({ tenant: tenantProp }: TerminalRouterProps) {
  // Fall back to the live AuthProvider tenant when no prop is passed (the
  // drawer mounts <TerminalRouter /> with no props — earlier scaffolds threaded
  // tenant in via context, which we now read directly to avoid prop-drilling).
  const { tenant: authTenant } = useAuth();
  const tenant = tenantProp ?? authTenant;
  const businessType: BusinessType = tenant?.businessType ?? 'COFFEE_SHOP';

  switch (businessType) {
    // ── Food & Beverage — all 6 BusinessTypes share FBTerminal ─────────
    case 'COFFEE_SHOP':
    case 'RESTAURANT':
    case 'BAKERY':
    case 'FOOD_STALL':
    case 'BAR_LOUNGE':
    case 'CATERING':
    // Legacy JWT values (pre-Sprint-12 tenants) — keep mapped to FB.
    case 'COFFEE_FB':
    case 'F_AND_B':
      return <FBTerminal />;

    // ── Retail — convenience store, sari-sari, boutique ───────────────
    case 'RETAIL':
    case 'RETAIL_SARISARI': // legacy JWT
    // Verticals without a dedicated tablet terminal yet fall back to
    // retail (cart-based sale with no recipe BOM). Better than the
    // "not wired" placeholder. Specialised terminals can replace these
    // cases when they ship.
    case 'SERVICE':
    case 'MANUFACTURING':
    case 'TRUCKING':
    case 'CONSTRUCTION':
    case 'MEDICAL_EQUIPMENT': // DME — phone has Rentals tab; tablet uses retail terminal until DME tablet ships
    case 'GAS_STATION':       // Gas — phone has Pumps tab; tablet C-store uses retail terminal
      return (
        <RetailTerminal
          customerPhoneLookupEnabled={tenant?.planFeatures?.customerPhoneLookup === true}
        />
      );

    case 'LAUNDRY':
      return (
        <Suspense fallback={<SuspenseLoader />}>
          <LaundryTerminalLazy />
        </Suspense>
      );

    case 'PHARMACY':
      return (
        <Suspense fallback={<SuspenseLoader />}>
          <PharmacyTerminalLazy />
        </Suspense>
      );

    default:
      // Unknown BusinessType — render the cart-based RetailTerminal so
      // the cashier can still ring sales while support investigates.
      return (
        <RetailTerminal
          customerPhoneLookupEnabled={tenant?.planFeatures?.customerPhoneLookup === true}
        />
      );
  }
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s6,
  },
});
