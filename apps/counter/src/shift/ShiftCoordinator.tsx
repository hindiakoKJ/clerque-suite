/**
 * Clerque Counter — Shift coordinator
 *
 * Routes the drawer's "Shift" entry between three states:
 *
 *   1. No shift open → render <ShiftOpenScreen /> so the cashier can count
 *      the opening drawer and queue a `shift.open` outbox row.
 *   2. Shift open → render an in-place status panel summarising the open
 *      shift, with a "Close shift (Z-read)" CTA that flips to the Z-Read
 *      screen.
 *   3. Closing → renders <ZReadScreen /> with a minimal in-memory summary
 *      (live Z-Read aggregation against the offline DB is a follow-up).
 *
 * Shift state lives in local React state for now (a richer ShiftProvider
 * with persisted state + sync is a follow-up sprint). On close we clear the
 * local state so the next visit lands back on ShiftOpenScreen.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import TopBar from '@/shell/TopBar';
import ShiftOpenScreen from '@/shift/ShiftOpenScreen';
import ZReadScreen, { type ZReadSummary } from '@/shift/ZReadScreen';
import { useAuth } from '@/auth/AuthProvider';
import { enqueueOutbox } from '@/offline/db';
import { colors, radii, spacing, tap, text as textTokens, tnum } from '@/theme';
import { formatPeso } from '@/components/Money';

interface OpenShift {
  shiftId: string;
  openedAtMs: number;
  openingFloatCents: number;
}

interface Props {
  onMenuPress?: () => void;
  /** When true, jump straight to Z-Read (used by the drawer's "Z-Read" entry). */
  startInZRead?: boolean;
}

export default function ShiftCoordinator({ onMenuPress, startInZRead }: Props): React.ReactElement {
  const { cashier, session, tenant } = useAuth();
  const [openShift, setOpenShift] = useState<OpenShift | null>(null);
  const [closing, setClosing] = useState(false);

  // Surface a "missing context" view when called before cashier sign-in
  // completes (drawer is gated by auth so this is mostly belt-and-braces).
  if (!cashier && !session) {
    return (
      <View style={s.root}>
        <TopBar onMenuPress={onMenuPress} />
        <View style={s.empty}>
          <Text style={s.emptyTitle}>Sign in to manage shifts</Text>
        </View>
      </View>
    );
  }

  const cashierId = cashier?.id ?? session?.user.id ?? 'unknown';
  const cashierName = cashier?.name ?? session?.user.name ?? 'Cashier';

  // Z-Read entry: only valid when a shift is open. Show a friendly empty
  // state if the cashier hit the drawer entry without an active shift.
  if (startInZRead) {
    if (!openShift) {
      return (
        <View style={s.root}>
          <TopBar onMenuPress={onMenuPress} />
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No open shift to close</Text>
            <Text style={s.emptySub}>
              Open a shift from the "Shift" entry first; the Z-read will be available once sales start.
            </Text>
          </View>
        </View>
      );
    }
    return (
      <View style={s.root}>
        <TopBar onMenuPress={onMenuPress} />
        <ZReadScreen
          summary={buildEmptySummary(openShift, cashierName, tenant?.isVatRegistered ?? false)}
          onClose={async (result) => {
            await enqueueOutbox('shift.close', {
              shiftId: openShift.shiftId,
              cashierId,
              closedAt: new Date().toISOString(),
              countedCashCents: result.countedCashCents,
              varianceCents: result.varianceCents,
              notes: result.notes,
            });
            setOpenShift(null);
            setClosing(false);
          }}
        />
      </View>
    );
  }

  // Closing path from the "Close shift" CTA on the open-shift status view.
  if (closing && openShift) {
    return (
      <View style={s.root}>
        <TopBar onMenuPress={onMenuPress} />
        <ZReadScreen
          summary={buildEmptySummary(openShift, cashierName, tenant?.isVatRegistered ?? false)}
          onCancel={() => setClosing(false)}
          onClose={async (result) => {
            await enqueueOutbox('shift.close', {
              shiftId: openShift.shiftId,
              cashierId,
              closedAt: new Date().toISOString(),
              countedCashCents: result.countedCashCents,
              varianceCents: result.varianceCents,
              notes: result.notes,
            });
            setOpenShift(null);
            setClosing(false);
          }}
        />
      </View>
    );
  }

  // Status view when a shift is already open.
  if (openShift) {
    const elapsedMin = Math.max(0, Math.round((Date.now() - openShift.openedAtMs) / 60_000));
    return (
      <View style={s.root}>
        <TopBar onMenuPress={onMenuPress} />
        <View style={s.statusCard}>
          <Text style={s.statusTitle}>Shift is open</Text>
          <Text style={s.statusSub}>{cashierName} · {elapsedMin}m elapsed</Text>
          <View style={s.statusRow}>
            <Text style={s.statusLabel}>Opening float</Text>
            <Text style={[s.statusValue, tnum]}>{formatPeso(openShift.openingFloatCents)}</Text>
          </View>
          <Pressable
            onPress={() => setClosing(true)}
            style={({ pressed }) => [s.closeBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.closeBtnLabel}>Close shift · Z-read</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Default: open shift.
  return (
    <View style={s.root}>
      <TopBar onMenuPress={onMenuPress} />
      <ShiftOpenScreen
        cashierId={cashierId}
        cashierName={cashierName}
        onOpened={(openingFloatCents) => {
          setOpenShift({
            shiftId: `shift_${Date.now()}`,
            openedAtMs: Date.now(),
            openingFloatCents,
          });
        }}
      />
    </View>
  );
}

function buildEmptySummary(
  open: OpenShift,
  cashierName: string,
  isVat: boolean,
): ZReadSummary {
  return {
    shiftId: open.shiftId,
    cashierName,
    openedAtMs: open.openedAtMs,
    grossSalesCents: 0,
    discountsCents: 0,
    txnCount: 0,
    tender: { cashCents: 0, gcashCents: 0, paymayaCents: 0, cardCents: 0 },
    openingFloatCents: open.openingFloatCents,
    voidsCount: 0,
    voidsCents: 0,
    orRange: { from: 0, to: 0 },
    isVatRegistered: isVat,
  };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.s6, gap: spacing.s2 },
  emptyTitle: { ...textTokens.displaySm, color: colors.ink },
  emptySub: { ...textTokens.bodySm, color: colors.muted, textAlign: 'center' },

  statusCard: {
    margin: spacing.s5,
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s3,
  },
  statusTitle: { ...textTokens.displayMd, color: colors.ink },
  statusSub: { ...textTokens.bodySm, color: colors.muted },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.s3,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  statusLabel: { ...textTokens.body, color: colors.muted },
  statusValue: { ...textTokens.displaySm, color: colors.ink },

  closeBtn: {
    marginTop: spacing.s4,
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnLabel: { ...textTokens.cashierLg, color: colors.onPrimary },
});
