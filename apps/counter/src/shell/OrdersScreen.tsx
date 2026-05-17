/**
 * Clerque Counter — Orders (today)
 *
 * Lists today's orders (most recent first). Tap → opens a detail bottom
 * sheet with the line items, payments, and a "Re-print receipt" action
 * that calls the printer service (Console fallback under Expo Go).
 *
 * Fetched from `GET /orders?day=today&branchId=X`. Pull-to-refresh wired.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Card, Chip, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useQuery } from '@tanstack/react-query';

import { api, ApiHttpError } from '@/api/client';
import { useBranchContext } from '@/api/BranchContext';
import TopBar from '@/shell/TopBar';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';
import type { CartLine, CartPayment, PaymentMethod } from '@/types';

type OrderStatus = 'PAID' | 'VOIDED' | 'REFUNDED';

interface OrderSummary {
  id: string;
  orNumber: number;
  issuedAt: string;
  itemCount: number;
  totalCents: number;
  status: OrderStatus;
  payments: CartPayment[];
  lines?: CartLine[];
}

// Printer service — optional import (the printer agent owns wiring usePrinter).
type PrinterApi = {
  print: (receipt: unknown) => Promise<void>;
};
async function loadPrinter(): Promise<PrinterApi | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/receipt/printerService') as {
      ConsolePrinterService?: new () => PrinterApi;
    };
    if (mod.ConsolePrinterService) return new mod.ConsolePrinterService();
    return null;
  } catch {
    return null;
  }
}

interface Props {
  onMenuPress?: () => void;
}

export default function OrdersScreen({ onMenuPress }: Props): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id ?? null;

  const { data, isLoading, isRefetching, refetch, error } = useQuery<OrderSummary[]>({
    queryKey: ['orders', 'today', branchId],
    queryFn: () =>
      api.get<OrderSummary[]>(
        `/orders?day=today${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ''}`,
      ),
    retry: 1,
  });

  const [selected, setSelected] = useState<OrderSummary | null>(null);
  const sheetRef = useRef<BottomSheet>(null);

  const openDetail = useCallback((o: OrderSummary) => {
    setSelected(o);
    setTimeout(() => sheetRef.current?.expand(), 0);
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <View style={styles.root}>
      <TopBar onMenuPress={onMenuPress} />
      <FlatList
        data={data ?? []}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {isLoading ? 'Loading…' : error ? errorLabel(error) : 'No orders yet today'}
            </Text>
            {!isLoading && !error ? (
              <Text style={styles.emptySub}>
                Completed sales will appear here, most recent first.
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <OrderRow order={item} onPress={openDetail} />}
      />

      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['80%']}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: colors.surface }}
        handleIndicatorStyle={{ backgroundColor: colors.muted }}
        onClose={() => setSelected(null)}
      >
        <BottomSheetScrollView contentContainerStyle={styles.detail}>
          {selected ? <OrderDetail order={selected} /> : null}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

function errorLabel(err: unknown): string {
  if (err instanceof ApiHttpError && err.status === 0) return 'Offline';
  return 'Could not load orders';
}

function OrderRow({
  order,
  onPress,
}: {
  order: OrderSummary;
  onPress: (o: OrderSummary) => void;
}): React.ReactElement {
  const time = useMemo(() => {
    try {
      const d = new Date(order.issuedAt);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }, [order.issuedAt]);

  return (
    <Pressable onPress={() => onPress(order)} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      <Card style={styles.row} mode="elevated">
        <Card.Content style={styles.rowInner}>
          <View style={styles.rowLeft}>
            <Text style={styles.orNum}>
              OR #{String(order.orNumber).padStart(6, '0')}
            </Text>
            <Text style={styles.rowSub}>
              {time} · {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
            </Text>
            <View style={styles.payIconRow}>
              {dedupePayMethods(order.payments).map((m) => (
                <MaterialCommunityIcons
                  key={m}
                  name={payIcon(m)}
                  size={16}
                  color={colors.muted}
                  style={{ marginRight: spacing.s1 }}
                />
              ))}
            </View>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowTotal, tnum]}>{formatPeso(order.totalCents)}</Text>
            <StatusPill status={order.status} />
          </View>
        </Card.Content>
      </Card>
    </Pressable>
  );
}

function StatusPill({ status }: { status: OrderStatus }): React.ReactElement {
  const tone = STATUS_TONE[status];
  return (
    <Chip
      compact
      style={{ backgroundColor: tone.bg, marginTop: spacing.s2 }}
      textStyle={{ color: tone.fg, fontWeight: '700' }}
    >
      {STATUS_LABEL[status]}
    </Chip>
  );
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  PAID: 'Paid',
  VOIDED: 'Voided',
  REFUNDED: 'Refunded',
};

const STATUS_TONE: Record<OrderStatus, { bg: string; fg: string }> = {
  PAID:     { bg: colors.successSoft, fg: colors.successDeep },
  VOIDED:   { bg: colors.errorSoft,   fg: colors.errorDeep },
  REFUNDED: { bg: colors.warningSoft, fg: colors.warningDeep },
};

function payIcon(m: PaymentMethod): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  switch (m) {
    case 'CASH':    return 'cash';
    case 'GCASH':   return 'cellphone';
    case 'PAYMAYA': return 'cellphone-wireless';
    case 'CARD':    return 'credit-card-outline';
    default:        return 'dots-horizontal';
  }
}

function dedupePayMethods(payments: CartPayment[]): PaymentMethod[] {
  const seen = new Set<PaymentMethod>();
  const out: PaymentMethod[] = [];
  for (const p of payments) {
    if (seen.has(p.method)) continue;
    seen.add(p.method);
    out.push(p.method);
  }
  return out;
}

function OrderDetail({ order }: { order: OrderSummary }): React.ReactElement {
  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<string | null>(null);

  const reprint = async () => {
    setPrinting(true);
    setPrintResult(null);
    try {
      const printer = await loadPrinter();
      if (!printer) throw new Error('Printer not available');
      // We don't have the full ReceiptForPrinter shape from the order list
      // endpoint — pass a minimal stand-in. Real reprint will go through
      // the printer agent's helper once exposed.
      await printer.print({
        orNumber: order.orNumber,
        issuedAt: Date.parse(order.issuedAt),
        cart: { lines: order.lines ?? [], payments: order.payments },
        subtotalCents: order.totalCents,
        discountCents: 0,
        totalCents: order.totalCents,
        payments: order.payments,
        changeCents: 0,
        cashierName: '',
        tenant: { name: '', tin: '' },
      });
      setPrintResult('Sent to printer');
    } catch (err) {
      setPrintResult(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <View style={{ gap: spacing.s4 }}>
      <View>
        <Text style={styles.detailTitle}>OR #{String(order.orNumber).padStart(6, '0')}</Text>
        <Text style={styles.detailSub}>
          {new Date(order.issuedAt).toLocaleString()}
        </Text>
      </View>

      <View>
        <Text style={styles.sectionLabel}>Items</Text>
        {(order.lines ?? []).length === 0 ? (
          <Text style={styles.detailMuted}>Line items unavailable for this order.</Text>
        ) : (
          (order.lines ?? []).map((l) => (
            <View key={l.id} style={styles.lineRow}>
              <Text style={[styles.lineName, l.voidedAt && styles.struck]}>
                {l.qty}× {l.productName}
              </Text>
              <Text style={[styles.linePrice, tnum, l.voidedAt && styles.struck]}>
                {formatPeso(l.lineTotal)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View>
        <Text style={styles.sectionLabel}>Payments</Text>
        {order.payments.map((p, i) => (
          <View key={`${p.method}-${i}`} style={styles.lineRow}>
            <Text style={styles.lineName}>{p.method}</Text>
            <Text style={[styles.linePrice, tnum]}>{formatPeso(p.amount)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={[styles.totalValue, tnum]}>{formatPeso(order.totalCents)}</Text>
      </View>

      <Pressable
        disabled={printing}
        onPress={reprint}
        style={({ pressed }) => [styles.reprintBtn, (printing || pressed) && { opacity: 0.85 }]}
      >
        <MaterialCommunityIcons name="printer" size={20} color={colors.onPrimary} />
        <Text style={styles.reprintBtnLabel}>
          {printing ? 'Printing…' : 'Re-print receipt'}
        </Text>
      </Pressable>
      {printResult ? <Text style={styles.detailMuted}>{printResult}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.s4, gap: spacing.s3 },
  empty: { padding: spacing.s7, alignItems: 'center' },
  emptyTitle: { ...textTokens.bodyLg, color: colors.ink, fontWeight: '700' },
  emptySub: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s2, textAlign: 'center' },

  row: { marginBottom: spacing.s2, backgroundColor: colors.surface, borderRadius: radii.lg },
  rowInner: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.s2 },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  orNum: { ...textTokens.mono, color: colors.ink, fontWeight: '700' },
  rowSub: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s1 },
  rowTotal: { ...textTokens.displaySm, color: colors.ink },
  payIconRow: { flexDirection: 'row', marginTop: spacing.s2 },

  detail: { padding: spacing.s5, paddingBottom: spacing.s8 },
  detailTitle: { ...textTokens.displayMd, color: colors.ink },
  detailSub: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s1 },
  detailMuted: { ...textTokens.bodySm, color: colors.muted },
  sectionLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.s2,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  lineName: { ...textTokens.body, color: colors.ink, flex: 1 },
  linePrice: { ...textTokens.body, color: colors.ink, marginLeft: spacing.s3 },
  struck: { textDecorationLine: 'line-through', color: colors.muted },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.s3,
    borderTopWidth: 1,
    borderTopColor: colors.ruleStrong,
  },
  totalLabel: { ...textTokens.displaySm, color: colors.ink },
  totalValue: { ...textTokens.displaySm, color: colors.ink },

  reprintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
    paddingVertical: spacing.s4,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  reprintBtnLabel: { ...textTokens.bodyLg, color: colors.onPrimary, fontWeight: '700' },
});
