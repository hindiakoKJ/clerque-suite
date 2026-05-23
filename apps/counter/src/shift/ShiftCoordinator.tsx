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

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import ShellHeader from '@/shell/ShellHeader';
import ShiftOpenScreen from '@/shift/ShiftOpenScreen';
import ZReadScreen, { type ZReadSummary } from '@/shift/ZReadScreen';
import { useShift } from '@/shift/ShiftProvider';
import { useBranchContext } from '@/api/BranchContext';
import { useAuth } from '@/auth/AuthProvider';
import { api, ApiHttpError } from '@/api/client';
import { enqueueOutbox } from '@/offline/db';
import { colors, radii, spacing, tap, text as textTokens, tnum } from '@/theme';
import { formatPeso } from '@/components/Money';

interface OpenShift {
  shiftId: string;
  openedAtMs: number;
  openingFloatCents: number;
}

/**
 * Server-side ShiftSummary as returned by /shifts/active. Peso amounts are
 * decimals (e.g. 14820.50); we convert to cents for the UI. Matches the
 * `ShiftSummary` interface in apps/api/src/shifts/shifts.service.ts.
 */
interface ApiShiftSummary {
  id:                  string;
  branchId:            string;
  cashierId:           string;
  openingCash:         number | string;
  openedAt:            string;
  closedAt:            string | null;
  cashSales:           number | string;
  nonCashSales:        number | string;
  totalSales:          number | string;
  orderCount:          number;
  voidCount:           number;
  paidOutTotal:        number | string;
  cashDropTotal:       number | string;
  expectedCash:        number | string;
  digitalBreakdown?:   Record<string, number | string>;
}

function toCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

interface Props {
  onMenuPress?: () => void;
  /** When true, jump straight to Z-Read (used by the drawer's "Z-Read" entry). */
  startInZRead?: boolean;
}

export default function ShiftCoordinator({ onMenuPress, startInZRead }: Props): React.ReactElement {
  const { cashier, session, tenant } = useAuth();
  const { setOptimistic } = useShift();
  const { activeBranch } = useBranchContext();
  const [openShift, setOpenShift] = useState<OpenShift | null>(null);
  const [closing, setClosing] = useState(false);
  const [liveSummary, setLiveSummary] = useState<ApiShiftSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  /**
   * Pull the real per-shift aggregates from the server when entering Z-read.
   * The server already computes cash/non-cash sales, order count, void count,
   * paid-out totals, and the expected cash in the drawer — Counter only
   * needs to render. Falls back to the locally-known opening float if the
   * shift hasn't synced to the server yet (outbox still draining).
   */
  const refreshSummary = useCallback(async (): Promise<void> => {
    if (!activeBranch?.id) return;
    setSummaryLoading(true);
    try {
      const row = await api.get<ApiShiftSummary | null>(
        `/shifts/active?branchId=${encodeURIComponent(activeBranch.id)}`,
      );
      setLiveSummary(row ?? null);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 404) {
        setLiveSummary(null); // no shift server-side yet — outbox not drained
      } else {
        // eslint-disable-next-line no-console
        console.warn('[shift] summary fetch failed:', err);
      }
    } finally {
      setSummaryLoading(false);
    }
  }, [activeBranch?.id]);

  // Refresh whenever we enter the Z-read flow OR the cashier is viewing
  // the open-shift status panel. Background polling at 30s keeps the
  // running totals fresh without hammering the API.
  useEffect(() => {
    if (!openShift) return;
    if (closing || startInZRead) {
      void refreshSummary();
      return;
    }
    void refreshSummary();
    const id = setInterval(() => { void refreshSummary(); }, 30_000);
    return () => clearInterval(id);
  }, [closing, startInZRead, openShift, refreshSummary]);

  // Surface a "missing context" view when called before cashier sign-in
  // completes (drawer is gated by auth so this is mostly belt-and-braces).
  if (!cashier && !session) {
    return (
      <View style={s.root}>
        <ShellHeader title="Shift" onMenuPress={onMenuPress} />
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
          <ShellHeader title="Shift" onMenuPress={onMenuPress} />
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
        <ShellHeader title="Shift" onMenuPress={onMenuPress} />
        <ZReadScreen
          summary={buildLiveSummary(openShift, cashierName, tenant?.isVatRegistered ?? false, liveSummary)}
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
            setOptimistic(null);
          }}
        />
      </View>
    );
  }

  // Closing path from the "Close shift" CTA on the open-shift status view.
  if (closing && openShift) {
    return (
      <View style={s.root}>
        <ShellHeader title="Shift" onMenuPress={onMenuPress} />
        <ZReadScreen
          summary={buildLiveSummary(openShift, cashierName, tenant?.isVatRegistered ?? false, liveSummary)}
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
            setOptimistic(null);
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
        <ShellHeader title="Shift" onMenuPress={onMenuPress} />
        <View style={s.statusCard}>
          <Text style={s.statusTitle}>Shift is open</Text>
          <Text style={s.statusSub}>{cashierName} · {elapsedMin}m elapsed</Text>

          <View style={s.statusRow}>
            <Text style={s.statusLabel}>Opening float</Text>
            <Text style={[s.statusValue, tnum]}>{formatPeso(openShift.openingFloatCents)}</Text>
          </View>

          {liveSummary ? (
            <>
              <View style={s.statusRow}>
                <Text style={s.statusLabel}>Gross sales · so far</Text>
                <Text style={[s.statusValue, tnum]}>{formatPeso(toCents(liveSummary.totalSales))}</Text>
              </View>
              <View style={s.statusRow}>
                <Text style={s.statusLabel}>Transactions</Text>
                <Text style={[s.statusValue, tnum]}>{liveSummary.orderCount}</Text>
              </View>
              <View style={s.statusRow}>
                <Text style={s.statusLabel}>Expected in drawer</Text>
                <Text style={[s.statusValue, tnum]}>{formatPeso(toCents(liveSummary.expectedCash))}</Text>
              </View>
            </>
          ) : summaryLoading ? (
            <Text style={s.statusSub}>Loading sales totals…</Text>
          ) : (
            <Text style={s.statusSub}>Waiting for sync — totals appear when online.</Text>
          )}

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
      <ShellHeader title="Shift" onMenuPress={onMenuPress} />
      <ShiftOpenScreen
        cashierId={cashierId}
        cashierName={cashierName}
        onOpened={async (openingFloatCents) => {
          // CRITICAL: open the shift on the server FIRST so subsequent
          // orders carry the real server CUID. Without this, /shifts/active
          // can't aggregate cash sales (it joins on Order.shiftId, which
          // would be null otherwise) — the cashier's Z-read would always
          // show 0 sales no matter how many orders they ring.
          let serverId  = '';
          let serverAt  = new Date().toISOString();
          if (activeBranch?.id) {
            try {
              const created = await api.post<{ id: string; openedAt: string }>(
                '/shifts',
                {
                  branchId:    activeBranch.id,
                  openingCash: openingFloatCents / 100,
                },
              );
              serverId = created.id;
              serverAt = created.openedAt;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[shift] POST /shifts failed, falling back to local id:', err);
              // Offline fallback — local id is generated below. Subsequent
              // sales rung in this state will need a manual reconciliation
              // when the cashier next has WiFi (V2 work).
            }
          }
          const shiftId    = serverId || `shift_${Date.now()}`;
          const openedAtMs = new Date(serverAt).getTime();
          setOpenShift({ shiftId, openedAtMs, openingFloatCents });
          setOptimistic({
            id:                shiftId,
            openedAt:          serverAt,
            cashierId,
            cashierName,
            openingFloatCents,
            branchId:          activeBranch?.id ?? '',
          });
        }}
      />
    </View>
  );
}

/**
 * Build the ZReadSummary the UI renders. When the server has the shift,
 * we project its computed aggregates (cash sales, non-cash sales, order
 * count, void count, expected cash, per-method digital breakdown) into
 * the UI shape, converting peso decimals to ₱ cents.
 *
 * When the server doesn't know about the shift yet (outbox hasn't drained),
 * we fall back to the cashier's locally-known opening float so the Z-read
 * still renders coherently — sales just show as 0 until sync catches up.
 */
function buildLiveSummary(
  open: OpenShift,
  cashierName: string,
  isVat: boolean,
  live: ApiShiftSummary | null,
): ZReadSummary {
  if (!live) {
    return {
      shiftId: open.shiftId,
      cashierName,
      openedAtMs: open.openedAtMs,
      grossSalesCents: 0,
      discountsCents: 0,
      txnCount: 0,
      tender: { cashCents: 0, gcashCents: 0, paymayaCents: 0, cardCents: 0, qrPhCents: 0 },
      openingFloatCents: open.openingFloatCents,
      voidsCount: 0,
      voidsCents: 0,
      orRange: { from: 0, to: 0 },
      isVatRegistered: isVat,
    };
  }

  // Digital breakdown keys are the server's `PaymentMethod` enum values
  // (see packages/db/prisma/schema.prisma):
  //   GCASH_PERSONAL / GCASH_BUSINESS  → GCash column
  //   MAYA_PERSONAL  / MAYA_BUSINESS   → PayMaya column
  //   CARD                             → Card column (EDC terminal)
  //   QR_PH                            → QR PH column (BSP InstaPay)
  //
  // Lumping QR_PH into Card would break MSME reconciliation — card sales
  // settle through an acquirer with MDR, QR PH settles through the bank
  // with zero or near-zero fee. They MUST stay separate.
  const digital  = live.digitalBreakdown ?? {};
  const gcash    = toCents(digital['GCASH_PERSONAL']) + toCents(digital['GCASH_BUSINESS']);
  const paymaya  = toCents(digital['MAYA_PERSONAL'])  + toCents(digital['MAYA_BUSINESS']);
  const card     = toCents(digital['CARD']);
  const qrPh     = toCents(digital['QR_PH']);
  // Future-proof: any unknown PaymentMethod enum value (e.g. WeChat Pay,
  // AliPay added later) collapses into Card so totals still reconcile. The
  // engineer adding the new method should also extend this switch.
  const unknown  = Object.entries(digital)
    .filter(([k]) => !['GCASH_PERSONAL','GCASH_BUSINESS','MAYA_PERSONAL','MAYA_BUSINESS','CARD','QR_PH'].includes(k))
    .reduce((acc, [, v]) => acc + toCents(v), 0);
  const cardCol  = card + unknown;

  const cashCents    = toCents(live.cashSales);
  const totalSales   = toCents(live.totalSales);
  const openingFloat = toCents(live.openingCash) || open.openingFloatCents;

  return {
    shiftId:           live.id || open.shiftId,
    cashierName,
    openedAtMs:        live.openedAt ? new Date(live.openedAt).getTime() : open.openedAtMs,
    grossSalesCents:   totalSales,
    // The server doesn't surface a separate discounts total today; it nets
    // them out of cashSales/nonCashSales already. Leave at 0 until the
    // backend exposes it explicitly. (Voids stay separate below.)
    discountsCents:    0,
    txnCount:          live.orderCount,
    tender: {
      cashCents,
      gcashCents:   gcash,
      paymayaCents: paymaya,
      cardCents:    cardCol,
      qrPhCents:    qrPh,
    },
    openingFloatCents: openingFloat,
    voidsCount:        live.voidCount,
    voidsCents:        0, // server returns count only — value sum is a follow-up
    orRange:           { from: 0, to: 0 }, // OR range surfaced separately when /shifts/:id/or-range lands
    cashInCents:       0,
    cashOutCents:      toCents(live.paidOutTotal) + toCents(live.cashDropTotal),
    isVatRegistered:   isVat,
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
