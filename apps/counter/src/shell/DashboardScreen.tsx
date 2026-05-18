/**
 * Clerque Counter — Dashboard
 *
 * Tenant-level KPI dashboard for cashier mode. Renders a compact card grid
 * with today's gross / order count / avg / top product / open-shifts count.
 *
 * Data source: `GET /reports/daily?branchId=X&date=YYYY-MM-DD` (PH today).
 * The Cloud returns a `DailyReport` with peso-denominated numbers, which we
 * convert to ₱-cents for the existing `formatPeso` helper. There is no
 * `/reports/dashboard` endpoint — the daily report is the closest match and
 * carries everything the cashier-side dashboard needs.
 *
 * `lowStockCount` and `openShifts` aren't part of the daily payload (see
 * TODO(backend) below). We hide those tiles rather than render dashes.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import { api, ApiHttpError } from '@/api/client';
import { useBranchContext } from '@/api/BranchContext';
import TopBar from '@/shell/TopBar';
import { formatPeso } from '@/components/Money';
import { colors, radii, spacing, text as textTokens, tnum } from '@/theme';

interface DailyReportResponse {
  date: string;
  branchId: string;
  totalOrders: number;
  voidCount: number;
  /** Peso-denominated (NOT cents). */
  totalRevenue: number;
  /** Peso-denominated (NOT cents). */
  avgOrderValue: number;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
  }>;
  totalCogs: number;
  grossProfit: number;
  grossMargin: number;
}

interface DashboardVM {
  grossCents: number;
  orderCount: number;
  avgOrderCents: number;
  topProduct: { id: string; name: string; unitsSold: number } | null;
}

function phTodayIso(): string {
  // PH = UTC+8, no DST.
  const now = new Date();
  const phMs = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(phMs).toISOString().slice(0, 10);
}

interface Props {
  onMenuPress?: () => void;
}

export default function DashboardScreen({ onMenuPress }: Props): React.ReactElement {
  const { activeBranch } = useBranchContext();
  const branchId = activeBranch?.id ?? null;
  const date = useMemo(phTodayIso, []);

  const { data, isLoading, error, refetch } = useQuery<DailyReportResponse>({
    queryKey: ['reports', 'daily', branchId, date],
    enabled: !!branchId,
    queryFn: () =>
      api.get<DailyReportResponse>(
        `/reports/daily?branchId=${encodeURIComponent(branchId!)}&date=${encodeURIComponent(date)}`,
      ),
    retry: 1,
  });

  const vm: DashboardVM | undefined = useMemo(() => {
    if (!data) return undefined;
    const top = data.topProducts?.[0];
    return {
      grossCents:    Math.round(data.totalRevenue * 100),
      orderCount:    data.totalOrders,
      avgOrderCents: Math.round(data.avgOrderValue * 100),
      topProduct: top
        ? { id: top.productId, name: top.productName, unitsSold: top.quantitySold }
        : null,
    };
  }, [data]);

  return (
    <View style={styles.root}>
      <TopBar onMenuPress={onMenuPress} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Today</Text>
          {activeBranch?.name ? (
            <Text style={styles.sub}>{activeBranch.name}</Text>
          ) : null}
        </View>

        <View style={styles.grid}>
          <Kpi
            label="Gross"
            value={vm ? formatPeso(vm.grossCents) : '—'}
            big
            isLoading={isLoading}
            error={errorMsg(error)}
            onRetry={refetch}
          />
          <Kpi
            label="Orders"
            value={vm ? String(vm.orderCount) : '—'}
            isLoading={isLoading}
            error={errorMsg(error)}
            onRetry={refetch}
          />
          <Kpi
            label="Avg / order"
            value={vm ? formatPeso(vm.avgOrderCents) : '—'}
            isLoading={isLoading}
            error={errorMsg(error)}
            onRetry={refetch}
          />
          <Kpi
            label="Top product"
            value={vm?.topProduct?.name ?? '—'}
            sub={vm?.topProduct ? `${vm.topProduct.unitsSold} sold` : undefined}
            isLoading={isLoading}
            error={errorMsg(error)}
            onRetry={refetch}
          />
          {/*
            TODO(backend): /reports/daily does not currently include a
            tenant-wide `lowStockCount` or `openShifts` count. Add either to
            the daily payload or expose a small companion endpoint (e.g.
            `/reports/dashboard-supplement?branchId=X`) so we can restore
            these tiles without an extra round-trip per render.
          */}
        </View>
      </ScrollView>
    </View>
  );
}

function errorMsg(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiHttpError) return err.status === 0 ? 'Offline' : 'No data yet';
  return 'No data yet';
}

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
  isLoading?: boolean;
  error?: string | null;
  pillTone?: 'warning';
  onRetry?: () => void;
}

function Kpi({ label, value, sub, big, isLoading, error, pillTone, onRetry }: KpiProps): React.ReactElement {
  return (
    <Card style={[styles.card, big && styles.cardBig]} mode="elevated">
      <Card.Content style={styles.cardInner}>
        <Text style={styles.cardLabel}>{label}</Text>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.s2 }} />
        ) : error ? (
          <Text
            style={styles.cardSkel}
            onPress={onRetry}
            accessibilityRole={onRetry ? 'button' : undefined}
          >
            {error}{onRetry ? ' — tap to retry' : ''}
          </Text>
        ) : (
          <>
            <Text style={[big ? styles.cardValueBig : styles.cardValue, tnum]} numberOfLines={1}>
              {value}
            </Text>
            {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
            {pillTone === 'warning' ? (
              <View style={styles.warnPill}>
                <Text style={styles.warnPillText}>Needs attention</Text>
              </View>
            ) : null}
          </>
        )}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s5, gap: spacing.s4 },
  header: { marginBottom: spacing.s3 },
  title: { ...textTokens.displayLg, color: colors.ink },
  sub: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s3 },
  card: {
    minWidth: 220,
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
  },
  cardBig: { flexBasis: '45%' },
  cardInner: { paddingVertical: spacing.s4 },
  cardLabel: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase' },
  cardValue: { ...textTokens.displayMd, color: colors.ink, marginTop: spacing.s2 },
  cardValueBig: { ...textTokens.displayLg, color: colors.ink, marginTop: spacing.s2 },
  cardSub: { ...textTokens.bodySm, color: colors.muted, marginTop: spacing.s1 },
  cardSkel: { ...textTokens.body, color: colors.faint, marginTop: spacing.s2 },
  warnPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.s2,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s1,
    borderRadius: radii.pill,
    backgroundColor: colors.warningSoft,
  },
  warnPillText: { ...textTokens.caption, color: colors.warningDeep, fontWeight: '700' },
});
