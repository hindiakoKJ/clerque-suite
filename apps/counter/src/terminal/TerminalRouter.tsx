import React, { lazy, Suspense } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing, text as textTokens } from '@/theme/tokens';
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

function GenericFallback() {
  return (
    <View style={styles.fallback}>
      <Text style={[textTokens.displaySm, { color: colors.ink }]}>Counter</Text>
      <Text style={[textTokens.body, { color: colors.muted, marginTop: spacing.s2 }]}>
        This business type isn't wired to a specialised terminal yet.
      </Text>
    </View>
  );
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
  const businessType: BusinessType = tenant?.businessType ?? 'COFFEE_FB';

  switch (businessType) {
    case 'COFFEE_FB':
    case 'F_AND_B':
      return <FBTerminal />;

    case 'RETAIL_SARISARI':
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
      return <GenericFallback />;
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
