/**
 * BatchPickerSheet — bottom sheet listing all open batches for a SKU.
 *
 * Sorted FEFO (earliest expiry first). Each row: lot #, qty remaining,
 * expiry date, unit cost (small subdued). Selecting a batch resolves the
 * caller's promise with `{ lotId, lotExpiresAt }` so the consumer can stamp
 * its cart line.
 */

import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { colors, spacing, radii, text } from '@/theme/tokens';
import { sortFEFO, findDrug, expiryTier, type Batch } from './mockCatalog';

export interface BatchPickerHandle {
  open: (sku: string) => Promise<{ lotId: string; lotExpiresAt: string } | null>;
}

const TIER = {
  OK:    { bg: colors.successSoft, fg: colors.successDeep },
  AMBER: { bg: colors.warningSoft, fg: colors.warningDeep },
  RED:   { bg: colors.errorSoft,   fg: colors.errorDeep },
} as const;

function formatPeso(cents: number): string {
  return `₱${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const BatchPickerSheet = forwardRef<BatchPickerHandle, {}>((_, ref) => {
  const sheetRef = useRef<BottomSheet>(null);
  const [sku, setSku] = useState<string | null>(null);
  const resolverRef = useRef<((v: { lotId: string; lotExpiresAt: string } | null) => void) | null>(null);

  useImperativeHandle(ref, () => ({
    open: (nextSku: string) =>
      new Promise((resolve) => {
        setSku(nextSku);
        resolverRef.current = resolve;
        sheetRef.current?.expand();
      }),
  }));

  const drug = sku ? findDrug(sku) : undefined;
  const sorted = drug ? sortFEFO(drug.batches) : [];

  const onPick = (b: Batch) => {
    resolverRef.current?.({ lotId: b.lotId, lotExpiresAt: b.expiresAt });
    resolverRef.current = null;
    sheetRef.current?.close();
  };

  const onClose = () => {
    if (resolverRef.current) {
      resolverRef.current(null);
      resolverRef.current = null;
    }
    setSku(null);
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['55%']}
      enablePanDownToClose
      onClose={onClose}
    >
      <BottomSheetView style={styles.sheet}>
        <Text style={styles.title}>Pick batch · {drug?.brandName ?? ''}</Text>
        <Text style={styles.sub}>Earliest expiry suggested (FEFO).</Text>

        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1.4 }]}>Lot #</Text>
          <Text style={[styles.th, { flex: 1 }]}>Qty</Text>
          <Text style={[styles.th, { flex: 1.4 }]}>Expiry</Text>
          <Text style={[styles.th, { flex: 1 }]}>Cost</Text>
        </View>

        {sorted.map((b, i) => {
          const tier = expiryTier(b.expiresAt);
          const t = TIER[tier];
          const suggested = i === 0;
          return (
            <Pressable
              key={b.lotId}
              onPress={() => onPick(b)}
              style={[styles.row, suggested && styles.rowSuggested]}
            >
              <Text style={[styles.cell, { flex: 1.4 }, styles.lot]}>{b.lotId}</Text>
              <Text style={[styles.cell, { flex: 1 }]}>{b.qtyRemaining}</Text>
              <View style={[styles.cellWrap, { flex: 1.4 }]}>
                <View style={[styles.tag, { backgroundColor: t.bg }]}>
                  <Text style={[styles.tagText, { color: t.fg }]}>{formatDate(b.expiresAt)}</Text>
                </View>
              </View>
              <Text style={[styles.cell, { flex: 1 }, styles.costCell]}>{formatPeso(b.unitCostCents)}</Text>
            </Pressable>
          );
        })}

        {sorted.length === 0 && (
          <Text style={styles.empty}>No open batches.</Text>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
});

BatchPickerSheet.displayName = 'BatchPickerSheet';

const styles = StyleSheet.create({
  sheet: { padding: spacing.s5 },
  title: { ...text.displayMd, color: colors.ink },
  sub: { ...text.bodySm, color: colors.muted, marginTop: spacing.s1, marginBottom: spacing.s4 },

  tableHead: {
    flexDirection: 'row',
    paddingVertical: spacing.s2,
    borderBottomWidth: 2, borderBottomColor: colors.rule,
  },
  th: { ...text.caption, color: colors.muted, textTransform: 'uppercase', fontWeight: '700' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.s3,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
  },
  rowSuggested: { backgroundColor: colors.primaryContainer },

  cell: { ...text.body, color: colors.ink },
  cellWrap: { paddingRight: spacing.s2 },
  lot: { fontFamily: undefined, fontWeight: '700' },
  costCell: { ...text.bodySm, color: colors.muted },

  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.s2,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  tagText: { ...text.caption, fontWeight: '600' },

  empty: { ...text.body, color: colors.muted, padding: spacing.s5, textAlign: 'center' },
});

export default BatchPickerSheet;
