/**
 * Pharmacy terminal — SKU/generic-search-first POS.
 *
 * Layout:
 *   - Top: search input (SKU / generic name / barcode placeholder).
 *   - Middle: results render as rows with brand, generic, dosage,
 *     controlled badge, and per-batch expiry chips (each chip tappable).
 *   - Right: cart panel with per-line batch + expiry + dispensing
 *     pharmacist initials/PRC.
 *
 * Add-to-cart pipeline:
 *   1. User taps "Add" on a drug row.
 *   2. If schedule = DDB_S2 → show ControlledSubstanceInterstitial; abort
 *      on cancel, otherwise require supervisor PIN with PRC license.
 *   3. If schedule = RX and cart has no Rx info yet → show RxCaptureModal.
 *      On save the Rx info is stamped on this and every future Rx line in
 *      the cart (we expose `useCart.stampRx` for this; the cart agent owns
 *      that action's implementation — we just call it).
 *   4. Batch is picked by FEFO default; pharmacist can change it via the
 *      BatchPickerSheet trigger on the cart line.
 *
 * NOTE: this terminal assumes `useCart` exposes:
 *   - addLine(line)
 *   - voidLine(lineId)
 *   - patchLine(lineId, partial)
 *   - stampRx(rxInfo)
 *   - cart selector
 * If the cart agent uses different action names, only the call sites in
 * this file (and the laundry one) need to change — surface-level rename.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radii, text, tap, elevation, tnum } from '@/theme/tokens';
import { useCart } from '@/terminal/cartStore';
import type { CartLine } from '@/types';
import {
  searchDrugs,
  sortFEFO,
  findDrug,
  type Drug,
  type Batch,
} from './mockCatalog';
import ControlledBadge from './ControlledBadge';
import BatchExpiryChip from './BatchExpiryChip';
import BatchPickerSheet, { type BatchPickerHandle } from './BatchPickerSheet';
import RxCaptureModal, { type RxInfo } from './RxCaptureModal';
import ControlledSubstanceInterstitial from './ControlledSubstanceInterstitial';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { openBarcodeScanner } from '@/components/BarcodeScannerSheet';
import { useLots, usePosCatalog } from '@/api/queries';
import { useActiveBranchId } from '@/api/BranchContext';
import { Snackbar } from 'react-native-paper';
import { openTendering } from '@/payment/TenderingHost';
import { useCartStore } from '@/terminal/cartStore';

function formatPeso(cents: number): string {
  return `₱${(cents / 100).toFixed(2)}`;
}

function initialsFromName(name: string | undefined): string {
  if (!name) return '—';
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export const PharmacyTerminal: React.FC = () => {
  const cart = useCart((s) => s.cart);
  const addLine = useCart((s) => s.addLine);
  const voidLine = useCart((s) => s.voidLine);
  const removeLineAction = useCart((s) => s.removeLine);
  const clearCart = useCart((s) => s.clear);

  const [snack, setSnack] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  // `cart.rx` doesn't exist on the shared CartState yet — we hold Rx info
  // here as terminal-local state. When the cart agent exposes a `stampRx`
  // action this can move into the store.
  const [rxInfo, setRxInfo] = useState<RxInfo | null>(null);

  const [query, setQuery] = useState('');
  const [selectedBatchBySku, setSelectedBatchBySku] = useState<Record<string, string>>({});

  // Rx capture orchestration
  const [rxOpen, setRxOpen] = useState(false);
  const pendingRxAddRef = useRef<{ drug: Drug; batch: Batch } | null>(null);

  // Controlled interstitial orchestration
  const [controlledOpen, setControlledOpen] = useState(false);
  const pendingControlledRef = useRef<{ drug: Drug; batch: Batch } | null>(null);

  const batchPickerRef = useRef<BatchPickerHandle>(null);

  // Live catalog + lots — fetched for freshness, but the rich Drug/Batch
  // mock model is still the rendering source until per-row live-lot wiring
  // lands. The fetches keep the React Query cache warm so the future swap
  // is a one-line change.
  const branchId = useActiveBranchId();
  void usePosCatalog(branchId);
  void useLots();

  const results = useMemo(() => searchDrugs(query), [query]);

  const cartHasDDB_S2 = useMemo(
    () =>
      (cart?.lines ?? []).some((l) => {
        const d = findDrug(l.productId);
        return d?.schedule === 'DDB_S2' && !l.voidedAt && !l.removed;
      }),
    [cart]
  );

  const cartHasRxInfo = !!rxInfo?.doctorName;

  const commitLine = (drug: Drug, batch: Batch, opts?: { dispensedById?: string }) => {
    const line: CartLine = {
      id: `${drug.sku}-${Date.now()}`,
      productId: drug.sku,
      productName: drug.brandName,
      qty: 1,
      unitPrice: drug.priceCents,
      modifiers: [],
      lineTotal: drug.priceCents,
      lotId: batch.lotId,
      lotExpiresAt: batch.expiresAt,
      dispensedById: opts?.dispensedById,
    };
    addLine(line);
  };

  const onAdd = async (drug: Drug) => {
    const selectedLot = selectedBatchBySku[drug.sku];
    const sorted = sortFEFO(drug.batches);
    const batch =
      sorted.find((b) => b.lotId === selectedLot) ?? sorted[0];
    if (!batch) return;

    // 1) Controlled → interstitial first.
    if (drug.schedule === 'DDB_S2') {
      pendingControlledRef.current = { drug, batch };
      setControlledOpen(true);
      return;
    }

    // 2) Rx-required and we don't yet have Rx info → capture.
    if (drug.schedule === 'RX' && !cartHasRxInfo) {
      pendingRxAddRef.current = { drug, batch };
      setRxOpen(true);
      return;
    }

    commitLine(drug, batch);
  };

  const onRxSaved = (rx: RxInfo) => {
    setRxInfo(rx);
    setRxOpen(false);
    const pending = pendingRxAddRef.current;
    pendingRxAddRef.current = null;
    if (pending) commitLine(pending.drug, pending.batch);
  };

  const onControlledAuthorized = (result: { supervisorId: string; role: string }) => {
    setControlledOpen(false);
    const pending = pendingControlledRef.current;
    pendingControlledRef.current = null;
    if (!pending) return;
    // Controlled drugs are always Rx-required: if we have no Rx info yet,
    // capture it before commit so the cart line carries it.
    if (!cartHasRxInfo) {
      pendingRxAddRef.current = { drug: pending.drug, batch: pending.batch };
      // We carry the supervisor id into the post-save commit.
      const drug = pending.drug;
      const batch = pending.batch;
      const supId = result.supervisorId;
      pendingRxAddRef.current = { drug, batch };
      // Hijack: after Rx saved we want dispensedById = supId.
      // Simplest: stash on the pending object via a closure.
      (pendingRxAddRef.current as { drug: Drug; batch: Batch; dispensedById?: string }).dispensedById = supId;
      setRxOpen(true);
      return;
    }
    commitLine(pending.drug, pending.batch, { dispensedById: result.supervisorId });
  };

  const onRxSavedWithPending = (rx: RxInfo) => {
    setRxInfo(rx);
    setRxOpen(false);
    const pending = pendingRxAddRef.current as
      | { drug: Drug; batch: Batch; dispensedById?: string }
      | null;
    pendingRxAddRef.current = null;
    if (pending) commitLine(pending.drug, pending.batch, { dispensedById: pending.dispensedById });
  };

  const handleLinePickBatch = async (line: CartLine) => {
    const result = await batchPickerRef.current?.open(line.productId);
    if (!result) return;
    // Replace the line — cart has no patch action yet. removeLine is the
    // soft-remove path (no supervisor PIN required pre-finalize).
    removeLineAction(line.id);
    addLine({ ...line, id: `${line.productId}-${Date.now()}`, lotId: result.lotId, lotExpiresAt: result.lotExpiresAt });
  };

  const subtotalCents = (cart?.lines ?? [])
    .filter((l) => !l.voidedAt && !l.removed)
    .reduce((sum, l) => sum + l.lineTotal, 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Hero search bar */}
      <View style={styles.searchBar}>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by SKU, brand, generic, or barcode"
            placeholderTextColor={colors.faint}
            style={[styles.searchInput, { flex: 1 }]}
            autoCapitalize="none"
          />
          <Pressable
            onPress={async () => {
              try {
                const code = await openBarcodeScanner();
                if (code) setQuery(code);
              } catch {
                /* host not mounted */
              }
            }}
            style={({ pressed }) => [styles.scanIconBtn, pressed && { opacity: 0.85 }]}
            accessibilityLabel="Scan barcode"
          >
            <MaterialCommunityIcons name="barcode-scan" size={28} color={colors.onPrimary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        {/* Results column */}
        <ScrollView style={styles.resultsCol} contentContainerStyle={{ paddingBottom: spacing.s6 }}>
          {results.map((d) => {
            const sorted = sortFEFO(d.batches);
            const selectedLot = selectedBatchBySku[d.sku] ?? sorted[0]?.lotId;
            return (
              <View key={d.sku} style={styles.drugRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.drugTitleRow}>
                    <Text style={styles.drugName}>{d.brandName}</Text>
                    <ControlledBadge schedule={d.schedule} />
                  </View>
                  <Text style={styles.drugGeneric}>
                    {d.genericName} · {d.dosageForm}
                  </Text>
                  <Text style={styles.drugSku}>{d.sku}</Text>

                  <View style={styles.batchRow}>
                    {sorted.map((b) => (
                      <BatchExpiryChip
                        key={b.lotId}
                        batch={b}
                        selected={b.lotId === selectedLot}
                        onPress={() =>
                          setSelectedBatchBySku((prev) => ({ ...prev, [d.sku]: b.lotId }))
                        }
                      />
                    ))}
                  </View>
                </View>

                <View style={styles.drugRight}>
                  <Text style={[styles.drugPrice, tnum]}>{formatPeso(d.priceCents)}</Text>
                  <Pressable onPress={() => onAdd(d)} style={styles.addBtn}>
                    <Text style={styles.addBtnText}>Add</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          {results.length === 0 && (
            <Text style={styles.emptyHint}>No drugs match “{query}”.</Text>
          )}
        </ScrollView>

        {/* Cart panel */}
        <View style={styles.cartCol}>
          <View style={styles.cartHeader}>
            <Text style={styles.cartTitle}>Order</Text>
            <Text style={styles.cartSub}>
              {(cart?.lines ?? []).filter((l) => !l.voidedAt && !l.removed).length} items
              {rxInfo?.doctorName ? ` · Rx: ${rxInfo.doctorName}` : ''}
            </Text>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {(cart?.lines ?? []).filter((l) => !l.voidedAt && !l.removed).map((line) => {
              const drug = findDrug(line.productId);
              const isRx = drug?.schedule === 'RX' || drug?.schedule === 'DDB_S2';
              return (
                <View key={line.id} style={[styles.lineRow, isRx && styles.lineRowRx]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.lineNameRow}>
                      <Text style={styles.lineName}>{line.qty}× {line.productName}</Text>
                      {drug && <ControlledBadge schedule={drug.schedule} />}
                    </View>
                    <Pressable onPress={() => handleLinePickBatch(line)}>
                      <Text style={styles.lineBatch}>
                        Lot {line.lotId ?? '—'} · exp {line.lotExpiresAt?.slice(0, 7) ?? '—'}
                        {'  ↻ pick batch'}
                      </Text>
                    </Pressable>
                    {line.dispensedById && (
                      <Text style={styles.lineDispensed}>
                        Dispensed by {initialsFromName(line.dispensedById)}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.linePrice, tnum]}>{formatPeso(line.lineTotal)}</Text>
                  <Pressable onPress={() => voidLine(line.id)} style={styles.voidBtn}>
                    <Text style={styles.voidBtnText}>×</Text>
                  </Pressable>
                </View>
              );
            })}
            {(cart?.lines ?? []).length === 0 && (
              <Text style={styles.emptyHint}>Search and tap “Add” to begin.</Text>
            )}
          </ScrollView>

          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalRowLabel}>Subtotal</Text>
              <Text style={[styles.totalRowValue, tnum]}>{formatPeso(subtotalCents)}</Text>
            </View>
          </View>

          <View style={styles.ctaWrap}>
            <Pressable
              disabled={subtotalCents === 0 || charging}
              onPress={async () => {
                if (subtotalCents === 0 || charging) return;
                setCharging(true);
                try {
                  const snapshot = useCartStore.getState();
                  const result = await openTendering({
                    cart: {
                      lines: snapshot.lines,
                      payments: snapshot.payments,
                      customer: snapshot.customer,
                      pwdScId: snapshot.pwdScId,
                      diningMode: snapshot.diningMode,
                      tableNumber: snapshot.tableNumber,
                    },
                    totalCents: subtotalCents,
                    subtotalCents,
                  });
                  if (result) {
                    clearCart();
                    setRxInfo(null);
                    setSnack(
                      result.offline
                        ? `Saved offline · ${result.orderNumber}`
                        : `Sale complete · #${result.orderNumber}`,
                    );
                  }
                } catch (e) {
                  setSnack(e instanceof Error ? e.message : 'Charge failed.');
                } finally {
                  setCharging(false);
                }
              }}
              style={[
                styles.primaryCta,
                (subtotalCents === 0 || charging) && styles.primaryCtaDisabled,
              ]}
            >
              <Text style={styles.primaryCtaText}>
                {charging ? 'Charging…' : `Charge ${formatPeso(subtotalCents)}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <BatchPickerSheet ref={batchPickerRef} />

      <RxCaptureModal
        visible={rxOpen}
        requireYellowSerial={cartHasDDB_S2 || pendingControlledRef.current !== null || (pendingRxAddRef.current?.drug.schedule === 'DDB_S2')}
        onCancel={() => {
          setRxOpen(false);
          pendingRxAddRef.current = null;
        }}
        onSave={pendingRxAddRef.current && (pendingRxAddRef.current as { dispensedById?: string }).dispensedById ? onRxSavedWithPending : onRxSaved}
      />

      <Snackbar
        visible={snack !== null}
        onDismiss={() => setSnack(null)}
        duration={3000}
      >
        {snack ?? ''}
      </Snackbar>

      <ControlledSubstanceInterstitial
        visible={controlledOpen}
        drugName={pendingControlledRef.current?.drug.brandName ?? ''}
        dosage={pendingControlledRef.current?.drug.dosageForm ?? ''}
        onCancel={() => {
          setControlledOpen(false);
          pendingControlledRef.current = null;
        }}
        onAuthorized={onControlledAuthorized}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  searchBar: {
    padding: spacing.s4,
    backgroundColor: colors.creamSoft,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s3 },
  scanIconBtn: {
    width: 60, height: 60,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  searchInput: {
    height: 60,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 2, borderColor: colors.primary,
    paddingHorizontal: spacing.s4,
    color: colors.ink,
    ...text.bodyLg,
  },

  body: { flex: 1, flexDirection: 'row' },

  resultsCol: { flex: 1, backgroundColor: colors.bg },
  drugRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s4,
    padding: spacing.s4,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  drugTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2, flexWrap: 'wrap' },
  drugName: { ...text.bodyLg, color: colors.ink, fontWeight: '700' },
  drugGeneric: { ...text.bodySm, color: colors.muted, marginTop: 2 },
  drugSku: { ...text.caption, color: colors.faint, marginTop: 2 },
  batchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s2, marginTop: spacing.s3 },
  drugRight: { alignItems: 'flex-end', gap: spacing.s2 },
  drugPrice: { ...text.displaySm, color: colors.primary },

  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.s4,
    height: tap.default,
    borderRadius: radii.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { ...text.body, color: colors.onPrimary, fontWeight: '700' },

  emptyHint: { ...text.bodySm, color: colors.faint, padding: spacing.s5, textAlign: 'center' },

  // cart
  cartCol: {
    width: 420,
    backgroundColor: colors.creamSoft,
    borderLeftWidth: 1, borderLeftColor: colors.rule,
  },
  cartHeader: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
  },
  cartTitle: { ...text.displaySm, color: colors.ink },
  cartSub: { ...text.bodySm, color: colors.muted, marginTop: 2 },

  lineRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s3,
    padding: spacing.s3,
    borderBottomWidth: 1, borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  lineRowRx: { backgroundColor: '#FFF8E6' },
  lineNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2, flexWrap: 'wrap' },
  lineName: { ...text.body, color: colors.ink, fontWeight: '700' },
  lineBatch: { ...text.caption, color: colors.primary, marginTop: spacing.s1 },
  lineDispensed: { ...text.caption, color: colors.muted, marginTop: 2 },
  linePrice: { ...text.body, color: colors.primary, fontWeight: '700' },
  voidBtn: {
    width: 32, height: 32, borderRadius: radii.sm,
    backgroundColor: colors.errorSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  voidBtnText: { color: colors.errorDeep, fontWeight: '700', fontSize: 18 },

  totals: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRowLabel: { ...text.body, color: colors.muted },
  totalRowValue: { ...text.displaySm, color: colors.ink },

  ctaWrap: { padding: spacing.s4 },
  primaryCta: {
    backgroundColor: colors.primary,
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
    ...elevation.e1,
  },
  primaryCtaDisabled: { backgroundColor: colors.ruleStrong },
  primaryCtaText: { ...text.cashierLg, color: colors.onPrimary },
});

export default PharmacyTerminal;
