/**
 * Clerque Counter — Phone Dashboard (P-04, owner-first home)
 *
 * Vertical scroll feed:
 *  • Hero gross-sales card (huge tabular figure)
 *  • Orders / Avg / Top product 3-card row
 *  • Low-stock pill (if any)
 *  • Approvals CTA (if pending > 0)
 *  • Open-shift status card
 *  • Quick actions (Sell / Z-read / Orders)
 *
 * Reuses `/reports/dashboard?day=today&branchId=…` from the tablet dashboard.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { api, ApiHttpError } from '@/api/client';
import { useBranchContext } from '@/api/BranchContext';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';

interface DashboardResponse {
  grossCents: number;
  orderCount: number;
  avgOrderCents: number;
  topProduct: { id: string; name: string; unitsSold: number } | null;
  lowStockCount: number;
  openShifts: number;
}

interface ApprovalsCountResponse { count: number }

export default function PhoneDashboardScreen(): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id ?? null;
  const nav = useNavigation<{ navigate: (s: string) => void }>();

  const dashboard = useQuery<DashboardResponse>({
    queryKey: ['reports', 'dashboard', branchId, 'today'],
    queryFn: () => api.get<DashboardResponse>(
      `/reports/dashboard?day=today${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ''}`,
    ),
    retry: 1,
  });

  const approvals = useQuery<ApprovalsCountResponse>({
    queryKey: ['void-approvals', 'pending-count'],
    queryFn: async () => {
      try {
        const list = await api.get<unknown[]>('/void-approvals?status=PENDING');
        return { count: Array.isArray(list) ? list.length : 0 };
      } catch (err) {
        if (err instanceof ApiHttpError) return { count: 0 };
        throw err;
      }
    },
    retry: 0,
    staleTime: 30_000,
  });

  const d = dashboard.data;
  const today = new Date();
  const dateLabel = today.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <View style={styles.root}>
      <PhoneHeader title="Clerque · Counter" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1}>Today · {dateLabel}</Text>
        {activeBranch?.name ? (
          <Text style={styles.sub}>{activeBranch.name}</Text>
        ) : null}

        {/* Hero gross card */}
        <View style={[styles.card, styles.heroCard]}>
          <Text style={[styles.heroEyebrow, tnum]}>GROSS SALES · TODAY</Text>
          <Text style={[styles.heroValue, tnum]} numberOfLines={1}>
            {d ? formatPeso(d.grossCents) : '—'}
          </Text>
          <Text style={styles.heroSub}>
            {d ? `${d.orderCount} orders` : ' '}
          </Text>
        </View>

        {/* 3-card stat row */}
        <View style={styles.statRow}>
          <Stat label="Orders" value={d ? String(d.orderCount) : '—'} />
          <Stat label="Avg" value={d ? formatPeso(d.avgOrderCents) : '—'} />
          <Stat
            label="Top"
            value={d?.topProduct?.name ?? '—'}
            big={false}
          />
        </View>

        {/* Low stock pill */}
        {d && d.lowStockCount > 0 ? (
          <Pressable style={styles.warnPill}>
            <MaterialCommunityIcons name="alert-outline" size={18} color={colors.warningDeep} />
            <Text style={styles.warnPillText}>
              {d.lowStockCount} low-stock {d.lowStockCount === 1 ? 'item' : 'items'}
            </Text>
          </Pressable>
        ) : null}

        {/* Approvals CTA */}
        {approvals.data && approvals.data.count > 0 ? (
          <Pressable
            style={styles.approvalsCta}
            onPress={() => nav.navigate('More')}
          >
            <MaterialCommunityIcons name="shield-check" size={22} color={colors.warningDeep} />
            <View style={{ flex: 1 }}>
              <Text style={styles.approvalsCtaTitle}>
                {approvals.data.count} {approvals.data.count === 1 ? 'approval' : 'approvals'} waiting
              </Text>
              <Text style={styles.approvalsCtaSub}>Tap to review void/refund requests</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.warningDeep} />
          </Pressable>
        ) : null}

        {/* Shift status */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Shift</Text>
          {d && d.openShifts > 0 ? (
            <View style={styles.shiftRow}>
              <View style={[styles.shiftDot, { backgroundColor: colors.success }]} />
              <Text style={styles.shiftText}>
                {d.openShifts} open {d.openShifts === 1 ? 'shift' : 'shifts'}
              </Text>
            </View>
          ) : (
            <View style={styles.shiftRow}>
              <View style={[styles.shiftDot, { backgroundColor: colors.error }]} />
              <Text style={styles.shiftText}>No shift open</Text>
            </View>
          )}
        </View>

        {/* Quick actions */}
        <Text style={styles.section}>Quick actions</Text>
        <View style={styles.actionRow}>
          <QuickAction
            icon="cash-register"
            label="Sell"
            onPress={() => nav.navigate('Sell')}
          />
          <QuickAction
            icon="file-chart-outline"
            label="Z-read"
            onPress={() => nav.navigate('Shift')}
          />
          <QuickAction
            icon="receipt"
            label="Orders"
            onPress={() => nav.navigate('Orders')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

interface StatProps { label: string; value: string; big?: boolean }
function Stat({ label, value }: StatProps): React.ReactElement {
  return (
    <View style={[styles.card, styles.statCard]}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={[styles.statValue, tnum]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

interface QuickActionProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
}
function QuickAction({ icon, label, onPress }: QuickActionProps): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
      <MaterialCommunityIcons name={icon} size={26} color={colors.primary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, paddingBottom: spacing.s8, gap: spacing.s3 },
  h1: { ...textTokens.displayLg, color: colors.ink, fontSize: 22 },
  sub: { ...textTokens.bodySm, color: colors.muted, marginBottom: spacing.s3 },
  section: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', marginTop: spacing.s3 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
  },
  cardLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '800' },
  heroCard: {
    backgroundColor: colors.darkElev,
    borderColor: 'transparent',
    padding: spacing.s5,
  },
  heroEyebrow: { color: colors.darkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  heroValue: {
    ...textTokens.displayLg, color: colors.onPrimary, fontSize: 48, marginTop: spacing.s2,
  },
  heroSub: { color: colors.darkMuted, marginTop: spacing.s2, ...textTokens.bodySm },
  statRow: { flexDirection: 'row', gap: spacing.s2 },
  statCard: { flex: 1, paddingHorizontal: spacing.s3, paddingVertical: spacing.s3 },
  statValue: { ...textTokens.displaySm, color: colors.ink, marginTop: spacing.s2, fontSize: 16 },
  warnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    backgroundColor: colors.warningSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    alignSelf: 'flex-start',
  },
  warnPillText: { ...textTokens.body, color: colors.warningDeep, fontWeight: '700' },
  approvalsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.warningSoft,
    borderRadius: radii.lg,
    padding: spacing.s4,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  approvalsCtaTitle: { ...textTokens.body, color: colors.warningDeep, fontWeight: '800' },
  approvalsCtaSub: { ...textTokens.caption, color: colors.warningDeep, marginTop: 2 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2, marginTop: spacing.s2 },
  shiftDot: { width: 10, height: 10, borderRadius: 5 },
  shiftText: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: spacing.s2 },
  action: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingVertical: spacing.s4,
    alignItems: 'center',
    gap: spacing.s2,
  },
  actionPressed: { backgroundColor: colors.creamSoft, borderColor: colors.ruleStrong },
  actionLabel: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
});
