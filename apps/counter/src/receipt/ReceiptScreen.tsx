/**
 * Clerque Counter — Receipt screen
 *
 * Wraps <Receipt /> in a scrollable view with the right-rail actions panel
 * from `ReceiptTablet`. Auto-routes back to Terminal after a configurable
 * inactivity timeout (default 10s).
 *
 * On mount we fire-and-forget a print to the paired Bluetooth printer —
 * no dialog. Failures surface in a Snackbar with Retry. Manual reprint
 * stays available on the actions panel.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';

import {
  colors,
  radii,
  spacing,
  tap,
  text as textTokens,
} from '@/theme/tokens';
import Pill from '@/components/Pill';
import Receipt, { ReceiptProps } from './Receipt';
import { usePrinter } from './usePrinter';
import type { ReceiptForPrinter } from './receiptToEscPos';

export interface ReceiptScreenProps extends ReceiptProps {
  /** Called when the cashier hits "Start next sale" or the auto-timeout fires. */
  onDone: () => void;
  onReprint?: () => void;
  onEmail?: () => void;
  onSms?: () => void;
  /** ms — 0 disables auto-dismiss. */
  autoDismissMs?: number;
}

export default function ReceiptScreen({
  onDone,
  onReprint,
  onEmail,
  onSms,
  autoDismissMs = 10_000,
  ...receipt
}: ReceiptScreenProps): React.ReactElement {
  const printer = usePrinter();
  const [printing, setPrinting] = useState(false);
  const [printedAt, setPrintedAt] = useState<number | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const autoFiredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss timer; resets on activity.
  useEffect(() => {
    if (!autoDismissMs) return;
    timerRef.current = setTimeout(onDone, autoDismissMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [autoDismissMs, onDone]);

  const bumpActivity = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (autoDismissMs) {
      timerRef.current = setTimeout(onDone, autoDismissMs);
    }
  };

  const receiptPayload: ReceiptForPrinter = {
    tenant: receipt.tenant,
    cart: receipt.cart,
    orNumber: receipt.orNumber,
    issuedAt: receipt.issuedAt,
    cashierName: receipt.cashierName,
    subtotalCents: receipt.subtotalCents,
    discountCents: receipt.discountCents,
    totalCents: receipt.totalCents,
    payments: receipt.payments,
    changeCents: receipt.changeCents,
    vat: receipt.vat,
    isRefund: receipt.isRefund,
    originalOrNumber: receipt.originalOrNumber,
  };

  const fire = useCallback(
    async (manual: boolean) => {
      setPrinting(true);
      setPrintError(null);
      try {
        await printer.print(receiptPayload);
        setPrintedAt(Date.now());
        if (manual) onReprint?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Print failed.';
        setPrintError(msg);
      } finally {
        setPrinting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [printer, receipt.orNumber],
  );

  // Auto-fire once on mount — no dialog.
  useEffect(() => {
    if (autoFiredRef.current) return;
    autoFiredRef.current = true;
    void fire(false);
  }, [fire]);

  const handlePrint = async () => {
    bumpActivity();
    await fire(true);
  };

  return (
    <View style={s.root} onTouchStart={bumpActivity}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>
            Sale complete · #{receipt.orNumber.toString().padStart(6, '0')}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.s3, marginTop: 4 }}>
            <Pill tone="success" dot>Paid</Pill>
            <Text style={s.metaInline}>
              Cashier {receipt.cashierName}
            </Text>
          </View>
        </View>
        {printedAt ? (
          <Pill tone="info" dot>Sent to printer</Pill>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.body}
        onScrollBeginDrag={bumpActivity}
      >
        <Receipt {...receipt} />

        <View style={s.actions}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Receipt for customer</Text>
            <Pressable
              style={s.actionRow}
              onPress={handlePrint}
              disabled={printing}
            >
              <Text style={s.actionText}>
                {printing ? 'Printing…' : 'Re-print receipt'}
              </Text>
            </Pressable>
            <Pressable style={s.actionRow} onPress={() => { bumpActivity(); onSms?.(); }}>
              <Text style={s.actionText}>Send via SMS</Text>
            </Pressable>
            <Pressable style={s.actionRow} onPress={() => { bumpActivity(); onEmail?.(); }}>
              <Text style={s.actionText}>Email receipt</Text>
            </Pressable>
          </View>

          <Pressable
            style={s.primaryCta}
            onPress={() => { bumpActivity(); onDone(); }}
          >
            <Text style={s.primaryCtaText}>Start next sale →</Text>
          </Pressable>

          <View style={s.note}>
            <Text style={s.noteText}>
              BIR · This sale is appended to your OR sequence (gap-free).
              Daily Z-read closes at 23:59 or when shift ends.
            </Text>
          </View>
        </View>
      </ScrollView>

      <Snackbar
        visible={printError !== null}
        onDismiss={() => setPrintError(null)}
        duration={6000}
        action={{
          label: 'Retry',
          onPress: () => { void fire(true); },
        }}
      >
        {printError ?? ''}
      </Snackbar>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s5,
    paddingHorizontal: spacing.s6,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  title: {
    ...textTokens.displaySm,
    color: colors.ink,
  },
  metaInline: {
    ...textTokens.caption,
    color: colors.muted,
  },
  body: {
    paddingVertical: spacing.s6,
    paddingHorizontal: spacing.s7,
    flexDirection: 'row',
    gap: spacing.s7,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  actions: {
    flex: 1,
    maxWidth: 480,
    gap: spacing.s3,
  },
  card: {
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s3,
  },
  cardLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  actionRow: {
    paddingVertical: spacing.s4,
    paddingHorizontal: spacing.s4,
    borderRadius: radii.md,
    backgroundColor: colors.creamSoft,
  },
  actionText: {
    ...textTokens.bodyLg,
    color: colors.ink,
    fontWeight: '600',
  },
  primaryCta: {
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.s3,
  },
  primaryCtaText: {
    ...textTokens.cashierLg,
    color: colors.onPrimary,
  },
  note: {
    padding: spacing.s4,
    backgroundColor: colors.cream,
    borderRadius: radii.sm,
  },
  noteText: {
    ...textTokens.caption,
    color: colors.muted,
    lineHeight: 18,
  },
});
