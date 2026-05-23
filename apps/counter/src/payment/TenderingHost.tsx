/**
 * Clerque Counter — TenderingHost
 *
 * Singleton host that bridges imperative `openTendering()` calls to a full-
 * screen Modal hosting <TenderingScreen />, then auto-routes to a Receipt
 * modal once the cashier confirms payment. Mirrors the SupervisorPinHost /
 * BarcodeScannerHost pattern (see App.tsx — host mounted once near root).
 *
 * Flow per `openTendering()` call:
 *   1. Caller (a vertical terminal's "Charge ₱X" button) awaits
 *      `openTendering({ cart, totalCents, discountCents? })`.
 *   2. Modal opens with TenderingScreen — cashier picks Cash/GCash/etc and
 *      confirms.
 *   3. We call `submitOrder({ cart, payments, branchId })` and on success
 *      transition the same modal to ReceiptScreen.
 *   4. ReceiptScreen auto-prints + offers "Start next sale" which resolves
 *      the original promise with `{ orderNumber, offline }` and closes the
 *      modal. The caller is responsible for `cartStore.clear()` (we don't
 *      reach into the store here — keeps the host vertical-agnostic).
 *   5. If the cashier hits Back on TenderingScreen, the promise resolves
 *      with `null` (cancel).
 *
 * Errors during submit surface inline in the modal with Retry / Cancel
 * options; we never silently throw away a tendered cart.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Snackbar } from 'react-native-paper';

import TenderingScreen from '@/payment/TenderingScreen';
import ReceiptScreen from '@/receipt/ReceiptScreen';
import { useAuth } from '@/auth/AuthProvider';
import { useBranchContext } from '@/api/BranchContext';
import { useIsShiftOpen, useShift } from '@/shift/ShiftProvider';
import NoShiftSheet from '@/shift/NoShiftSheet';
import { navigate } from '@/shell/navigationRef';
import { submitOrder, type SubmitOrderResult } from '@/api/orderSubmit';
import { colors, radii, spacing, text as textTokens } from '@/theme';
import type { CartPayment, CartState } from '@/types';

// --------------------------------------------------------------------------
// Imperative API
// --------------------------------------------------------------------------

export interface OpenTenderingOptions {
  /** Snapshot of the cart at the moment Charge was tapped. */
  cart: CartState;
  /** ₱ cents — pre-computed total (the cart store's `total()` selector). */
  totalCents: number;
  /** ₱ cents — discount already netted out of totalCents (header chip only). */
  discountCents?: number;
  /** ₱ cents — subtotal pre-discount (receipt rendering). Defaults to totalCents. */
  subtotalCents?: number;
}

export interface OpenTenderingResult {
  orderNumber: string;
  offline: boolean;
}

type Handler = (opts: OpenTenderingOptions) => Promise<OpenTenderingResult | null>;

let handler: Handler | null = null;

export function _registerTenderingHandler(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/**
 * Open the tendering modal. Resolves with the assigned (or pending-…) OR
 * number when the cashier completes the sale + dismisses the receipt;
 * resolves with `null` if the cashier cancels from the tendering screen.
 *
 * Rejects only if the host is not mounted (programmer error — add the host
 * to App.tsx near the navigator root).
 */
export function openTendering(opts: OpenTenderingOptions): Promise<OpenTenderingResult | null> {
  if (!handler) {
    return Promise.reject(
      new Error(
        'openTendering called before <TenderingHost /> mounted. ' +
        'Add the host once near the navigator root.',
      ),
    );
  }
  return handler(opts);
}

// --------------------------------------------------------------------------
// Host component
// --------------------------------------------------------------------------

type Stage = 'tender' | 'submitting' | 'receipt';

interface Pending {
  opts: OpenTenderingOptions;
  resolve: (v: OpenTenderingResult | null) => void;
}

export default function TenderingHost(): React.ReactElement | null {
  const { tenant, cashier, session } = useAuth();
  const { activeBranch } = useBranchContext();
  const shiftIsOpen = useIsShiftOpen();
  const { active: activeShift } = useShift();

  const [pending, setPending] = useState<Pending | null>(null);
  const [stage, setStage] = useState<Stage>('tender');
  const [capturedPayments, setCapturedPayments] = useState<CartPayment[]>([]);
  const [changeCents, setChangeCents] = useState(0);
  const [result, setResult] = useState<SubmitOrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the resolver in a ref so unmount mid-flight rejects cleanly.
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    const unregister = _registerTenderingHandler((opts) =>
      new Promise<OpenTenderingResult | null>((resolve) => {
        setPending({ opts, resolve });
        setStage('tender');
        setCapturedPayments([]);
        setChangeCents(0);
        setResult(null);
        setError(null);
      }),
    );
    return () => {
      if (pendingRef.current) {
        pendingRef.current.resolve(null);
        pendingRef.current = null;
      }
      unregister();
    };
  }, []);

  const closeWithCancel = useCallback(() => {
    if (pending) pending.resolve(null);
    setPending(null);
  }, [pending]);

  const closeWithSuccess = useCallback((res: SubmitOrderResult) => {
    if (pending) pending.resolve({ orderNumber: res.orderNumber, offline: res.offline });
    setPending(null);
  }, [pending]);

  const doSubmit = useCallback(
    async (payments: CartPayment[], change: number) => {
      if (!pending) return;
      if (!activeBranch?.id) {
        setError('No active branch — pick one in Settings before charging.');
        return;
      }
      setStage('submitting');
      setError(null);
      try {
        const res = await submitOrder({
          cart: pending.opts.cart,
          payments,
          branchId: activeBranch.id,
          // Critical: passing shiftId is what lets /shifts/active aggregate
          // the order into cashSales / nonCashSales. Without it, the Z-read
          // always shows 0 even after a successful sale.
          shiftId: activeShift?.id,
          isVatRegistered: tenant?.isVatRegistered ?? false,
        });
        // Gas station: if this sale was rung from a fuel dispense, link the
        // Order back to the FuelDispense so the audit log + reports tie out.
        // Imported lazily to avoid an import cycle for non-gas tenants.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pumps = require('@/shell/phone/PhonePumpsScreen') as {
            pendingDispenseId: string | null;
            clearPendingDispenseId: () => void;
          };
          if (pumps.pendingDispenseId && res?.orderId) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { api: client } = require('@/api/client') as typeof import('@/api/client');
            await client.post(`/fuel/dispenses/${pumps.pendingDispenseId}/attach-order`, {
              orderId: res.orderId,
            });
            pumps.clearPendingDispenseId();
          }
        } catch {
          /* best-effort; failure is non-blocking */
        }
        setResult(res);
        setCapturedPayments(payments);
        setChangeCents(change);
        setStage('receipt');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not submit order.';
        setError(msg);
        setStage('tender');
      }
    },
    [pending, activeBranch?.id, tenant?.isVatRegistered],
  );

  if (!pending) return null;

  // Hard shift gate — phone gates upstream in PhoneCartDrawer, this catches
  // tablet terminals (FB/Retail/Pharmacy) which call openTendering directly.
  // Cashier sees a friendly sheet instead of the Tendering UI and is sent
  // to the Shift tab/drawer to count the opening float first.
  if (!shiftIsOpen) {
    return (
      <Modal
        visible
        animationType="fade"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={closeWithCancel}
      >
        <NoShiftSheet
          visible
          onCancel={closeWithCancel}
          onGoToShift={() => {
            closeWithCancel();
            navigate('Shift');
          }}
        />
      </Modal>
    );
  }

  // Build a synthetic OR number for the receipt screen. When offline we get
  // a `pending-…` placeholder; the receipt expects a numeric OR# for the
  // visual `#000123` header so we hash the placeholder down to a 6-digit
  // surrogate. Real OR# fills in after sync via the Orders screen.
  const orNumberForReceipt = ((): number => {
    if (!result) return 0;
    if (!result.offline) {
      const parsed = Number.parseInt(result.orderNumber, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    // Hash placeholder → 6-digit pseudo-number for display.
    let h = 0;
    for (let i = 0; i < result.clientUuid.length; i++) {
      h = (h * 31 + result.clientUuid.charCodeAt(i)) >>> 0;
    }
    return h % 1_000_000;
  })();

  const cashierName =
    cashier?.name ?? session?.user.name ?? 'Cashier';

  // We need a tenant for the receipt; fall back to a minimal placeholder so
  // the screen renders even if /auth/me hasn't returned yet. In practice the
  // charge button is gated behind cashier sign-in so tenant will be present.
  const tenantForReceipt = tenant ?? {
    id: '—',
    name: 'Clerque Counter',
    businessType: 'OTHER' as const,
    planCode: 'SOLO_LITE' as const,
    isVatRegistered: false,
    tin: '—',
    taxStatus: 'NON_VAT' as const,
    nextOrNumber: 1,
    planFeatures: {
      maxRecipes: 0,
      maxAdvancedInventoryItems: 0,
      salesLeadDelegation: 0,
      customerPhoneLookup: false,
      receiptCustomization: 'none' as const,
      advancedReports: false,
      loyaltyPro: false,
      autoBackup: false,
      fifoValuation: false,
      makerCheckerVoids: false,
      auditLog: false,
      customRoles: false,
      apiAccess: 'none' as const,
    },
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={stage === 'receipt' ? undefined : closeWithCancel}
    >
      <View style={hostStyles.root}>
        {stage === 'receipt' && result ? (
          <ReceiptScreen
            tenant={tenantForReceipt}
            cart={pending.opts.cart}
            orNumber={orNumberForReceipt}
            issuedAt={Date.now()}
            cashierName={cashierName}
            subtotalCents={pending.opts.subtotalCents ?? pending.opts.totalCents}
            discountCents={pending.opts.discountCents ?? 0}
            totalCents={pending.opts.totalCents}
            payments={capturedPayments}
            changeCents={changeCents}
            onDone={() => closeWithSuccess(result)}
            autoDismissMs={0 /* Caller-driven: tap "Start next sale" to dismiss */}
          />
        ) : (
          <>
            <TenderingScreen
              cart={pending.opts.cart}
              totalCents={pending.opts.totalCents}
              discountCents={pending.opts.discountCents}
              onPaid={(payments, change) => { void doSubmit(payments, change); }}
              onCancel={closeWithCancel}
            />
            {stage === 'submitting' ? (
              <View style={hostStyles.submitOverlay} pointerEvents="auto">
                <View style={hostStyles.submitCard}>
                  <Text style={hostStyles.submitTitle}>Submitting sale…</Text>
                  <Text style={hostStyles.submitSub}>
                    Recording the order. This will queue offline if the network is down.
                  </Text>
                </View>
              </View>
            ) : null}
          </>
        )}

        <Snackbar
          visible={!!error}
          onDismiss={() => setError(null)}
          duration={6000}
          action={{ label: 'Dismiss', onPress: () => setError(null) }}
        >
          {error ?? ''}
        </Snackbar>
      </View>
    </Modal>
  );
}

const hostStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  submitOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s5,
  },
  submitCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.s6,
    maxWidth: 420,
    alignItems: 'center',
    gap: spacing.s2,
  },
  submitTitle: { ...textTokens.displaySm, color: colors.ink },
  submitSub: { ...textTokens.bodySm, color: colors.muted, textAlign: 'center' },
});
