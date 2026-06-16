/**
 * Clerque Counter — Phone Pumps screen (Gas Station vertical)
 *
 * Primary cashier surface for an MSME independent station. Replaces the
 * normal Sell tab for tenants with businessType=GAS_STATION.
 *
 * Workflow per pump:
 *   1. Card shows status (IDLE / DISPENSING) + linked fuel grade + ₱/L
 *   2. IDLE card tap → "Start dispense" sheet: opening meter (pre-filled
 *      with pump.currentMeter) + attendant PIN (the cashier today)
 *   3. DISPENSING card tap → "End dispense" sheet: closing meter input,
 *      live liters + total preview, "Charge & ring" CTA
 *   4. On Charge: server computes liters + total, pre-populates the cart
 *      with a single line, navigates to Cart → Tendering wizard
 *
 * The Order rung at the till is linked back to the FuelDispense via
 * /fuel/dispenses/:id/attach-order so the audit log + reports tie out.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View, Modal } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, type NavigationProp } from '@react-navigation/native';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { api, ApiHttpError } from '@/api/client';
import { useBranchContext } from '@/api/BranchContext';
import { useCartStore } from '@/terminal/cartStore';
import { formatPeso } from '@/components/Money';
import { colors, fonts, radii, spacing, text as textTokens, tnum } from '@/theme';

interface PumpDispense {
  id:           string;
  openingMeter: number | string;
  attendant:    { id: string; name: string };
}

interface Pump {
  id:           string;
  label:        string;
  fuelGrade:    'UNLEADED' | 'REGULAR' | 'DIESEL' | 'PREMIUM' | 'KEROSENE' | 'OTHER';
  isActive:     boolean;
  currentMeter: number | string;
  sortOrder:    number;
  product:      { id: string; name: string; price: number | string };
  dispenses:    PumpDispense[];
}

const GRADE_LABEL: Record<Pump['fuelGrade'], string> = {
  UNLEADED: 'Unleaded',
  REGULAR:  'Regular',
  DIESEL:   'Diesel',
  PREMIUM:  'Premium',
  KEROSENE: 'Kerosene',
  OTHER:    'Other',
};

export default function PhonePumpsScreen(): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id ?? null;
  const nav = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const qc = useQueryClient();

  const clearCart   = useCartStore((s) => s.clear);
  const addLine     = useCartStore((s) => s.addLine);

  const [startSheet, setStartSheet] = useState<Pump | null>(null);
  const [endSheet,   setEndSheet]   = useState<{ pump: Pump; dispense: PumpDispense } | null>(null);
  const [openingMeter, setOpeningMeter] = useState('');
  const [closingMeter, setClosingMeter] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);

  const pumpsQ = useQuery<Pump[]>({
    queryKey: ['fuel-pumps', branchId],
    enabled:  !!branchId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      try {
        const data = await api.get<Pump[]>(`/fuel/pumps?branchId=${encodeURIComponent(branchId!)}`);
        return Array.isArray(data) ? data : [];
      } catch (err) {
        if (err instanceof ApiHttpError) return [];
        throw err;
      }
    },
  });

  const openStart = (p: Pump) => {
    setStartSheet(p);
    setOpeningMeter(String(Math.round(Number(p.currentMeter) * 1000) / 1000));
    setErrorMsg(null);
  };

  const openEnd = (p: Pump, d: PumpDispense) => {
    setEndSheet({ pump: p, dispense: d });
    setClosingMeter('');
    setErrorMsg(null);
  };

  const submitStart = async () => {
    if (!startSheet) return;
    const opening = Number(openingMeter);
    if (!Number.isFinite(opening) || opening < 0) {
      setErrorMsg('Opening meter must be a non-negative number.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await api.post('/fuel/dispenses/start', {
        pumpId:       startSheet.id,
        openingMeter: opening,
      });
      await qc.invalidateQueries({ queryKey: ['fuel-pumps'] });
      setStartSheet(null);
    } catch (err) {
      setErrorMsg(err instanceof ApiHttpError ? err.message : 'Could not start dispense.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitEnd = async () => {
    if (!endSheet) return;
    const closing = Number(closingMeter);
    const opening = Number(endSheet.dispense.openingMeter);
    if (!Number.isFinite(closing) || closing <= opening) {
      setErrorMsg(`Closing meter (${closing || '—'}) must exceed opening (${opening}).`);
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      // 1. Complete the dispense — server computes liters + totalCents
      const completed = await api.post<{
        id: string;
        litersDispensed: number | string;
        totalCents: number;
        pricePerLiter: number | string;
        pump: { id: string; label: string; product: { id: string; name: string } };
      }>(`/fuel/dispenses/${endSheet.dispense.id}/end`, { closingMeter: closing });

      // 2. Pre-populate the cart with a single line and navigate to Tendering.
      // The line's productId is the linked fuel Product so the receipt prints
      // the right name; unitPrice * qty == totalCents.
      const liters = Number(completed.litersDispensed);
      const unitPriceCents = liters > 0
        ? Math.round(completed.totalCents / liters)
        : Math.round(Number(completed.pricePerLiter) * 100);

      clearCart();
      addLine({
        productId:   completed.pump.product.id,
        productName: `${completed.pump.product.name} · Pump ${endSheet.pump.label}`,
        qty:         liters,
        unitPrice:   unitPriceCents,
      });

      // 3. Tag the dispense with the cart-side "intent" so the tender flow
      //    can link the resulting Order back. Stash dispense ID for the
      //    post-tender hook.
      pendingDispenseId = completed.id;

      await qc.invalidateQueries({ queryKey: ['fuel-pumps'] });
      setEndSheet(null);
      nav.navigate('Sell', { screen: 'Cart' });
    } catch (err) {
      setErrorMsg(err instanceof ApiHttpError ? err.message : 'Could not end dispense.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <PhoneHeader variant="brand" />

      <FlatList<Pump>
        data={pumpsQ.data ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.scroll}
        ListHeaderComponent={
          <View style={styles.head}>
            <Text style={styles.h1}>Pumps</Text>
            <Text style={styles.sub}>
              Tap an idle pump to start dispensing, or an amber pump to close it out.
            </Text>
          </View>
        }
        ListEmptyComponent={
          pumpsQ.isLoading ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="gas-station" size={48} color={colors.faint} />
              <Text style={styles.emptyTitle}>No pumps configured</Text>
              <Text style={styles.emptySub}>
                Owner: create pumps on the web at clerque.cc/pos/fuel/pumps.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const open = item.dispenses[0];
          const isOn = !!open;
          return (
            <Pressable
              onPress={() => isOn ? openEnd(item, open) : openStart(item)}
              disabled={!item.isActive}
              style={({ pressed }) => [
                styles.card,
                isOn && styles.cardOn,
                pressed && { opacity: 0.85 },
                !item.isActive && { opacity: 0.4 },
              ]}
            >
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{item.label}</Text>
                  <Text style={styles.grade}>{GRADE_LABEL[item.fuelGrade]}</Text>
                </View>
                <View style={[styles.statusPill, isOn ? styles.statusPillOn : styles.statusPillIdle]}>
                  <Text style={[styles.statusText, isOn && styles.statusTextOn]}>
                    {isOn ? 'DISPENSING' : 'IDLE'}
                  </Text>
                </View>
              </View>
              <View style={styles.cardMeta}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metaLabel}>Price / L</Text>
                  <Text style={[styles.priceBig, tnum]}>
                    {formatPeso(Math.round(Number(item.product.price) * 100))}
                  </Text>
                </View>
                <View>
                  <Text style={styles.metaLabel}>Totalizer (L)</Text>
                  <Text style={[styles.meter, tnum]}>
                    {Number(item.currentMeter).toFixed(3)}
                  </Text>
                </View>
              </View>
              {isOn ? (
                <View style={styles.attendantStrip}>
                  <MaterialCommunityIcons name="account" size={12} color={colors.warningDeep} />
                  <Text style={styles.attendantText}>
                    {open.attendant.name} · started at {Number(open.openingMeter).toFixed(3)} L
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />

      {/* Start sheet */}
      <Modal visible={!!startSheet} transparent animationType="fade" onRequestClose={() => setStartSheet(null)}>
        <Pressable style={styles.scrim} onPress={() => !submitting && setStartSheet(null)}>
          <Pressable style={styles.sheet} onPress={() => { /* swallow */ }}>
            <Text style={styles.sheetTitle}>Start dispense · {startSheet?.label}</Text>
            <Text style={styles.sheetSub}>
              Confirm the pump&apos;s current opening meter before pumping.
            </Text>
            <Text style={styles.fieldLabel}>Opening meter (L)</Text>
            <TextInput
              value={openingMeter}
              onChangeText={setOpeningMeter}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
            <View style={styles.sheetActions}>
              <Pressable onPress={() => setStartSheet(null)} style={styles.btnGhost}>
                <Text style={styles.btnGhostLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitStart}
                disabled={submitting}
                style={({ pressed }) => [styles.btnPrimary, (pressed || submitting) && styles.btnPressed]}
              >
                <Text style={styles.btnPrimaryLabel}>{submitting ? 'Starting…' : 'Start dispense'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* End sheet */}
      <Modal visible={!!endSheet} transparent animationType="fade" onRequestClose={() => setEndSheet(null)}>
        <Pressable style={styles.scrim} onPress={() => !submitting && setEndSheet(null)}>
          <Pressable style={styles.sheet} onPress={() => { /* swallow */ }}>
            <Text style={styles.sheetTitle}>End dispense · {endSheet?.pump.label}</Text>
            <Text style={styles.sheetSub}>
              Enter the closing meter. We&apos;ll compute liters + total and pre-fill the cart.
            </Text>
            <Text style={styles.fieldLabel}>Closing meter (L)</Text>
            <TextInput
              value={closingMeter}
              onChangeText={setClosingMeter}
              keyboardType="decimal-pad"
              placeholder={endSheet ? `> ${Number(endSheet.dispense.openingMeter).toFixed(3)}` : ''}
              placeholderTextColor={colors.faint}
              autoFocus
              style={styles.input}
            />
            <EndPreview
              opening={endSheet ? Number(endSheet.dispense.openingMeter) : 0}
              closing={Number(closingMeter) || 0}
              pricePerLiterCents={endSheet ? Math.round(Number(endSheet.pump.product.price) * 100) : 0}
            />
            {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
            <View style={styles.sheetActions}>
              <Pressable onPress={() => setEndSheet(null)} style={styles.btnGhost}>
                <Text style={styles.btnGhostLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitEnd}
                disabled={submitting}
                style={({ pressed }) => [styles.btnPrimary, (pressed || submitting) && styles.btnPressed]}
              >
                <Text style={styles.btnPrimaryLabel}>
                  {submitting ? 'Saving…' : 'Charge & ring →'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * Module-level "pending dispense" id — set when the cashier rings a pump
 * sale, consumed by the OrdersService/TenderingHost after Confirm to call
 * /fuel/dispenses/:id/attach-order. Exported so TenderingHost can read it.
 */
export let pendingDispenseId: string | null = null;
export function clearPendingDispenseId() { pendingDispenseId = null; }

function EndPreview({
  opening, closing, pricePerLiterCents,
}: { opening: number; closing: number; pricePerLiterCents: number }): React.ReactElement | null {
  const liters = useMemo(() => Math.max(0, closing - opening), [opening, closing]);
  const totalCents = useMemo(() => Math.round(liters * pricePerLiterCents), [liters, pricePerLiterCents]);
  if (liters <= 0) return null;
  return (
    <View style={previewStyles.box}>
      <View style={previewStyles.row}>
        <Text style={previewStyles.label}>Liters</Text>
        <Text style={[previewStyles.value, tnum]}>{liters.toFixed(3)} L</Text>
      </View>
      <View style={previewStyles.row}>
        <Text style={previewStyles.label}>× ₱/L</Text>
        <Text style={[previewStyles.value, tnum]}>{formatPeso(pricePerLiterCents)}</Text>
      </View>
      <View style={[previewStyles.row, previewStyles.totalRow]}>
        <Text style={previewStyles.totalLabel}>Total</Text>
        <Text style={[previewStyles.totalValue, tnum]}>{formatPeso(totalCents)}</Text>
      </View>
    </View>
  );
}

const previewStyles = StyleSheet.create({
  box: {
    backgroundColor: colors.successSoft,
    borderColor: '#B5E6D2',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.s3,
    marginTop: spacing.s3,
    gap: spacing.s1,
  },
  row:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:      { ...textTokens.bodySm, color: colors.successDeep, fontSize: 12 },
  value:      { ...textTokens.body, color: colors.successDeep, fontWeight: '700', fontFamily: fonts.mono },
  totalRow:   { paddingTop: spacing.s2, marginTop: 4, borderTopWidth: 1, borderTopColor: '#B5E6D2' },
  totalLabel: { ...textTokens.body, color: colors.successDeep, fontWeight: '800' },
  totalValue: { fontFamily: fonts.displayBold, fontSize: 22, fontWeight: '800', color: colors.successDeep },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, gap: spacing.s3, paddingBottom: spacing.s7 },

  head:    { marginBottom: spacing.s2 },
  h1:      { ...textTokens.displayLg, fontSize: 22, color: colors.ink },
  sub:     { ...textTokens.bodySm, color: colors.muted, marginTop: 4 },

  empty:        { alignItems: 'center', paddingVertical: spacing.s8, gap: spacing.s2 },
  emptyTitle:   { ...textTokens.displaySm, fontSize: 16, color: colors.ink, marginTop: spacing.s2 },
  emptySub:     { ...textTokens.bodySm, color: colors.muted, textAlign: 'center', paddingHorizontal: spacing.s5 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
  },
  cardOn:    { borderColor: colors.warning, borderWidth: 2, backgroundColor: colors.warningSoft },
  cardHead:  { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  label:     { ...textTokens.displaySm, fontSize: 20, color: colors.ink, fontWeight: '800' },
  grade:     { ...textTokens.caption, color: colors.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 11, fontWeight: '700' },
  statusPill: {
    paddingHorizontal: spacing.s3, paddingVertical: 4,
    borderRadius: radii.pill,
  },
  statusPillIdle: { backgroundColor: colors.cream },
  statusPillOn:   { backgroundColor: colors.warning },
  statusText:     { fontFamily: fonts.bodyBold, fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  statusTextOn:   { color: colors.onPrimary },

  cardMeta: { flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.s3, gap: spacing.s4 },
  metaLabel: { ...textTokens.caption, fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' },
  priceBig:  { fontFamily: fonts.displayBold, fontSize: 26, fontWeight: '800', color: colors.primary, letterSpacing: -0.4, marginTop: 2 },
  meter:     { fontFamily: fonts.mono, fontSize: 14, color: colors.ink, marginTop: 4 },

  attendantStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.s2,
    paddingTop: spacing.s2,
    borderTopWidth: 1,
    borderTopColor: '#F8D6A1',
  },
  attendantText: { ...textTokens.caption, color: colors.warningDeep, fontSize: 11, flex: 1, fontWeight: '600' },

  // Modal / sheet
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(31,27,22,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.s5,
    paddingBottom: spacing.s7,
    gap: spacing.s2,
  },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 18, fontWeight: '800', color: colors.ink },
  sheetSub:   { ...textTokens.bodySm, color: colors.muted, marginBottom: spacing.s2 },
  fieldLabel: { ...textTokens.caption, color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    height: 56,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.s4,
    fontSize: 22,
    fontFamily: fonts.monoSemibold,
    color: colors.ink,
    textAlign: 'right',
  },
  error: { ...textTokens.bodySm, color: colors.errorDeep, marginTop: spacing.s2 },

  sheetActions: { flexDirection: 'row', gap: spacing.s3, marginTop: spacing.s4 },
  btnGhost: {
    flex: 1, height: 52,
    borderRadius: radii.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  btnGhostLabel: { ...textTokens.body, fontWeight: '700', color: colors.ink },
  btnPrimary: {
    flex: 2, height: 52,
    borderRadius: radii.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  btnPrimaryLabel: { ...textTokens.body, fontWeight: '800', color: colors.onPrimary },
  btnPressed: { opacity: 0.85 },
});
