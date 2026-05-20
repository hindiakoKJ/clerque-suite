/**
 * Clerque Counter — Phone Rentals (DME / Medical Equipment vertical)
 *
 * Tab-level surface for cashier rental management. Mirrors the web
 * /pos/rentals page but optimized for at-the-counter use:
 *
 *   • Status filter chips: OPEN / OVERDUE / DUE_TODAY / RETURNED
 *   • Per-row: customer, unit + serial, due date, balance, "Return" CTA
 *   • Return sheet: damage fee input + refund preview + confirm
 *
 * The "Open rental" workflow (capture deposit + intake notes) is staged on
 * web admin for V1 — Counter sees only the return side. V2 will add a
 * counter-side "New rental" sheet after a real DME pilot validates the form.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { api, ApiHttpError } from '@/api/client';
import { formatPeso } from '@/components/Money';
import { colors, fonts, radii, spacing, text as textTokens, tnum } from '@/theme';

interface Rental {
  id:           string;
  status:       'OPEN' | 'OVERDUE' | 'RETURNED' | 'LOST';
  depositCents: number;
  damageFeeCents: number;
  refundCents:  number;
  rentalRate:   number | string;
  rateUnit:     string;
  startedAt:    string;
  dueAt:        string;
  returnedAt:   string | null;
  intakeNotes:  string | null;
  customer:     { id: string; name: string; contactPhone: string | null };
  serializedUnit: {
    id: string;
    serialNumber: string;
    product: { id: string; name: string };
  };
}

type Filter = 'ACTIVE' | 'OVERDUE' | 'DUE_TODAY' | 'RETURNED';

function dueLabel(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

function daysUntil(iso: string): number {
  const d = new Date(iso).getTime();
  const today = Date.now();
  return Math.ceil((d - today) / (24 * 3600_000));
}

export default function PhoneRentalsScreen(): React.ReactElement {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [returning, setReturning] = useState<Rental | null>(null);
  const [damageFee, setDamageFee] = useState('');
  const [notes, setNotes]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rentalsQ = useQuery<Rental[]>({
    queryKey: ['rentals', 'counter'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      try {
        const data = await api.get<Rental[]>('/rentals');
        return Array.isArray(data) ? data : [];
      } catch (err) {
        if (err instanceof ApiHttpError) return [];
        throw err;
      }
    },
  });

  const filtered = useMemo(() => {
    const list = rentalsQ.data ?? [];
    const todayPh = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    switch (filter) {
      case 'OVERDUE':
        return list.filter((r) => r.status === 'OVERDUE');
      case 'DUE_TODAY':
        return list.filter((r) => (r.status === 'OPEN' || r.status === 'OVERDUE') && r.dueAt.slice(0, 10) === todayPh);
      case 'RETURNED':
        return list.filter((r) => r.status === 'RETURNED' || r.status === 'LOST');
      case 'ACTIVE':
      default:
        return list.filter((r) => r.status === 'OPEN' || r.status === 'OVERDUE');
    }
  }, [rentalsQ.data, filter]);

  const counts = useMemo(() => {
    const list = rentalsQ.data ?? [];
    const todayPh = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return {
      ACTIVE:    list.filter((r) => r.status === 'OPEN' || r.status === 'OVERDUE').length,
      OVERDUE:   list.filter((r) => r.status === 'OVERDUE').length,
      DUE_TODAY: list.filter((r) => (r.status === 'OPEN' || r.status === 'OVERDUE') && r.dueAt.slice(0, 10) === todayPh).length,
      RETURNED:  list.filter((r) => r.status === 'RETURNED' || r.status === 'LOST').length,
    };
  }, [rentalsQ.data]);

  const openReturn = (r: Rental) => {
    setReturning(r);
    setDamageFee('');
    setNotes('');
    setError(null);
  };

  const refundPreview = useMemo(() => {
    if (!returning) return 0;
    const dmg = Math.round((Number(damageFee) || 0) * 100);
    return Math.max(0, returning.depositCents - dmg);
  }, [returning, damageFee]);

  const submitReturn = async () => {
    if (!returning) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/rentals/${returning.id}/return`, {
        damageFeeCents: Math.round((Number(damageFee) || 0) * 100),
        returnNotes:    notes || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['rentals'] });
      setReturning(null);
    } catch (err) {
      setError(err instanceof ApiHttpError ? err.message : 'Return failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <PhoneHeader variant="brand" />

      <View style={styles.head}>
        <Text style={styles.h1}>Rentals</Text>
        <Text style={styles.sub}>Active wheelchairs, CPAPs, beds — return when due.</Text>
      </View>

      {/* Filter chips */}
      <View style={styles.chipsRow}>
        {(['ACTIVE', 'DUE_TODAY', 'OVERDUE', 'RETURNED'] as const).map((f) => {
          const active = filter === f;
          const c = counts[f] ?? 0;
          const label = f === 'DUE_TODAY' ? 'Due today' : f.charAt(0) + f.slice(1).toLowerCase();
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, active && styles.chipOn]}>
              <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>{label}</Text>
              <View style={[styles.chipCount, active && styles.chipCountOn]}>
                <Text style={[styles.chipCountText, active && styles.chipCountTextOn]}>{c}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <FlatList<Rental>
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          rentalsQ.isLoading ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="package-variant" size={48} color={colors.faint} />
              <Text style={styles.emptyTitle}>No rentals in this filter</Text>
              <Text style={styles.emptySub}>
                Open new rentals on the web admin. They&apos;ll show up here once they&apos;re OPEN.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <RentalCard rental={item} onReturn={() => openReturn(item)} />
        )}
      />

      {/* Return sheet */}
      <Modal
        visible={!!returning}
        transparent
        animationType="fade"
        onRequestClose={() => !submitting && setReturning(null)}
      >
        <Pressable style={styles.scrim} onPress={() => !submitting && setReturning(null)}>
          <Pressable style={styles.sheet} onPress={() => { /* swallow taps */ }}>
            <Text style={styles.sheetTitle}>Return rental</Text>
            {returning ? (
              <View style={styles.sheetMeta}>
                <Text style={styles.sheetMetaName}>{returning.serializedUnit.product.name}</Text>
                <Text style={styles.sheetMetaSub}>
                  SN {returning.serializedUnit.serialNumber} · {returning.customer.name}
                </Text>
                <Text style={styles.sheetMetaSub}>
                  Deposit held: <Text style={[styles.bold, tnum]}>{formatPeso(returning.depositCents)}</Text>
                </Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Damage fee (₱)</Text>
            <TextInput
              value={damageFee}
              onChangeText={setDamageFee}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Return condition notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Any new damage? Missing parts?"
              placeholderTextColor={colors.faint}
              multiline
              style={[styles.input, styles.inputMulti]}
            />

            <View style={styles.refundCard}>
              <Text style={styles.refundLabel}>Refund to renter</Text>
              <Text style={[styles.refundValue, tnum]}>{formatPeso(refundPreview)}</Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.sheetActions}>
              <Pressable onPress={() => !submitting && setReturning(null)} style={styles.btnGhost}>
                <Text style={styles.btnGhostLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitReturn}
                disabled={submitting}
                style={({ pressed }) => [styles.btnPrimary, (pressed || submitting) && { opacity: 0.85 }]}
              >
                <Text style={styles.btnPrimaryLabel}>{submitting ? 'Saving…' : 'Confirm return'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function RentalCard({ rental, onReturn }: { rental: Rental; onReturn: () => void }): React.ReactElement {
  const days = daysUntil(rental.dueAt);
  const overdue = rental.status === 'OVERDUE';
  const returned = rental.status === 'RETURNED' || rental.status === 'LOST';

  return (
    <View style={[cardStyles.card, overdue && cardStyles.cardOverdue, returned && cardStyles.cardReturned]}>
      <View style={cardStyles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={cardStyles.product}>{rental.serializedUnit.product.name}</Text>
          <Text style={cardStyles.meta}>
            SN {rental.serializedUnit.serialNumber} · {rental.customer.name}
          </Text>
          {rental.customer.contactPhone ? (
            <Text style={cardStyles.phone}>{rental.customer.contactPhone}</Text>
          ) : null}
        </View>
        <View style={[cardStyles.dueChip, overdue && cardStyles.dueChipOverdue, returned && cardStyles.dueChipReturned]}>
          <Text style={[cardStyles.dueLabel, overdue && cardStyles.dueLabelOverdue, returned && cardStyles.dueLabelReturned]}>
            {returned ? 'Returned' : (overdue ? `${Math.abs(days)}d overdue` : (days === 0 ? 'Due today' : `Due in ${days}d`))}
          </Text>
          <Text style={[cardStyles.dueSub, overdue && cardStyles.dueLabelOverdue, returned && cardStyles.dueLabelReturned]}>
            {dueLabel(rental.dueAt)}
          </Text>
        </View>
      </View>

      <View style={cardStyles.bodyRow}>
        <View>
          <Text style={cardStyles.metaLabel}>Deposit</Text>
          <Text style={[cardStyles.metaValue, tnum]}>{formatPeso(rental.depositCents)}</Text>
        </View>
        <View>
          <Text style={cardStyles.metaLabel}>Rate</Text>
          <Text style={[cardStyles.metaValue, tnum]}>
            {formatPeso(Math.round(Number(rental.rentalRate) * 100))} / {rental.rateUnit}
          </Text>
        </View>
      </View>

      {!returned ? (
        <Pressable onPress={onReturn} style={cardStyles.returnBtn}>
          <MaterialCommunityIcons name="package-down" size={18} color={colors.onPrimary} />
          <Text style={cardStyles.returnBtnLabel}>Return</Text>
        </Pressable>
      ) : (
        <View style={cardStyles.refundBanner}>
          <MaterialCommunityIcons name="check-circle" size={14} color={colors.successDeep} />
          <Text style={cardStyles.refundBannerText}>
            Refunded {formatPeso(rental.refundCents)} · damage fee {formatPeso(rental.damageFeeCents)}
          </Text>
        </View>
      )}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
    marginBottom: spacing.s3,
    gap: spacing.s2,
  },
  cardOverdue:  { borderColor: colors.warning, borderWidth: 2 },
  cardReturned: { backgroundColor: colors.creamSoft, opacity: 0.7 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s2 },
  product:   { ...textTokens.body, fontSize: 15, fontWeight: '800', color: colors.ink },
  meta:      { ...textTokens.caption, fontSize: 12, color: colors.muted, marginTop: 2 },
  phone:     { ...textTokens.caption, fontSize: 11, color: colors.muted, marginTop: 2 },

  dueChip:    { backgroundColor: colors.primaryContainer, borderRadius: radii.sm, padding: spacing.s2, alignItems: 'flex-end' },
  dueChipOverdue: { backgroundColor: colors.warningSoft },
  dueChipReturned: { backgroundColor: colors.successSoft },
  dueLabel:   { fontFamily: fonts.bodyBold, fontSize: 11, fontWeight: '800', color: colors.primaryPress, letterSpacing: 0.3 },
  dueLabelOverdue: { color: colors.warningDeep },
  dueLabelReturned: { color: colors.successDeep },
  dueSub:     { ...textTokens.caption, fontSize: 10, color: colors.primaryPress, marginTop: 2 },

  bodyRow: { flexDirection: 'row', gap: spacing.s5, paddingTop: spacing.s2, borderTopWidth: 1, borderTopColor: colors.rule },
  metaLabel: { ...textTokens.caption, fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' },
  metaValue: { ...textTokens.body, fontWeight: '700', color: colors.ink, marginTop: 2 },

  returnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.successDeep,
    marginTop: 4,
  },
  returnBtnLabel: { color: colors.onPrimary, fontFamily: fonts.bodyBold, fontWeight: '700', fontSize: 14 },

  refundBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successSoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    marginTop: 4,
  },
  refundBannerText: { ...textTokens.caption, fontSize: 11, color: colors.successDeep, fontWeight: '600' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: spacing.s4, paddingTop: spacing.s4, paddingBottom: spacing.s2 },
  h1: { ...textTokens.displayLg, fontSize: 22, color: colors.ink },
  sub: { ...textTokens.bodySm, color: colors.muted, marginTop: 4 },

  chipsRow: {
    flexDirection: 'row',
    gap: spacing.s2,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.s3,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.creamDeep,
  },
  chipOn:        { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel:     { ...textTokens.caption, fontSize: 11, fontWeight: '700', color: colors.muted },
  chipLabelOn:   { color: colors.onPrimary },
  chipCount:     { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.surface },
  chipCountOn:   { backgroundColor: 'rgba(255,255,255,0.22)' },
  chipCountText: { fontFamily: fonts.bodyBold, fontSize: 10, fontWeight: '800', color: colors.muted },
  chipCountTextOn: { color: colors.onPrimary },

  list: { padding: spacing.s4, paddingTop: spacing.s2 },
  empty: { alignItems: 'center', paddingVertical: spacing.s8, gap: spacing.s2 },
  emptyTitle: { ...textTokens.displaySm, fontSize: 16, color: colors.ink, marginTop: spacing.s2 },
  emptySub: { ...textTokens.bodySm, color: colors.muted, textAlign: 'center', paddingHorizontal: spacing.s5 },

  // Sheet
  scrim: { flex: 1, backgroundColor: 'rgba(31,27,22,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.s5,
    paddingBottom: spacing.s7,
    gap: spacing.s2,
  },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 20, fontWeight: '800', color: colors.ink },
  sheetMeta:  { backgroundColor: colors.creamSoft, borderRadius: radii.sm, padding: spacing.s3, marginTop: spacing.s2, marginBottom: spacing.s3 },
  sheetMetaName: { ...textTokens.body, fontWeight: '800', color: colors.ink },
  sheetMetaSub:  { ...textTokens.caption, fontSize: 12, color: colors.muted, marginTop: 2 },
  bold:       { fontWeight: '800', color: colors.ink },

  fieldLabel: { ...textTokens.caption, color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.s2 },
  input: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.ink,
    marginTop: 4,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },

  refundCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderColor: '#B5E6D2',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.s3,
    marginTop: spacing.s3,
  },
  refundLabel: { ...textTokens.body, fontWeight: '800', color: colors.successDeep },
  refundValue: { fontFamily: fonts.displayBold, fontSize: 22, fontWeight: '800', color: colors.successDeep },

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
    backgroundColor: colors.successDeep,
  },
  btnPrimaryLabel: { ...textTokens.body, fontWeight: '800', color: colors.onPrimary },
});
