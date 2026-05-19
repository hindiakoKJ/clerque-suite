/**
 * Clerque Counter — Phone Pickups list
 *
 * Bakery custom-cake pickups for today. Cashier sees who's coming in,
 * how much balance is due, and the inscription so they can confirm the
 * cake is the right one before handing it over.
 *
 * V1 settle flow: cashier taps "Mark picked up" → calls /mark-ready then
 * the cashier rings the balance as a normal sale on the Sell tab and
 * applies a manual "Less deposit ₱X" discount line. V2 will wire a
 * direct settle path through the cart pre-populated with the line items
 * + deposit credit.
 */
import React from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { api, ApiHttpError } from '@/api/client';
import { useBranchContext } from '@/api/BranchContext';
import { formatPeso } from '@/components/Money';
import { colors, fonts, radii, spacing, text as textTokens, tnum } from '@/theme';

interface Pickup {
  id:             string;
  preOrderNumber: string;
  status:         'DRAFT' | 'DEPOSIT_PAID' | 'READY' | 'PICKED_UP' | 'CANCELLED';
  pickupTime:     string | null;
  pickupDate:     string;
  inscription:    string | null;
  notes:          string | null;
  totalCents:     number;
  depositCents:   number;
  balanceCents:   number;
  customer:       { id: string; name: string; contactPhone: string | null } | null;
  items:          Array<{
    id: string;
    productName: string;
    quantity: number | string;
  }>;
}

function phYmd(d: Date): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function PhonePickupsScreen(): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id ?? null;
  const nav = useNavigation<{ goBack: () => void }>();
  const qc = useQueryClient();
  const today = React.useMemo(() => phYmd(new Date()), []);

  const list = useQuery<Pickup[]>({
    queryKey: ['pre-orders', 'pickups', branchId, today],
    enabled: !!branchId,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const data = await api.get<Pickup[]>(
          `/pre-orders?branchId=${encodeURIComponent(branchId!)}&from=${today}&to=${today}`,
        );
        return Array.isArray(data) ? data : [];
      } catch (err) {
        if (err instanceof ApiHttpError) return [];
        throw err;
      }
    },
  });

  const markReady = async (p: Pickup) => {
    try {
      await api.post(`/pre-orders/${p.id}/mark-ready`);
      await qc.invalidateQueries({ queryKey: ['pre-orders'] });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[pickups] mark-ready failed', e);
    }
  };

  return (
    <View style={styles.root}>
      <PhoneHeader title="Today's pickups" subtitle="Custom cake reservations" onBack={() => nav.goBack()} />

      <FlatList<Pickup>
        data={list.data ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.scroll}
        ListEmptyComponent={
          list.isLoading ? (
            <View style={styles.empty}><ActivityIndicator /></View>
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="cake-variant" size={48} color={colors.faint} />
              <Text style={styles.emptyTitle}>No pickups today</Text>
              <Text style={styles.emptySub}>
                Custom cake orders show up here on the day they&apos;re due.
                Create new pre-orders on the web admin.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <PickupRow pickup={item} onMarkReady={() => void markReady(item)} />}
      />
    </View>
  );
}

function PickupRow({ pickup, onMarkReady }: { pickup: Pickup; onMarkReady: () => void }): React.ReactElement {
  const itemSummary = pickup.items
    .map((i) => `${Number(i.quantity)}× ${i.productName}`)
    .join(' · ');
  const statusInfo = STATUS[pickup.status];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.metaRow}>
            <Text style={styles.preOrderNum}>{pickup.preOrderNumber}</Text>
            <View style={[styles.badge, { backgroundColor: statusInfo.bg }]}>
              <Text style={[styles.badgeText, { color: statusInfo.fg }]}>{statusInfo.label}</Text>
            </View>
            {pickup.pickupTime ? (
              <Text style={styles.time}>{pickup.pickupTime}</Text>
            ) : null}
          </View>
          <Text style={styles.customer} numberOfLines={1}>
            {pickup.customer?.name ?? 'Walk-in'}
          </Text>
          {pickup.customer?.contactPhone ? (
            <Text style={styles.phone}>{pickup.customer.contactPhone}</Text>
          ) : null}
        </View>
      </View>

      {pickup.inscription ? (
        <View style={styles.inscriptionWrap}>
          <Text style={styles.inscriptionLabel}>INSCRIPTION</Text>
          <Text style={styles.inscription}>&ldquo;{pickup.inscription}&rdquo;</Text>
        </View>
      ) : null}

      <Text style={styles.items} numberOfLines={3}>{itemSummary}</Text>

      {pickup.notes ? (
        <Text style={styles.notes} numberOfLines={2}>Notes: {pickup.notes}</Text>
      ) : null}

      <View style={styles.totalsRow}>
        <View>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={[styles.totalValue, tnum]}>{formatPeso(pickup.totalCents)}</Text>
        </View>
        {pickup.depositCents > 0 ? (
          <View>
            <Text style={styles.totalLabel}>Deposit paid</Text>
            <Text style={[styles.totalSub, tnum]}>− {formatPeso(pickup.depositCents)}</Text>
          </View>
        ) : null}
        <View>
          <Text style={styles.balanceLabel}>Balance due</Text>
          <Text style={[styles.balanceValue, tnum]}>{formatPeso(pickup.balanceCents)}</Text>
        </View>
      </View>

      {pickup.status === 'DEPOSIT_PAID' || pickup.status === 'DRAFT' ? (
        <Pressable
          onPress={onMarkReady}
          style={({ pressed }) => [styles.readyBtn, pressed && styles.readyBtnPressed]}
        >
          <MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.onPrimary} />
          <Text style={styles.readyBtnLabel}>Mark ready for pickup</Text>
        </Pressable>
      ) : pickup.status === 'READY' ? (
        <View style={styles.readyBanner}>
          <MaterialCommunityIcons name="check-circle" size={18} color={colors.successDeep} />
          <Text style={styles.readyBannerText}>
            Ready · ring the {formatPeso(pickup.balanceCents)} balance on the Sell tab to settle
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const STATUS: Record<Pickup['status'], { label: string; bg: string; fg: string }> = {
  DRAFT:        { label: 'Draft',          bg: colors.cream,       fg: colors.muted },
  DEPOSIT_PAID: { label: 'Deposit paid',   bg: colors.warningSoft, fg: colors.warningDeep },
  READY:        { label: 'Ready',          bg: colors.successSoft, fg: colors.successDeep },
  PICKED_UP:    { label: 'Picked up',      bg: colors.infoSoft,    fg: colors.infoDeep },
  CANCELLED:    { label: 'Cancelled',      bg: colors.errorSoft,   fg: colors.errorDeep },
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, gap: spacing.s3 },
  empty: { alignItems: 'center', paddingVertical: spacing.s8, gap: spacing.s2 },
  emptyTitle: { ...textTokens.displaySm, fontSize: 16, color: colors.ink, marginTop: spacing.s2 },
  emptySub:   { ...textTokens.bodySm, color: colors.muted, textAlign: 'center', paddingHorizontal: spacing.s5 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
    gap: spacing.s2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  preOrderNum: { fontFamily: fonts.monoSemibold, fontSize: 12, color: colors.ink, fontWeight: '700' },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  time: { fontFamily: fonts.mono, fontSize: 11, color: colors.muted, marginLeft: 'auto' },

  customer: { ...textTokens.body, fontSize: 15, fontWeight: '700', color: colors.ink },
  phone:    { ...textTokens.caption, color: colors.muted, marginTop: 2 },

  inscriptionWrap: {
    backgroundColor: colors.creamSoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  inscriptionLabel: { ...textTokens.caption, fontSize: 10, fontWeight: '800', color: colors.primaryInk, letterSpacing: 0.6 },
  inscription:      { ...textTokens.body, color: colors.ink, fontStyle: 'italic', marginTop: 2 },

  items:  { ...textTokens.bodySm, color: colors.muted, fontSize: 13 },
  notes:  { ...textTokens.caption, color: colors.faint, fontStyle: 'italic' },

  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: spacing.s2,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  totalLabel:   { ...textTokens.caption, color: colors.muted, fontSize: 10 },
  totalValue:   { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  totalSub:     { ...textTokens.body, color: colors.muted, fontWeight: '600' },
  balanceLabel: { ...textTokens.caption, color: colors.primary, fontSize: 10, fontWeight: '800' },
  balanceValue: { fontFamily: fonts.displayBold, fontSize: 18, fontWeight: '800', color: colors.primary, letterSpacing: -0.3 },

  readyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    marginTop: spacing.s2,
  },
  readyBtnPressed: { backgroundColor: colors.primaryPress },
  readyBtnLabel: { color: colors.onPrimary, fontFamily: fonts.bodyBold, fontWeight: '700', fontSize: 14 },

  readyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    borderRadius: radii.sm,
    marginTop: spacing.s2,
  },
  readyBannerText: { ...textTokens.caption, color: colors.successDeep, fontSize: 11, flex: 1, fontWeight: '600' },
});
