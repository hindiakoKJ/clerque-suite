/**
 * Clerque Counter — Phone Dashboard (P-04, owner-first home)
 *
 * Matches design-source-v3/phone-414x900.html P-04 line-for-line:
 *  • Hero gross-sales card (dark slate gradient, big tabular figure,
 *    ↑/↓ delta vs. yesterday, order count, tab to drill in)
 *  • 2-card row: Orders (count + avg) | Top product
 *  • Low-stock warning card (warning tint) — wired to /inventory/low-stock
 *  • Open shift status card with elapsed time + opening float
 *  • Approvals chip (primary tint) — wired to /void-approvals?status=PENDING
 *
 * Data source: GET /reports/daily?branchId&date=YYYY-MM-DD (today + yesterday)
 * Field names per DailyReport DTO: totalRevenue, totalOrders, avgOrderValue,
 * topProducts[].productName / quantitySold / revenue.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { api, ApiHttpError } from '@/api/client';
import { useBranchContext } from '@/api/BranchContext';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';

interface TopProductDto {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

interface DailyReportDto {
  totalOrders?: number;
  voidCount?: number;
  totalRevenue?: number;     // pesos
  avgOrderValue?: number;    // pesos
  topProducts?: TopProductDto[];
}

interface LowStockItem {
  productId: string;
  productName: string;
  qty?: number;
  threshold?: number;
}

interface ApprovalsCount { count: number }

function phYmd(d: Date): string {
  // PH local YYYY-MM-DD (UTC+8 server matches PH).
  const offsetMs = 8 * 60 * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  return local.toISOString().slice(0, 10);
}

export default function PhoneDashboardScreen(): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id ?? null;
  const nav = useNavigation<{ navigate: (s: string) => void }>();

  const todayYmd = React.useMemo(() => phYmd(new Date()), []);
  const yesterdayYmd = React.useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return phYmd(d);
  }, []);

  const today = useQuery<DailyReportDto>({
    queryKey: ['reports', 'daily', branchId, todayYmd],
    enabled: !!branchId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => api.get<DailyReportDto>(
      `/reports/daily?branchId=${encodeURIComponent(branchId!)}&date=${todayYmd}`,
    ),
    retry: 1,
  });

  const yesterday = useQuery<DailyReportDto>({
    queryKey: ['reports', 'daily', branchId, yesterdayYmd],
    enabled: !!branchId,
    staleTime: 5 * 60_000,
    queryFn: () => api.get<DailyReportDto>(
      `/reports/daily?branchId=${encodeURIComponent(branchId!)}&date=${yesterdayYmd}`,
    ),
    retry: 1,
  });

  const lowStock = useQuery<LowStockItem[]>({
    queryKey: ['inventory', 'low-stock', branchId],
    enabled: !!branchId,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const list = await api.get<LowStockItem[]>(
          `/inventory/low-stock?branchId=${encodeURIComponent(branchId!)}`,
        );
        return Array.isArray(list) ? list : [];
      } catch (err) {
        if (err instanceof ApiHttpError) return [];
        throw err;
      }
    },
  });

  const approvals = useQuery<ApprovalsCount>({
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

  const t = today.data;
  const y = yesterday.data;

  const grossCents = Math.round((t?.totalRevenue ?? 0) * 100);
  const yGrossCents = Math.round((y?.totalRevenue ?? 0) * 100);
  const orders = t?.totalOrders ?? 0;
  const avgCents = Math.round((t?.avgOrderValue ?? 0) * 100);
  const top = t?.topProducts?.[0];

  // Delta vs yesterday — only show if yesterday had sales so the percent isn't
  // ∞%. Show absolute "vs ₱0" copy when yesterday is empty.
  const hasYesterday = yGrossCents > 0;
  const deltaPct = hasYesterday
    ? Math.round(((grossCents - yGrossCents) / yGrossCents) * 100)
    : null;
  const deltaUp = (deltaPct ?? 0) >= 0;

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  const lowStockCount = lowStock.data?.length ?? 0;
  const lowStockNames = (lowStock.data ?? []).slice(0, 3).map((i) => i.productName).join(' · ');
  const pendingApprovals = approvals.data?.count ?? 0;

  const loading = today.isLoading && !t;

  return (
    <View style={styles.root}>
      <PhoneHeader title="Clerque · Counter" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1}>Today · {dateLabel}</Text>
        {activeBranch?.name ? (
          <Text style={styles.sub}>{activeBranch.name}</Text>
        ) : null}

        {/* Hero gross card — dark slate gradient (P-04) */}
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>GROSS SALES · TODAY</Text>
          {loading ? (
            <View style={{ paddingVertical: spacing.s3 }}>
              <ActivityIndicator color={colors.onPrimary} />
            </View>
          ) : (
            <Text style={[styles.heroValue, tnum]} numberOfLines={1}>
              {formatPeso(grossCents)}
            </Text>
          )}
          <View style={styles.heroMeta}>
            {deltaPct != null ? (
              <View style={styles.deltaRow}>
                <MaterialCommunityIcons
                  name={deltaUp ? 'arrow-up' : 'arrow-down'}
                  size={14}
                  color={deltaUp ? colors.success : colors.error}
                />
                <Text style={[styles.deltaText, { color: deltaUp ? colors.success : colors.error }]}>
                  {Math.abs(deltaPct)}%
                </Text>
                <Text style={styles.heroSub}> vs. yesterday</Text>
              </View>
            ) : t ? (
              <Text style={styles.heroSub}>No sales yesterday</Text>
            ) : null}
            <Text style={styles.heroSub}>{orders} {orders === 1 ? 'order' : 'orders'}</Text>
          </View>
        </View>

        {/* 2-card row: Orders | Top product */}
        <View style={styles.row2}>
          <View style={styles.statCard}>
            <Text style={styles.cardLabel}>Orders</Text>
            <Text style={[styles.statValue, tnum]}>{orders}</Text>
            <Text style={styles.cardSub}>
              {avgCents > 0 ? `avg ${formatPeso(avgCents)}` : ' '}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.cardLabel}>Top product</Text>
            {top ? (
              <>
                <View style={styles.topProdRow}>
                  <View style={styles.topThumb}>
                    <Text style={styles.topThumbText}>
                      {top.productName.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.topName} numberOfLines={2}>{top.productName}</Text>
                </View>
                <Text style={styles.cardSub}>
                  {top.quantitySold} sold · {formatPeso(Math.round(top.revenue * 100))}
                </Text>
              </>
            ) : (
              <Text style={styles.cardSub}>—</Text>
            )}
          </View>
        </View>

        {/* Low-stock warning card */}
        {lowStockCount > 0 ? (
          <Pressable style={styles.warnCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.warnLabel}>
                LOW STOCK · {lowStockCount} {lowStockCount === 1 ? 'item' : 'items'}
              </Text>
              <Text style={styles.warnText} numberOfLines={2}>
                {lowStockNames}{lowStockCount > 3 ? ` · +${lowStockCount - 3}` : ''}
              </Text>
            </View>
            <MaterialCommunityIcons name="alert" size={20} color={colors.warningDeep} />
          </Pressable>
        ) : null}

        {/* Shift status big card */}
        <View style={styles.shiftCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>Shift</Text>
            <Text style={styles.shiftBig}>Tap to view shift</Text>
            <Text style={styles.cardSub}>Open · close · Z-read</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
        </View>

        {/* Approvals chip */}
        {pendingApprovals > 0 ? (
          <Pressable
            style={styles.approvalsCta}
            onPress={() => nav.navigate('More')}
          >
            <View style={styles.approvalsBadge}>
              <Text style={styles.approvalsBadgeText}>{pendingApprovals}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.approvalsTitle}>
                {pendingApprovals} {pendingApprovals === 1 ? 'approval' : 'approvals'} waiting
              </Text>
              <Text style={styles.approvalsSub}>
                Cashier needs supervisor PIN to void
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.primaryInk} />
          </Pressable>
        ) : null}

        {/* Quick actions 3-up */}
        <Text style={styles.section}>QUICK ACTIONS</Text>
        <View style={styles.actionRow}>
          <QuickAction icon="cart-outline" label="Sell" onPress={() => nav.navigate('Sell')} />
          <QuickAction icon="file-chart-outline" label="Z-read" onPress={() => nav.navigate('Shift')} />
          <QuickAction icon="receipt" label="Orders" onPress={() => nav.navigate('Orders')} />
        </View>
      </ScrollView>
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
      <MaterialCommunityIcons name={icon} size={24} color={colors.primary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, paddingBottom: spacing.s8, gap: spacing.s3 },
  h1: { ...textTokens.displayLg, color: colors.ink, fontSize: 22 },
  sub: { ...textTokens.bodySm, color: colors.muted, marginBottom: spacing.s2 },
  section: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '800',
    marginTop: spacing.s3,
  },

  // Hero
  heroCard: {
    backgroundColor: '#0F1727',
    borderRadius: radii.lg,
    padding: spacing.s5,
  },
  heroEyebrow: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroValue: {
    ...textTokens.displayLg,
    color: colors.onPrimary,
    fontSize: 38,
    marginTop: spacing.s2,
  },
  heroMeta: {
    flexDirection: 'row',
    gap: spacing.s4,
    marginTop: spacing.s3,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deltaText: { fontSize: 12, fontWeight: '800' },
  heroSub: { color: '#94A3B8', fontSize: 12 },

  // Stat cards
  row2: { flexDirection: 'row', gap: spacing.s2 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
    minHeight: 96,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.s1,
  },
  cardSub: { fontSize: 12, color: colors.muted, marginTop: spacing.s1 },
  statValue: { ...textTokens.displayLg, color: colors.ink, fontSize: 28, marginTop: 2 },

  topProdRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2, marginTop: 2 },
  topThumb: {
    width: 32, height: 32, borderRadius: radii.sm,
    backgroundColor: colors.creamDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  topThumbText: { ...textTokens.displaySm, color: colors.ink, fontSize: 11 },
  topName: {
    ...textTokens.body,
    fontWeight: '800',
    color: colors.ink,
    fontSize: 14,
    flex: 1,
    minWidth: 0,
  },

  // Low-stock
  warnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#F8D6A1',
    padding: spacing.s4,
  },
  warnLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.warningDeep,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  warnText: {
    ...textTokens.bodySm,
    color: colors.warningDeep,
    fontWeight: '700',
    marginTop: 2,
  },

  // Shift
  shiftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
    gap: spacing.s3,
  },
  shiftBig: { ...textTokens.displaySm, color: colors.ink, fontSize: 16, marginTop: 2 },

  // Approvals
  approvalsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.s4,
  },
  approvalsBadge: {
    width: 36, height: 36, borderRadius: radii.sm,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  approvalsBadgeText: { color: colors.onPrimary, fontWeight: '800', fontSize: 16 },
  approvalsTitle: { ...textTokens.body, color: colors.primaryInk, fontWeight: '800', fontSize: 14 },
  approvalsSub: { fontSize: 11, color: colors.primaryInk, marginTop: 2 },

  // Quick actions
  actionRow: { flexDirection: 'row', gap: spacing.s2 },
  action: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingVertical: spacing.s4,
    alignItems: 'center',
    gap: spacing.s2,
  },
  actionPressed: { backgroundColor: colors.creamSoft, borderColor: colors.ruleStrong },
  actionLabel: { ...textTokens.body, color: colors.ink, fontWeight: '700', fontSize: 13 },
});
